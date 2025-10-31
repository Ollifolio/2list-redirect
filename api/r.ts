// /api/r.ts — Vanilla Vercel Edge Function
export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const target = url.searchParams.get('u');

    // Wenn kein Parameter übergeben wurde
    if (!target) {
      return new Response('Missing parameter: ?u=', {
        status: 400,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Kleine Sicherheit: Nur gültige URLs erlauben
    let redirectURL: URL;
    try {
      redirectURL = new URL(target);
    } catch {
      return new Response('Invalid URL format', {
        status: 400,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Log für Vercel-Dashboard (optional)
    console.log('Redirecting to:', redirectURL.href);

    // 302 Weiterleitung (temporär)
    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectURL.href,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response('Internal Error', { status: 500 });
  }
}
