/**
 * OpenPlaud customer chat bubble — single-file source.
 *
 * Built by scripts/build-bubble.mjs into public/openplaud.js, a
 * self-contained file any website can embed with one script tag:
 *
 *   <script src="/openplaud.js"></script>
 *
 *   Pre-configured support group (customer only enters their name):
 *   <script src="/openplaud.js" data-operator-group="<group uuid>"></script>
 *
 * No framework, no other assets. The API address is configurable
 * (`data-api-base` / `window.OPENPLAUD_CONFIG.apiBase`); the bundled
 * default points at the local OpenPlaud admin API. The openplaud-fed-client
 * test pages point it at their own /api/proxy while the API has no CORS.
 *
 * Protocol notes (custom ejabberd 26.9 build, verified live):
 * - an initial bare presence is REQUIRED after connect or later stanzas
 *   fail with `not-authorized`;
 * - MUC join = presence to `room@<service>/<Nick>` with an empty
 *   `<x xmlns="http://jabber.org/protocol/muc"/>`;
 * - the operator side sees the chat only after the customer's FIRST
 *   groupchat message (server-side MucSub), so the UI says so until then.
 */
(function () {
  'use strict';

  if (window.__OPENPLAUD_BUBBLE_LOADED__) return;
  window.__OPENPLAUD_BUBBLE_LOADED__ = true;

  // Strophe 5 UMD (browser) export shape: window.Strophe is the namespace
  // object (holds .Connection); the stanza builders are top-level globals
  // (window.$msg / window.$pres), not members of that object.
  const StropheLib = window.Strophe;
  const { $msg, $pres } = window;

  // ---------------- config ----------------

  function scriptTag() {
    return document.currentScript || document.querySelector('script[src$="openplaud.js"]');
  }

  function resolveConfig() {
    const tag = scriptTag();
    const data = tag && tag.dataset ? tag.dataset : {};
    const pre = window.OPENPLAUD_CONFIG || {};
    const apiBase = data.apiBase || pre.apiBase || 'http://localhost:8080/api/v1';
    return {
      apiBase: apiBase.replace(/\/+$/, ''),
      operatorGroup: data.operatorGroup || pre.operatorGroup || null,
      xmppUrl: data.xmppUrl || pre.xmppUrl || 'ws://localhost:5280/websocket',
      xmppDomain: data.xmppDomain || pre.xmppDomain || 'localhost',
      xmppService: data.xmppService || pre.xmppService || 'conference',
    };
  }

  const cfg = resolveConfig();

  // ---------------- small helpers ----------------

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Non-secure-context fallback (crypto.getRandomValues is universal).
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x30;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // ---------------- API ----------------

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }

  const api = {
    async request(method, path, body) {
      let res;
      try {
        res = await fetch(cfg.apiBase + path, {
          method,
          headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        throw new ApiError(0, 'Cannot reach the OpenPlaud backend — check the API address and that the backend is running.');
      }
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      if (!res.ok) {
        throw new ApiError(res.status, (data && data.message) || 'Request failed (' + res.status + ')');
      }
      return data;
    },
    get: (p) => api.request('GET', p),
    post: (p, b) => api.request('POST', p, b),
    del: (p) => api.request('DELETE', p),
  };

  // ---------------- XMPP ----------------
  // Strophe 5 status codes (module-local).
  const S_CONNECTED = 5;
  const S_RECONNECTING = 13;
  const S_DISCONNECTED = 6;
  const S_AUTHFAIL = 4;
  const S_CONNFAIL = 2;
  const S_CONNTIMEOUT = 10;
  const S_ERROR = 0;

  // Recursively extract the first <body> text (xmldom-safe walker).
  function bodyOf(root) {
    const walk = (n) => {
      if (n.nodeName === 'body') {
        const c = n.childNodes[0];
        return c ? (c.nodeValue != null ? c.nodeValue : '') : '';
      }
      for (let i = 0; i < n.childNodes.length; i++) {
        const r = walk(n.childNodes[i]);
        if (r !== null) return r;
      }
      return null;
    };
    const r = walk(root);
    return r == null ? '' : r;
  }

  // Resource (nick) out of a full JID `local@domain/Nick`.
  function nickOf(from) {
    const host = from.split('@')[1] || '';
    return host.split('/')[1] || '';
  }

  function XmppClient(user, password, domain, wsUrl, resource, cbs) {
    this.user = user;
    this.password = password;
    this.domain = domain;
    this.wsUrl = wsUrl;
    this.resource = resource;
    this.cbs = cbs;
    this.conn = null;
    this.closing = false;
  }

  XmppClient.prototype.connect = function () {
    this.close();
    this.closing = false;
    this.cbs.onPhase('connecting');
    const cbs = this.cbs;
    const conn = new StropheLib.Connection(this.wsUrl);
    this.conn = conn;

    // Arrow: keeps the lexical `this` (the client) for the closing check.
    conn.connect(
      this.user + '@' + this.domain + '/' + this.resource,
      this.password,
      (status) => {
        if (status === S_CONNECTED) cbs.onPhase('connected');
        else if (status === S_RECONNECTING) cbs.onPhase('reconnecting');
        else if (status === S_DISCONNECTED) {
          if (!this.closing) cbs.onPhase('reconnecting');
        } else if (status === S_AUTHFAIL || status === S_CONNFAIL || status === S_CONNTIMEOUT || status === S_ERROR) {
          cbs.onPhase('failed');
        }
      }
    );

    // Strophe 5 removes handlers that return false — always return true.
    conn.addHandler(
      function (stanza) {
        if (stanza.nodeName === 'message' && stanza.getAttribute('type') === 'groupchat') {
          const body = bodyOf(stanza);
          if (body) cbs.onMessage({ nick: nickOf(stanza.getAttribute('from') || ''), body: body });
        }
        return true;
      },
      null, null, null, null, null
    );

    conn.addHandler(
      function (stanza) {
        if (stanza.nodeName !== 'presence') return true;
        const from = stanza.getAttribute('from') || '';
        if (!from.includes('@')) return true;
        cbs.onRoomOccupant(nickOf(from), stanza.getAttribute('type') !== 'unavailable');
        return true;
      },
      null, null, null, null, null
    );
  };

  // Initial bare presence — required before any other stanza.
  XmppClient.prototype.sendPresence = function () {
    if (this.conn) this.conn.send($pres().tree());
  };

  XmppClient.prototype.joinRoom = function (roomJid, nick) {
    if (this.conn) this.conn.send($pres({ to: roomJid + '/' + nick }).c('x', { xmlns: 'http://jabber.org/protocol/muc' }).tree());
  };

  XmppClient.prototype.leaveRoom = function (roomJid, nick) {
    if (this.conn) this.conn.send($pres({ to: roomJid + '/' + nick, type: 'unavailable' }).tree());
  };

  XmppClient.prototype.sendText = function (roomJid, text) {
    if (this.conn) this.conn.send($msg({ to: roomJid, type: 'groupchat' }).c('body').t(text).tree());
  };

  XmppClient.prototype.close = function () {
    if (!this.conn) return;
    this.closing = true;
    try {
      this.conn.disconnect();
    } finally {
      this.conn = null;
    }
  };

  // ---------------- state ----------------

  const state = {
    phase: 'intro', // 'intro' | 'starting' | 'chat' | 'error'
    errorText: '',
    name: '',
    groups: [],
    groupsLoaded: false,
    groupsError: null,
    group: null, // {id, name} — resolved for pre-configured mode on load
    session: null, // {user, password, room, service, roomJid, client, sent, started}
    unread: 0,
    panelOpen: false,
  };

  // ---------------- DOM ----------------

  const style = el('style');
  style.id = 'openplaud-bubble-style';
  style.textContent = `
.opcb-fab { position: fixed; right: 24px; bottom: 24px; width: 56px; height: 56px; border: 0; border-radius: 50%; background: #4f46e5; color: #fff; box-shadow: 0 8px 24px rgba(79, 70, 229, .4); cursor: pointer; z-index: 2147483000; display: flex; align-items: center; justify-content: center; }
.opcb-fab:hover { background: #4338ca; }
.opcb-fab svg { width: 26px; height: 26px; }
.opcb-badge { position: absolute; top: -6px; right: -6px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; background: #dc2626; color: #fff; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.opcb-badge[hidden] { display: none; }
.opcb-panel { position: fixed; right: 24px; bottom: 24px; width: 380px; max-width: calc(100vw - 48px); height: min(640px, calc(100vh - 48px)); display: flex; flex-direction: column; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 24px 60px rgba(15, 23, 42, .18); overflow: hidden; z-index: 2147483000; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1e293b; font-size: 14px; }
.opcb-panel[hidden] { display: none; }
.opcb-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #4f46e5; color: #fff; flex-shrink: 0; }
.opcb-brand { font-weight: 600; font-size: 14px; }
.opcb-sub { font-size: 12px; opacity: .85; }
.opcb-header .spacer { flex: 1; }
.opcb-status { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.opcb-dot { width: 9px; height: 9px; border-radius: 50%; background: #94a3b8; }
.opcb-dot.ok { background: #22c55e; }
.opcb-dot.warn { background: #f59e0b; }
.opcb-dot.err { background: #ef4444; }
.opcb-close { border: 0; background: transparent; color: #fff; font-size: 22px; line-height: 1; cursor: pointer; padding: 2px 6px; }
.opcb-body { flex: 1; min-height: 0; overflow: hidden; padding: 16px; display: flex; flex-direction: column; gap: 12px; background: #f8fafc; }
.opcb-label { font-weight: 600; font-size: 12px; color: #475569; margin-bottom: 4px; display: block; }
.opcb-input, .opcb-select { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px; padding: 9px 10px; font-size: 14px; background: #fff; }
.opcb-input:focus, .opcb-select:focus { outline: 2px solid #a5b4fc; border-color: #6366f1; }
.opcb-group-static { border: 1px dashed #cbd5e1; border-radius: 8px; padding: 9px 10px; font-size: 13px; color: #475569; background: #fff; }
.opcb-hint { font-size: 12px; color: #64748b; }
.opcb-btn { border: 0; border-radius: 8px; padding: 10px 16px; font-size: 14px; font-weight: 600; cursor: pointer; background: #4f46e5; color: #fff; }
.opcb-btn:hover { background: #4338ca; }
.opcb-btn:disabled { opacity: .55; cursor: default; }
.opcb-btn-ghost { background: transparent; color: #4f46e5; text-decoration: underline; padding: 2px 4px; font-size: 12px; }
.opcb-starting { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px; color: #475569; font-size: 13px; }
.opcb-spin { width: 28px; height: 28px; border: 3px solid #e0e7ff; border-top-color: #4f46e5; border-radius: 50%; animation: opcb-spin 0.9s linear infinite; }
@keyframes opcb-spin { to { transform: rotate(360deg); } }
.opcb-error-box { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.opcb-error-msg { color: #b91c1c; font-size: 13px; }
.opcb-msgs { display: flex; flex-direction: column; gap: 8px; }
.opcb-msg { max-width: 82%; padding: 8px 12px; border-radius: 12px; white-space: pre-wrap; word-break: break-word; line-height: 1.35; }
.opcb-msg.me { align-self: flex-end; background: #e0e7ff; color: #312e81; border-bottom-right-radius: 4px; }
.opcb-msg.them { align-self: flex-start; background: #fff; border: 1px solid #e2e8f0; color: #1e293b; border-bottom-left-radius: 4px; }
.opcb-msg.sys { align-self: center; background: transparent; color: #64748b; font-size: 12px; padding: 2px 0; }
.opcb-nick { display: block; font-size: 11px; color: #64748b; margin-bottom: 2px; }
.opcb-composer { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e2e8f0; background: #fff; flex-shrink: 0; }
.opcb-composer .opcb-input { flex: 1; }
.opcb-end { align-self: center; color: #4f46e5; font-size: 12px; text-decoration: underline; cursor: pointer; background: none; border: 0; padding: 4px; flex-shrink: 0; }
.opcb-scroll { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; overflow-y: auto; padding-right: 16px; }
.opcb-scroll > .opcb-hint { margin-top: auto; }
`;

  const fab = el('button', 'opcb-fab');
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Open support chat');
  fab.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  const badge = el('span', 'opcb-badge', '0');
  badge.hidden = true;
  fab.appendChild(badge);

  const panel = el('div', 'opcb-panel');
  panel.hidden = true;
  const header = el('div', 'opcb-header');
  const brand = el('div');
  const brandTop = el('div', 'opcb-brand', 'OpenPlaud');
  brand.appendChild(brandTop);
  const sub = el('div', 'opcb-sub');
  brand.appendChild(sub);
  header.appendChild(brand);
  const statusBox = el('div', 'opcb-status');
  const dot = el('span', 'opcb-dot');
  statusBox.appendChild(dot);
  const statusText = el('span', '', 'Support');
  statusBox.appendChild(statusText);
  header.appendChild(statusBox);
  header.appendChild(el('div', 'spacer'));
  const closeBtn = el('button', 'opcb-close', '\u00d7');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Minimize chat');
  header.appendChild(closeBtn);

  const body = el('div', 'opcb-body');
  const composerWrap = el('div', 'opcb-composer');
  const input = el('input', 'opcb-input');
  input.type = 'text';
  input.placeholder = 'Type a message';
  const sendBtn = el('button', 'opcb-btn', 'Send');
  sendBtn.type = 'button';
  composerWrap.appendChild(input);
  composerWrap.appendChild(sendBtn);

  panel.appendChild(header);
  panel.appendChild(body);
  let msgsNode = null;
  let hintNode = null;
  let scrollNode = null;

  function buildChatView() {
    body.innerHTML = '';
    scrollNode = el('div', 'opcb-scroll');
    hintNode = el('div', 'opcb-hint', "Support will see this conversation as soon as you send your first message.");
    msgsNode = el('div', 'opcb-msgs');
    scrollNode.appendChild(hintNode);
    scrollNode.appendChild(msgsNode);
    body.appendChild(scrollNode);
    body.appendChild(composerWrap);
    const endBtn = el('button', 'opcb-end', 'End chat');
    endBtn.type = 'button';
    endBtn.addEventListener('click', endChat);
    body.appendChild(endBtn);
  }

  function setView(view) {
    body.innerHTML = '';
    msgsNode = null;
    hintNode = null;
    if (composerWrap.parentNode) composerWrap.parentNode.removeChild(composerWrap);
    if (view === 'chat') {
      buildChatView();
      return;
    }
    if (view === 'starting') {
      const box = el('div', 'opcb-starting');
      box.appendChild(el('div', 'opcb-spin'));
      box.appendChild(el('div', '', 'Connecting to support…'));
      body.appendChild(box);
      return;
    }
    if (view === 'error') {
      const box = el('div', 'opcb-error-box');
      box.appendChild(el('div', 'opcb-error-msg', state.errorText));
      const retry = el('button', 'opcb-btn', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', retrySubmit);
      body.appendChild(box);
      body.appendChild(retry);
      return;
    }
    // intro
    const nameLabel = el('label', 'opcb-label', 'Your name');
    const nameInput = el('input', 'opcb-input');
    nameInput.type = 'text';
    nameInput.value = state.name;
    nameInput.maxLength = 60;
    const groupLabel = el('label', 'opcb-label', 'Support group');
    let groupNode;
    if (cfg.operatorGroup) {
      groupNode = el('div', 'opcb-group-static', state.group ? state.group.name : 'Configured group');
    } else {
      groupNode = el('select', 'opcb-select');
      if (state.groups.length === 0) {
        const o = el('option', '', state.groupsError ? 'Could not load groups' : 'Loading groups…');
        o.disabled = true;
        o.selected = true;
        groupNode.appendChild(o);
      } else {
        state.groups.forEach((g) => {
          const o = el('option', '', g.name);
          o.value = g.id;
          o.selected = state.group ? state.group.id === g.id : false;
          groupNode.appendChild(o);
        });
      }
      if (state.groupsError) {
        const retry = el('button', 'opcb-btn-ghost', 'Retry loading groups');
        retry.type = 'button';
        retry.addEventListener('click', loadGroups);
        groupLabel.appendChild(document.createTextNode(' '));
        groupLabel.appendChild(retry);
      }
      groupNode.addEventListener('change', () => {
        const g = state.groups.find((x) => x.id === groupNode.value);
        state.group = g ? { id: g.id, name: g.name } : null;
      });
    }
    const submit = el('button', 'opcb-btn', 'Start chat');
    submit.type = 'button';
    submit.style.marginTop = '8px';
    submit.addEventListener('click', submitIntro);
    const note = el('div', 'opcb-hint', 'A support agent from the selected group will join once you send your first message.');
    body.appendChild(nameLabel);
    body.appendChild(nameInput);
    body.appendChild(groupLabel);
    body.appendChild(groupNode);
    body.appendChild(submit);
    body.appendChild(note);
    state.nameInput = nameInput;
  }

  function setDot(cls) {
    dot.className = 'opcb-dot' + (cls ? ' ' + cls : '');
  }

  function refreshHeader() {
    sub.textContent = state.group ? state.group.name : 'Support';
  }

  function refreshBadge() {
    badge.textContent = String(state.unread);
    badge.hidden = state.unread === 0;
  }

  function appendMessage(kind, text, nick) {
    if (!msgsNode) return;
    if (kind === 'sys') {
      const row = el('div', 'opcb-msg sys', text);
      msgsNode.appendChild(row);
    } else if (kind === 'me') {
      const row = el('div', 'opcb-msg me', text);
      msgsNode.appendChild(row);
    } else {
      const row = el('div', 'opcb-msg them');
      const n = el('span', 'opcb-nick', nick || 'Support');
      row.appendChild(n);
      const t = el('span', '', text);
      row.appendChild(t);
      msgsNode.appendChild(row);
    }
    if (scrollNode) scrollNode.scrollTop = scrollNode.scrollHeight;
    if (!state.panelOpen && kind !== 'me') {
      state.unread += 1;
      refreshBadge();
    }
  }

  // ---------------- phases / actions ----------------

  let pendingName = '';
  let pendingGroup = null;

  async function submitIntro() {
    const nameInput = state.nameInput;
    const name = (nameInput ? nameInput.value : '').trim();
    if (!name) return;
    let group = state.group;
    if (!cfg.operatorGroup && !group) return;
    state.name = name;
    pendingName = name;
    pendingGroup = group ? group.id : cfg.operatorGroup;
    state.errorText = '';
    setView('starting');
    try {
      const user = uuid();
      const [customer, roomInfo] = await Promise.all([
        api.post('/customers', { user: user, name: name }),
        api.post('/chatroom', { user: user, name: name, groupId: pendingGroup }),
      ]);
      const room = roomInfo.room;
      const service = roomInfo.service || cfg.xmppService;
      const client = new XmppClient(customer.user, customer.password, cfg.xmppDomain, cfg.xmppUrl, 'client', {
        onPhase: (p) => {
          if (state.session && state.session.user === customer.user) handlePhase(p, client);
        },
        onMessage: (m) => {
          if (state.session && state.session.user === customer.user) handleMessage(m);
        },
        onRoomOccupant: (nick, available) => {
          if (state.session && state.session.user === customer.user) handleOccupant(nick, available);
        },
      });
      state.session = {
        user: customer.user,
        password: customer.password,
        room: room,
        service: service,
        roomJid: room + '@' + service,
        client: client,
        sent: false,
        started: false,
      };
      client.connect();
    } catch (err) {
      state.session = null;
      state.errorText =
        err instanceof ApiError
          ? err.message + (err.status === 409 ? ' (409)' : '')
          : 'Something went wrong starting the chat. Please try again.';
      setView('error');
    }
  }

  async function retrySubmit() {
    // Fresh UUID + fresh temp account on retry.
    state.errorText = '';
    setView('starting');
    try {
      const user = uuid();
      const [customer, roomInfo] = await Promise.all([
        api.post('/customers', { user: user, name: pendingName }),
        api.post('/chatroom', { user: user, name: pendingName, groupId: pendingGroup }),
      ]);
      const room = roomInfo.room;
      const service = roomInfo.service || cfg.xmppService;
      const client = new XmppClient(customer.user, customer.password, cfg.xmppDomain, cfg.xmppUrl, 'client', {
        onPhase: (p) => {
          if (state.session && state.session.user === customer.user) handlePhase(p, client);
        },
        onMessage: (m) => {
          if (state.session && state.session.user === customer.user) handleMessage(m);
        },
        onRoomOccupant: (nick, available) => {
          if (state.session && state.session.user === customer.user) handleOccupant(nick, available);
        },
      });
      state.session = {
        user: customer.user,
        password: customer.password,
        room: room,
        service: service,
        roomJid: room + '@' + service,
        client: client,
        sent: false,
        started: false,
      };
      client.connect();
    } catch (err) {
      state.session = null;
      state.errorText =
        err instanceof ApiError ? err.message : 'Something went wrong starting the chat. Please try again.';
      setView('error');
    }
  }

  function handlePhase(p, client) {
    if (p === 'connecting') {
      setView('starting');
      setDot('');
      statusText.textContent = 'Connecting…';
      return;
    }
    if (p === 'connected') {
      client.sendPresence();
      client.joinRoom(state.session.roomJid, state.name);
      const was = state.session.started;
      state.session.started = true;
      setView('chat');
      setDot('ok');
      statusText.textContent = 'Connected';
      if (was) appendMessage('sys', 'Reconnected to support.');
      return;
    }
    if (p === 'reconnecting') {
      setDot('warn');
      statusText.textContent = 'Reconnecting…';
      if (state.session.started) {
        setView('chat');
      }
      return;
    }
    if (p === 'failed') {
      state.session = null;
      setDot('err');
      statusText.textContent = 'Offline';
      state.errorText = 'We could not connect to support. Please try again.';
      setView('error');
    }
  }

  function handleMessage(m) {
    if (m.nick === state.name) return; // our own MUC echo — already appended locally
    appendMessage('them', m.body, m.nick);
  }

  function handleOccupant(nick, available) {
    if (nick === state.name) return;
    if (!state.session || !state.session.started) return;
    if (available) appendMessage('sys', (nick || 'A support agent') + ' joined the conversation.');
    else appendMessage('sys', (nick || 'A support agent') + ' left the conversation.');
  }

  function sendMessage() {
    const s = state.session;
    const text = input.value.trim();
    if (!s || !text) return;
    input.value = '';
    appendMessage('me', text);
    s.client.sendText(s.roomJid, text);
    if (!s.sent) {
      s.sent = true;
      if (hintNode && hintNode.parentNode) hintNode.parentNode.removeChild(hintNode);
    }
  }

  function endChat() {
    const s = state.session;
    if (s) {
      s.client.leaveRoom(s.roomJid, state.name);
      s.client.close();
      api.del('/customers/' + s.user).catch(() => {}); // best-effort temp-account cleanup
    }
    state.session = null;
    setDot('');
    statusText.textContent = 'Support';
    setView('intro');
  }

  function openPanel() {
    state.panelOpen = true;
    panel.hidden = false;
    fab.hidden = true;
    state.unread = 0;
    refreshBadge();
    if (state.phase === 'chat') input.focus();
  }

  function closePanel() {
    state.panelOpen = false;
    panel.hidden = true;
    fab.hidden = false;
  }

  // ---------------- groups ----------------

  async function loadGroups() {
    state.groupsLoaded = false;
    try {
      const groups = await api.get('/groups');
      state.groups = Array.isArray(groups) ? groups : [];
      state.groupsError = null;
      if (cfg.operatorGroup) {
        const g = state.groups.find((x) => x.id === cfg.operatorGroup);
        state.group = g ? { id: g.id, name: g.name } : { id: cfg.operatorGroup, name: 'Configured group' };
      }
    } catch (err) {
      state.groupsError = err instanceof ApiError ? err.message : 'Could not load groups.';
    }
    state.groupsLoaded = true;
    refreshHeader();
    if (!state.panelOpen || state.phase === 'intro') setView('intro');
  }

  // ---------------- init / teardown ----------------

  function destroy() {
    if (state.session) {
      state.session.client.close();
      state.session = null;
    }
    document.body.removeChild(fab);
    document.body.removeChild(panel);
    if (document.head) document.head.removeChild(style);
    window.__OPENPLAUD_BUBBLE_LOADED__ = false;
  }

  window.OpenPlaud = {
    open: openPanel,
    close: closePanel,
    destroy,
    get state() {
      return state;
    },
  };

  function init() {
    document.head.appendChild(style);
    document.body.appendChild(fab);
    document.body.appendChild(panel);
    fab.addEventListener('click', openPanel);
    closeBtn.addEventListener('click', closePanel);
    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
    setView('intro');
    loadGroups();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
