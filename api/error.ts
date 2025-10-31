// /api/error.ts — kleine Fehlerseite (Edge)
export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const reason = url.searchParams.get('reason') ?? 'unknown';
  const host = url.searchParams.get('host') ?? '';

  const acceptsJson = (req.headers.get('accept') || '').includes('application/json');

  const data = {
    ok: false,
    service: '2list-redirect',
    reason,
    host,
  };

  if (acceptsJson) {
    return new Response(JSON.stringify(data), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  // Einfaches HTML (ohne CSS), damit es überall schnell lädt
  const html = `<!doctype html>
<html lang="de"><meta charset="utf-8">
<title>2list-redirect – Hinweis</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font:16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding:24px; max-width:720px; margin:0 auto;">
  <h1>Weiterleitung nicht möglich</h1>
  <p>Dein Aufruf konnte nicht weitergeleitet werden.</p>
  <ul>
    <li><strong>Reason:</strong> ${reason}</li>
    ${host ? `<li><strong>Host:</strong> ${host}</li>` : ''}
  </ul>
  <p>Nur erlaubte Shops werden weitergeleitet. Wenn das ein Fehler ist, füge die Domain zur Allowlist hinzu.</p>
  <hr>
  <small>2list-redirect • Status: 400</small>
</body></html>`;

  return new Response(html, {
    status: 400,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
