import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Group drop-down' };

export default function SelectPage() {
  return (
    <main className="page">
      <h1>Acme Widgets — support desk</h1>
      <p className="lead">
        Same fake host site as the other demo, but this time the support group is
        <strong> not</strong> pre-configured: the bubble loads the available groups
        through <code>GET /api/proxy/groups</code> and lets the visitor choose one from a
        drop-down.
      </p>

      <div className="card mb-4">
        <div className="card-body">
          <h2 className="h5">How this demo is wired</h2>
          <ul>
            <li>
              The embed is the same single file, but without{' '}
              <code>data-operator-group</code>:
            </li>
            <li>
              <code>{'<script src="/openplaud.js" data-api-base="/api/proxy"></script>'}</code>
            </li>
            <li>The intro form shows the group drop-down instead of a fixed group line.</li>
            <li>Everything else (temp account, temp MUC room, first-message handoff) is identical.</li>
          </ul>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <h2 className="h5">Bulk orders</h2>
          <p>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent vitae
            dignissim justo id, convallis magna. Sed at libero sed massa, euismod non
            luctus massa.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <h2 className="h5">Support</h2>
          <p>
            Open the chat from the blue button in the bottom-right corner, enter your name
            and pick a support group from the drop-down.
          </p>
        </div>
      </div>

      <script src="/openplaud.js" defer data-api-base="/api/proxy" />
    </main>
  );
}
