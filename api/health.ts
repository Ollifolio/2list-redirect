// /api/health.ts — Vercel Edge Function
export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  return new Response(
    JSON.stringify({ status: 'ok', service: '2list-redirect', version: '1.0.0' }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      }
    }
  );
}
