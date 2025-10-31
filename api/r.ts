// /api/r.ts — 2List Redirect (Edge, Allowlist, optional Logging/Webhook)
export const config = { runtime: 'edge' };

type AwinConfig   = { network: 'awin'; mid: string };
type CjConfig     = { network: 'cj' };
type AmazonConfig = { network: 'amazon' };
type ShopConfig   = AwinConfig | CjConfig | AmazonConfig;

// ✅ Allowlist der Shops (nur diese Domains sind erlaubt)
const SHOPS: Record<string, ShopConfig> = {
  // Fashion (AWIN)
  'zalando.de':   { network: 'awin',   mid: 'XXXX' },
  'hm.com':       { network: 'awin',   mid: 'XXXX' },
  'aboutyou.de':  { network: 'awin',   mid: 'XXXX' },

  // Home (CJ)
  'ikea.com':     { network: 'cj' },
  'home24.de':    { network: 'cj' },

  // Direktes Programm
  'amazon.de':    { network: 'amazon' },
};

// 🔐 ENV (Edge-sicher über globalThis)
const ENV = ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
const AWIN_AFFILIATE_ID = ENV.AWIN_AFFILIATE_ID ?? '';
const CJ_PID            = ENV.CJ_PID ?? '';
const AMAZON_TAG        = ENV.AMAZON_TAG ?? '';

const ENABLE_LOGS       = (ENV.ENABLE_LOGS ?? '').toLowerCase() === 'true'; // console logging
const LOG_WEBHOOK       = ENV.LOG_WEBHOOK ?? '';                              // optional webhook URL

// 🧰 Utils
const isoNow = () => {
  try { return new Date().toISOString(); } catch { return '' }
};

const domainOf = (u: URL | string) => {
  try { return (u instanceof URL ? u : new URL(u)).hostname.toLowerCase(); }
  catch { return '' }
};

// 🔁 Fallback-URL auf eigene /api/error-Route
function makeFallback(base: URL, reason: string, extra?: Record<string, string>) {
  const u = new URL('/api/error', base);
  u.searchParams.set('reason', reason);
  if (extra) for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

// 🔍 Domain-Matching
function findShopConfig(url: URL): ShopConfig | null {
  const host = url.hostname.toLowerCase();
  for (const domain of Object.keys(SHOPS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return SHOPS[domain];
  }
  return null;
}

// 🔗 UTM
function withUtm(u: URL): URL {
  u.searchParams.set('utm_source', '2list');
  u.searchParams.set('utm_medium', 'app');
  return u;
}

// 💰 Affiliate-Link bauen
function buildAffiliateUrl(target: URL, cfg: ShopConfig): string {
  const clean = withUtm(new URL(target)); // Kopie + UTM
  switch (cfg.network) {
    case 'awin': {
      if (!cfg.mid || !AWIN_AFFILIATE_ID) return clean.toString();
      const encoded = encodeURIComponent(clean.toString());
      return `https://www.awin1.com/cread.php?awinmid=${cfg.mid}&awinaffid=${AWIN_AFFILIATE_ID}&ued=${encoded}`;
    }
    case 'cj': {
      if (!CJ_PID) return clean.toString();
      const encoded = encodeURIComponent(clean.toString());
      return `https://www.anrdoezrs.net/click-${CJ_PID}-1234567?url=${encoded}`;
    }
    case 'amazon': {
      if (!AMAZON_TAG) return clean.toString();
      clean.searchParams.set('tag', AMAZON_TAG);
      return clean.toString();
    }
  }
}

// 🧱 JSON-Fehlerausgabe (für Tools)
function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}

// 📝 Logging (konsole + optional Webhook). Keine IP, nur technische Metadaten.
async function logEvent(event: Record<string, unknown>) {
  const payload = { ts: isoNow(), app: '2list', ...event };

  // Konsole nur wenn ENABLE_LOGS=true gesetzt ist (reduziert "noise" in prod)
  if (ENABLE_LOGS) {
    try { console.log(JSON.stringify(payload)); } catch {}
  }

  // Optional: externes Ziel (z. B. für ein kleines Dashboard)
  if (LOG_WEBHOOK) {
    try {
      await fetch(LOG_WEBHOOK, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      // still silent in prod
      if (ENABLE_LOGS) console.warn('log webhook failed');
    }
  }
}

// 🚦 Handler
export default async function handler(req: Request): Promise<Response> {
  const here = new URL(req.url);
  const raw = here.searchParams.get('u');
  const albumId = here.searchParams.get('a') || ''; // optional aus App
  const ua = req.headers.get('user-agent') || '';
  const prefersJson = (req.headers.get('accept') || '').includes('application/json');

  if (!raw) {
    await logEvent({ level: 'warn', evt: 'redirect_missing_u', albumId, ua });
    if (prefersJson) return jsonError(400, 'Missing query parameter: u');
    return Response.redirect(makeFallback(here, 'missing_u'), 302);
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    await logEvent({ level: 'warn', evt: 'redirect_invalid_url', albumId, ua, u: raw });
    if (prefersJson) return jsonError(400, 'Invalid URL in parameter u');
    return Response.redirect(makeFallback(here, 'invalid_url'), 302);
  }

  // Nur http/https
  const protocol = target.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    await logEvent({ level: 'warn', evt: 'redirect_bad_protocol', albumId, ua, protocol, host: target.hostname });
    if (prefersJson) return jsonError(400, 'Only http/https protocols are allowed');
    return Response.redirect(makeFallback(here, 'bad_protocol'), 302);
  }

  // ✅ Strikte Allowlist
  const shopCfg = findShopConfig(target);
  if (!shopCfg) {
    await logEvent({ level: 'warn', evt: 'redirect_blocked_allowlist', albumId, ua, host: target.hostname });
    if (prefersJson) return jsonError(403, `Target hostname not allowed: ${target.hostname.toLowerCase()}`);
    return Response.redirect(makeFallback(here, 'blocked', { host: target.hostname }), 302);
  }

  // Affiliate-Link (oder plain Deep-Link, falls IDs fehlen)
  const finalUrl = buildAffiliateUrl(target, shopCfg);

  await logEvent({
    level: 'info',
    evt: 'redirect_ok',
    albumId,
    ua,
    domain: domainOf(target),
    network: shopCfg.network,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: finalUrl,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
      Vary: 'Accept',
    },
  });
}
