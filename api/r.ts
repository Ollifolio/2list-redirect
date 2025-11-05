// /api/r.ts — 2List Redirect (Edge, Allowlist, Shortlink-Expand, Logging)
export const config = { runtime: 'edge' };

type AwinConfig   = { network: 'awin'; mid: string };
type CjConfig     = { network: 'cj' };
type AmazonConfig = { network: 'amazon' };
type ShopConfig   = AwinConfig | CjConfig | AmazonConfig;

// ✅ Vendor-Gruppen (robuster als Einzeldomains)
const AMAZON_HOSTS = new Set([
  'amazon.de', 'www.amazon.de',
  'amzn.to', 'www.amzn.to',
  'amzn.eu', 'www.amzn.eu',
]);

// ✅ Allowlist: benannte Partner-Shops (Affiliate), Rest wird clean durchgelassen
const SHOPS: Record<string, ShopConfig> = {
  // FASHION (AWIN)
  'zalando.de':   { network: 'awin', mid: 'XXXX' },
  'hm.com':       { network: 'awin', mid: 'XXXX' },
  'aboutyou.de':  { network: 'awin', mid: 'XXXX' },

  // ✅ AMAZGIFTS (AWIN)
  'amazgifts.de': { network: 'awin', mid: '87569' },

  // HOME (CJ)
  'ikea.com':     { network: 'cj' },
  'home24.de':    { network: 'cj' },

  // AMAZON (Vendor-Gruppe über Funktion abgedeckt)
  'amazon.de':    { network: 'amazon' },
};

// 🔐 ENV
const ENV = ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
const AWIN_AFFILIATE_ID = ENV.AWIN_AFFILIATE_ID ?? ''; // z.B. 2638306
const CJ_PID            = ENV.CJ_PID ?? '';
const AMAZON_TAG        = ENV.AMAZON_TAG ?? '';
const ENABLE_LOGS       = (ENV.ENABLE_LOGS ?? '').toLowerCase() === 'true';
const LOG_WEBHOOK       = ENV.LOG_WEBHOOK ?? '';

// 🧰 Utils
const isoNow = () => { try { return new Date().toISOString(); } catch { return '' } };
const host = (u: URL) => u.hostname.toLowerCase();

