# openplaud-fed-client

Customer side of the OpenPlaud platform: an embeddable **chat bubble** that any website can
add with a single script tag. The customer enters a name (and picks a support group when
one isn't pre-configured), gets a temporary XMPP account and a temporary MUC room, and
chats — the operator side only sees the conversation once the customer sends their
**first message**.

It is one of three parts of the OpenPlaud system:

| Repo | Role |
| --- | --- |
| `openplaud-srv-admin` | Kotlin REST API (`http://localhost:8080/api/v1`) + ejabberd 26.9 |
| `openplaud-fed-operator` | Operator web console |
| `openplaud-fed-client` (this repo) | Customer chat bubble + the two demo pages |

## Stack

- **React 19** + **Next.js 16.4.3** (App Router, TypeScript) — demo pages only
- **Bootstrap 5.3.8** — plain Bootstrap, no Tailwind (mirrors the operator conventions)
- **Strophe.js 5.0.0** — inlined into the bubble so it stays a single file
- `strophe-test/` — self-contained Node dev harness for XMPP stanza flows (own package.json, not part of the app)

## The bubble: `public/openplaud.js`

`scripts/build-bubble.mjs` concatenates the minified Strophe UMD (which sets
`globalThis.Strophe` as a plain script) and `bubble/openplaud.js` into one self-contained
file: no imports, no other assets, no framework. The generated file is committed — it is
the embeddable artifact.

Embed on any website:

```html
<!-- group pre-configured: the customer only enters their name -->
<script src="/openplaud.js" data-operator-group="<group uuid>" data-api-base="/api/proxy"></script>

<!-- group not pre-configured: the customer picks it from a drop-down -->
<script src="/openplaud.js" data-api-base="/api/proxy"></script>
```

Config comes from the script tag's `data-*` attributes, falling back to
`window.OPENPLAUD_CONFIG`, falling back to defaults:

| Key | Default | Meaning |
| --- | --- | --- |
| `apiBase` | `http://localhost:8080/api/v1` | Base URL of the OpenPlaud API |
| `operatorGroup` | *(unset → drop-down mode)* | Pre-configured support group UUID |
| `xmppUrl` | `ws://localhost:5280/websocket` | ejabberd websocket endpoint |
| `xmppDomain` | `localhost` | XMPP domain for the temp account JID |
| `xmppService` | `conference` | MUC service (used when the room reply omits it) |

Public API on `window.OpenPlaud`: `open()`, `close()`, `destroy()`, `state`.

## How it works

1. **Intro** — name + (when not pre-configured) a group drop-down fed by
   `GET /groups`. The group line on the pre-configured page resolves via
   `GET /groups` too, so the group *name* is shown.
2. **Submit** — `crypto.randomUUID()` (with a `getRandomValues` fallback for
   non-secure contexts), then in parallel:
   - `POST /customers {user, name}` → temp customer XMPP account `{user, name, password}`
   - `POST /chatroom {user, name, groupId}` → temp MUC room `{room, service}`
3. **Connect** — Strophe over the native WebSocket as `<uuid>@<domain>/client`. On
   `CONNECTED`: a **bare presence first** (later stanzas fail with
   `not-authorized` without it), then the MUC join — presence to
   `room@service/<Name>` carrying an empty
   `<x xmlns="http://jabber.org/protocol/muc"/>`.
4. **Chat** — groupchat messages only. The operator side sees the conversation only
   after the customer's first message (server-side MucSub on the custom ejabberd
   build). The bubble shows a hint until the first send. The customer's own MUC echo
   is filtered by nick and ignored (the local optimistic append is kept).
5. **End chat** — MUC leave + WebSocket close, and best-effort
   `DELETE /customers/{user}` so the temp account is cleaned up; the UI returns
   to the intro form.

## API proxy (for now)

The admin API currently sends **no CORS headers**, so the demo pages point the bubble at
this app's same-origin proxy: `data-api-base="/api/proxy"`. The proxy
(`app/api/proxy/[...path]/route.ts`, same convention as admin/operator) forwards only
the public customer-facing roots — `customers`, `chatroom`, `groups` — and reads
`API_BASE_URL` server-side (`.env.local` / `.env.example`), so it never ships to the
browser. When CORS is enabled on the API, just change `apiBase` to the API URL —
no code change in the bubble.

`/customers` contract (verified against the live API): `POST` takes
`{user, name}` (an optional `password` superset field is accepted; the bubble omits
it and lets the server generate) and returns `{user, name, password}` — the password
is one-time. `DELETE /customers/{customerId}` returns **204**.

## Demo pages

Two fake host websites exercise both embedding modes:

- `/` — group pre-configured to `18c4c671-9ced-454b-b7ce-a5eb333b331e`
  (“Backend Support Team”)
- `/select` — no `data-operator-group`; the group drop-down is used

## Build

```sh
npm install
npm run build:bubble   # regenerate public/openplaud.js
npm run dev            # builds the bubble, then next dev (port 3000)
npm run build          # bubble + next build
npm run lint
```
# openplaud-fed-client
