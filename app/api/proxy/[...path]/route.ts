/**
 * Server-side API proxy (same convention as openplaud-fed-admin and
 * openplaud-fed-operator): the browser talks to /api/proxy, the real
 * backend URL (API_BASE_URL) is read server-side and never ships to the
 * client bundle.
 *
 * Needed for now because the OpenPlaud admin API does not send CORS
 * headers; the chat bubble's `apiBase` config can point here (relative)
 * or straight at the API once CORS is enabled on the server.
 *
 * Only the public customer-facing roots are forwarded:
 * - /customers  (temporary customer account create/delete)
 * - /chatroom   (temporary MUC room creation)
 * - /groups     (operator group list, for the drop-down)
 *
 * Next 16: route `params` is a Promise.
 */
import { NextResponse, type NextRequest } from 'next/server';

const ALLOWED_ROOTS = new Set(['customers', 'chatroom', 'groups']);

async function forward(req: NextRequest, segs: string[]): Promise<NextResponse> {
  const root = segs[0];
  if (!ALLOWED_ROOTS.has(root)) {
    return NextResponse.json(
      { status: 404, error: 'not_found', message: 'Root not proxied' },
      { status: 404 }
    );
  }

  const url = `${process.env.API_BASE_URL}/${segs.join('/')}`;
  const headers = new Headers();
  const text = await req.text();
  if (text.length > 0) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Accept', 'application/json');

  const upstream = await fetch(url, {
    method: req.method,
    headers,
    body: text.length > 0 ? text : undefined,
    redirect: 'manual',
  }).catch(() => null);

  if (!upstream) {
    return NextResponse.json(
      { status: 502, error: 'bad_gateway', message: 'OpenPlaud API is not reachable' },
      { status: 502 }
    );
  }

  // 204 carries no body — the Response constructor rejects one.
  if (upstream.status === 204) {
    return new Response(null, { status: upstream.status });
  }

  const bodyText = await upstream.text();
  const res = new NextResponse(bodyText, {
    status: upstream.status,
    statusText: upstream.statusText,
  });
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.headers.set('content-type', contentType);
  return res;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return forward(req, path);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return forward(req, path);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return forward(req, path);
}
