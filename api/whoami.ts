export const config = { runtime: 'edge' };

export default function handler() {
  const info = {
    ok: true,
    env: process.env.VERCEL_ENV || "unknown",
    region: (globalThis as any).EdgeRuntime ? "edge" : "serverless",
    commit: process.env.VERCEL_GIT_COMMIT_SHA || "n/a",
    project: process.env.VERCEL_PROJECT_PRODUCTION_URL || "n/a",
    now: Date.now()
  };
  return new Response(JSON.stringify(info), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
