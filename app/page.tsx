import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Pre-configured group' };

export default function Home() {
  return (
    <main className="page">
      <h1>Acme Widgets</h1>
      <p className="lead">
        This page mimics a real customer website that has embedded the OpenPlaud support chat
        bubble. The support group is <strong>pre-configured</strong> in the embed, so the
        visitor only enters their name to start chatting.
      </p>

      <div className="card mb-4">
        <div className="card-body">
          <h2 className="h5">How this demo is wired</h2>
          <ul>
            <li>
              The bubble is a single self-contained file, embedded as{' '}
              <code>
                {'<script src="/openplaud.js" data-operator-group="…" data-api-base="/api/proxy"></script>'}
              </code>
              , with no other assets or framework code.
            </li>
            <li>
              The group below resolves through <code>GET /api/proxy/groups</code> to
              “Backend Support Team”.
            </li>
            <li>
              On submit a random UUID is generated, a temporary customer account and a
              temporary MUC room are created through the proxy, and the visitor connects over
              the XMPP websocket.
            </li>
            <li>
              The conversation becomes visible to operators only after the visitor sends
              their <strong>first message</strong>.
            </li>
            <li>
              “End chat” deletes the temporary customer account (best-effort) and returns to
              the form.
            </li>
          </ul>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <h2 className="h5">Handcrafted widgets, made to order</h2>
          <p>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent vitae
            dignissim justo id, convallis magna. Sed at libero sed massa, euismod non
            luctus massa. Vivamus porttitor, dui euismod tempor non, nunc.
          </p>
          <p>
            Cras in dapibus dui, at convallis magna. Integer quis pharetra dui, euismod
            tempor non, nunc. Duis at libero sed massa, euismod non luctus massa.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <h2 className="h5">Support</h2>
          <p>
            Open the chat from the blue button in the bottom-right corner. Enter your name
            and press “Start chat” — the group is already configured.
          </p>
        </div>
      </div>

      <script
        src="/openplaud.js"
        defer
        data-operator-group="18c4c671-9ced-454b-b7ce-a5eb333b331e"
        data-api-base="/api/proxy"
      />
    </main>
  );
}
