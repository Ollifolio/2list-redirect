// /api/r.ts — 2List Redirect (Edge, MVP clean)
export const config = { runtime: 'edge' };

type AwinConfig   = { network: 'awin'; mid: string };
type CjConfig     = { network: 'cj' };
type AmazonConfig = { network: 'amazon' };
type ShopConfig   = AwinConfig | CjConfig | AmazonConfig;

// --- Domain-Gruppen
const AMAZON_HOSTS = new Set([
  'amazon.de', 'www.amazon.de',
  'amzn.to', 'www.amzn.to',
  'amzn.eu', 'www.amzn.eu',
]);

// --- Allowlist: Partner (Affiliate). Rest wird clean durchgelassen.
const SHOPS: Record<string, ShopConfig> = {
  // FASHION (AWIN)
  'zalando.de':   { network: 'awin', mid: '' },       // bis MID vorhanden
  'hm.com':       { network: 'awin', mid: '' },       // bis MID vorhanden
  'aboutyou.de':  { network: 'awin', mid: '' },       // bis MID vorhanden

  // AMAZGIFTS (AWIN)
  'amazgifts.de': { network: 'awin', mid: '87569' },

  // HOME (CJ)
  'ikea.com':     { network: 'cj' },
  'home24.de':    { network: 'cj' },

  // AMAZON
  'amazon.de':    { network: 'amazon' },
};

// --- ENV
const ENV = ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
const AWIN_AFFILIATE_ID = ENV.AWIN_AFFILIATE_ID ?? '';   // z. B. 2638306
const CJ_PID            = ENV.CJ_PID ?? '';              // optional
const AMAZON_TAG        = ENV.AMAZON_TAG ?? '';          // optional
const ENABLE_LOGS       = (ENV.ENABLE_LOGS ?? '').toLowerCase() === 'true';
const LOG_WEBHOOK       = ENV.LOG_WEBHOOK ?? '';

// --- Utils
const isoNow = () => { try { return new Date().toISOString(); } catch { return '' } };
const host = (u: URL) => u.hostname.toLowerCase();

function isValidAwinMid(mid?: string): boolean {
  return !!mid && /^[0-9]+$/.test(mid);
}

function withUtm(u: URL): URL {
  const out = new URL(u);
  if (!out.searchParams.has('utm_source')) out.searchParams.set('utm_source', '2list');
  if (!out.searchParams.has('utm_medium')) out.searchParams.set('utm_medium', 'app');
  return out;
}

// --- Affiliate-Builder
function buildAffiliateUrl(target: URL, cfg: ShopConfig): string {
  const clean = withUtm(new URL(target));
  switch (cfg.network) {
    case 'awin': {
      if (!isValidAwinMid(cfg.mid) || !AWIN_AFFILIATE_ID) return clean.toString();
      const encoded = encodeURIComponent(clean.toString());
      return `https://www.awin1.com/cread.php?awinmid=${cfg.mid}&awinaffid=${AWIN_AFFILIATE_ID}&ued=${encoded}`;
    }
    case 'cj': {
      if (!CJ_PID) return clean.toString();
      const encoded = encodeURIComponent(clean.toString());
      // TODO: advertiser-spezifische CJ-ID statt 1234567 setzen
      return `https://www.anrdoezrs.net/click-${CJ_PID}-1234567?url=${encoded}`;
    }
    case 'amazon': {
      if (!AMAZON_TAG) return clean.toString();
      clean.searchParams.set('tag', AMAZON_TAG);
      return clean.toString();
    }
  }
}

// --- Logging
async function logEvent(event: Record<string, unknown>) {
  const payload = { ts: isoNow(), app: '2list', ...event };
  if (ENABLE_LOGS) { try { console.log(JSON.stringify(payload)); } catch {} }
  if (!LOG_WEBHOOK) return;
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

// --- Amazon Shortener erkennen/expandieren
function isAmazonHost(h: string) {
  return AMAZON_HOSTS.has(h) || h.endsWith('.amazon.de');
}

async function expandIfShortener(u: URL): Promise<URL> {
  const h = host(u);
  if (!AMAZON_HOSTS.has(h)) return u;
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

// --- Mapping
function findShopConfig(url: URL): ShopConfig | null {
  const h = host(url);
  if (h === 'amazon.de' || h.endsWith('.amazon.de')) return { network: 'amazon' };
  for (const domain of Object.keys(SHOPS)) {
    if (h === domain || h.endsWith(`.${domain}`)) return SHOPS[domain];
  }
  return null; // nicht gelistet => clean redirect
}

// --- Handler
export default async function handler(req: Request): Promise<Response> {
  const here = new URL(req.url);
  const raw = here.searchParams.get('u');
  const albumId = here.searchParams.get('a') || '';
  const ua = req.headers.get('user-agent') || '';

  if (!raw) {
    await logEvent({ level: 'warn', evt: 'redirect_missing_u', albumId, ua });
    return new Response(JSON.stringify({ ok: false, error: 'Missing query parameter: u' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  let target: URL;
  try { target = new URL(raw); }
  catch {
    await logEvent({ level: 'warn', evt: 'redirect_invalid_url', albumId, ua, u: raw });
    return new Response(JSON.stringify({ ok: false, error: 'Invalid URL in parameter u' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const protocol = target.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    await logEvent({ level: 'warn', evt: 'redirect_bad_protocol', albumId, ua, protocol, host: host(target) });
    return new Response(JSON.stringify({ ok: false, error: 'Only http/https protocols are allowed' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  // Amazon Kurzlink ggf. expandieren
  if (isAmazonHost(host(target)) && host(target).startsWith('amzn.')) {
    const before = target.toString();
    target = await expandIfShortener(target);
    if (ENABLE_LOGS) await logEvent({ level: 'debug', evt: 'expanded_shortlink', from: before, to: target.toString() });
  }

  // Affiliate-Mapping oder clean
  const shopCfg = findShopConfig(target);
  const isAffiliate = !!shopCfg;
  const finalUrl = isAffiliate ? buildAffiliateUrl(target, shopCfg!) : withUtm(new URL(target)).toString();

  await logEvent({
    level: 'info',
    evt: isAffiliate ? 'redirect_ok' : 'redirect_untracked',
    albumId,
    ua,
    domain: host(target),
    isAffiliate,
    network: shopCfg?.network ?? 'none',
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
