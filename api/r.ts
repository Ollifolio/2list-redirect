// /api/r.ts — 2List Redirect (Edge, gehärtet mit Allowlist + lokalem Fallback)
export const config = { runtime: 'edge' };

type AwinConfig = { network: 'awin'; mid: string };
type CjConfig = { network: 'cj' };
type AmazonConfig = { network: 'amazon' };
type ShopConfig = AwinConfig | CjConfig | AmazonConfig;

// ✅ Allowlist der Shops (nur diese Domains sind erlaubt)
const SHOPS: Record<string, ShopConfig> = {
  // Fashion (AWIN)
  'zalando.de': { network: 'awin', mid: 'XXXX' },
  'hm.com': { network: 'awin', mid: 'XXXX' },
  'aboutyou.de': { network: 'awin', mid: 'XXXX' },

  // Home (CJ)
  'ikea.com': { network: 'cj' },
  'home24.de': { network: 'cj' },

  // Direktes Programm
  'amazon.de': { network: 'amazon' },
};

// 🔐 IDs aus Env (Vercel → Settings → Environment Variables)
const AWIN_AFFILIATE_ID = process.env.AWIN_AFFILIATE_ID || '';
const CJ_PID = process.env.CJ_PID || '';
const AMAZON_TAG = process.env.AMAZON_TAG || '';

// 🔁 Fallback-URL dynamisch auf eigene /api/error-Route bauen
function makeFallback(base: URL, reason: string, extra?: Record<string, string>) {
  const u = new URL('/api/error', base);
  u.searchParams.set('reason', reason);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  }
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

// 🔗 Tracking hinzufügen
function withUtm(u: URL): URL {
  u.searchParams.set('utm_source', '2list');
  u.searchParams.set('utm_medium', 'app');
  return u;
}

// 💰 Affiliate-Link konstruieren
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
    },
  });
}

// 🚦 Handler
export default async function handler(req: Request): Promise<Response> {
  const now = new Date().toISOString();
  const here = new URL(req.url);
  const raw = here.searchParams.get('u');
  const prefersJson = (req.headers.get('accept') || '').includes('application/json');

  if (!raw) {
    console.log(JSON.stringify({ ts: now, level: 'warn', msg: 'missing_u_param' }));
    if (prefersJson) return jsonError(400, 'Missing query parameter: u');
    return Response.redirect(makeFallback(here, 'missing_u'), 302);
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    console.log(JSON.stringify({ ts: now, level: 'warn', msg: 'invalid_url', u: raw }));
    if (prefersJson) return jsonError(400, 'Invalid URL in parameter u');
    return Response.redirect(makeFallback(here, 'invalid_url'), 302);
  }

  // Nur http/https zulassen
  const protocol = target.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    console.log(JSON.stringify({ ts: now, level: 'warn', msg: 'bad_protocol', protocol, u: String(target) }));
    if (prefersJson) return jsonError(400, 'Only http/https protocols are allowed');
    return Response.redirect(makeFallback(here, 'bad_protocol'), 302);
  }

  // ✅ Strikte Allowlist
  const shopCfg = findShopConfig(target);
  if (!shopCfg) {
    console.log(JSON.stringify({ ts: now, level: 'warn', msg: 'blocked_by_allowlist', host: target.hostname, u: String(target) }));
    if (prefersJson) return jsonError(403, `Target hostname not allowed: ${target.hostname.toLowerCase()}`);
    return Response.redirect(makeFallback(here, 'blocked', { host: target.hostname }), 302);
  }

  // Affiliate-Link (oder plain Deep-Link, falls IDs fehlen)
  const finalUrl = buildAffiliateUrl(target, shopCfg);

  console.log(JSON.stringify({
    ts: now,
    level: 'info',
    msg: 'redirect_ok',
    from: target.href,
    to: finalUrl,
    network: shopCfg.network,
    status: 302,
  }));

  return Response.redirect(finalUrl, 302);
}