// 🔁 Fallback-URL
function makeFallback(base: URL, reason: string, extra?: Record<string, string>) {
  const u = new URL('/api/error', base);
  u.searchParams.set('reason', reason);
  if (extra) for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

// 🔗 UTM
function withUtm(u: URL): URL {
  const copy = new URL(u);
  if (!copy.searchParams.has('utm_source')) copy.searchParams.set('utm_source', '2list');
  if (!copy.searchParams.has('utm_medium')) copy.searchParams.set('utm_medium', 'app');
  return copy;
}

// 💰 Affiliate-Link
function buildAffiliateUrl(target: URL, cfg: ShopConfig): string {
  const clean = withUtm(new URL(target));

  if (cfg.network === 'awin' && 'mid' in cfg) {
    if (!cfg.mid || !AWIN_AFFILIATE_ID) return clean.toString();
    const encoded = encodeURIComponent(clean.toString());
    return `https://www.awin1.com/cread.php?awinmid=${cfg.mid}&awinaffid=${AWIN_AFFILIATE_ID}&ued=${encoded}`;
  }

  if (cfg.network === 'cj') {
    if (!CJ_PID) return clean.toString();
    const encoded = encodeURIComponent(clean.toString());
    // TODO: advertiser-spezifische CJ-ID (statt 1234567) setzen
    return `https://www.anrdoezrs.net/click-${CJ_PID}-1234567?url=${encoded}`;
  }

  // cfg.network === 'amazon'
  if (!AMAZON_TAG) return clean.toString();
  clean.searchParams.set('tag', AMAZON_TAG);
  return clean.toString();
}

// 🧱 JSON-Fehler
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

// 📝 Logging
async function logEvent(event: Record<string, unknown>) {
  const payload = { ts: isoNow(), app: '2list', ...event };
  if (ENABLE_LOGS) { try { console.log(JSON.stringify(payload)); } catch {} }
  if (LOG_WEBHOOK) {
    try {
      const res = await fetch(LOG_WEBHOOK, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (ENABLE_LOGS) console.log(JSON.stringify({ ts: isoNow(), app: '2list', level: 'debug', evt: 'log_webhook_result', status: res.status }));
    } catch {
      if (ENABLE_LOGS) console.log(JSON.stringify({ ts: isoNow(), app: '2list', level: 'error', evt: 'log_webhook_failed' }));
    }
  }
}

// 🔍 AMAZON: akz. amazon.de direkt ODER expandiere amzn.*
function isAmazonHost(h: string) {
  return AMAZON_HOSTS.has(h) || h.endsWith('.amazon.de');
}

// 🔎 Kurzlinks expandieren (max. 5 Hops, ohne Auto-Follow)
async function expandIfShortener(u: URL): Promise<URL> {
  const h = host(u);
  if (!AMAZON_HOSTS.has(h)) return u; // nur bekannte Amazon-Shortener
  let current = u;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(current.toString(), { method: 'GET', redirect: 'manual' });
    const loc = res.headers.get('location');
    if (!loc) break;
    const next = new URL(loc, current);
    current = next;
    if (host(current).endsWith('.amazon.de') || host(current) === 'amazon.de') break;
  }
  return current;
}

// 🔎 Allowlist prüfen (inkl. Amazon-Vendor-Gruppe)
function findShopConfig(url: URL): ShopConfig | null {
  const h = host(url);
  if (h === 'amazon.de' || h.endsWith('.amazon.de')) return { network: 'amazon' };
  for (const domain of Object.keys(SHOPS)) {
    if (h === domain || h.endsWith(`.${domain}`)) return SHOPS[domain];
  }
  return null;
}

// 🚦 Handler
export default async function handler(req: Request): Promise<Response> {
  const here = new URL(req.url);
  const raw = here.searchParams.get('u');
  const albumId = here.searchParams.get('a') || '';
  const ua = req.headers.get('user-agent') || '';
  const prefersJson = (req.headers.get('accept') || '').includes('application/json');

  if (!raw) {
    await logEvent({ level: 'warn', evt: 'redirect_missing_u', albumId, ua });
    return prefersJson ? jsonError(400, 'Missing query parameter: u') : Response.redirect(makeFallback(here, 'missing_u'), 302);
  }

  let target: URL;
  try { target = new URL(raw); }
  catch {
    await logEvent({ level: 'warn', evt: 'redirect_invalid_url', albumId, ua, u: raw });
    return prefersJson ? jsonError(400, 'Invalid URL in parameter u') : Response.redirect(makeFallback(here, 'invalid_url'), 302);
  }

  const protocol = target.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    await logEvent({ level: 'warn', evt: 'redirect_bad_protocol', albumId, ua, protocol, host: host(target) });
    return prefersJson ? jsonError(400, 'Only http/https protocols are allowed') : Response.redirect(makeFallback(here, 'bad_protocol'), 302);
  }

  // 🧩 Amazon-Kurzlink ggf. expandieren
  if (isAmazonHost(host(target)) && host(target).startsWith('amzn.')) {
    const before = target.toString();
    target = await expandIfShortener(target);
    if (ENABLE_LOGS) await logEvent({ level: 'debug', evt: 'expanded_shortlink', from: before, to: target.toString() });
  }

  // ✅ Mapping holen (Affiliate) oder clean durchlassen (Non-Affiliate)
  const shopCfg = findShopConfig(target);
  const finalUrl = shopCfg
    ? buildAffiliateUrl(target, shopCfg)
    : withUtm(new URL(target)).toString();

  // 🔎 Flag „isAffiliate“ korrekt und typesafe bestimmen
  function isAffiliateFor(cfg: ShopConfig): boolean {
    if (cfg.network === 'awin' && 'mid' in cfg) return !!(AWIN_AFFILIATE_ID && cfg.mid);
    if (cfg.network === 'cj') return !!CJ_PID;
    if (cfg.network === 'amazon') return !!AMAZON_TAG;
    return false;
  }

  const networkLog: ShopConfig['network'] | 'direct' = shopCfg ? shopCfg.network : 'direct';
  const affiliateFlag = shopCfg ? isAffiliateFor(shopCfg) : false;

  await logEvent({
    level: 'info',
    evt: 'redirect_ok',
    albumId,
    ua,
    domain: host(target),
    network: networkLog,
    isAffiliate: affiliateFlag,
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
