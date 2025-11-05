// /api/r.ts — 2List Redirect (Edge, Allowlist, Shortlink-Expand, Logging)
export const config = { runtime: 'edge' };

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------
type NetworkKind = 'awin' | 'cj' | 'amazon';

type AwinInfo   = { network: 'awin'; mid: string };
type CjInfo     = { network: 'cj' };
type AmazonInfo = { network: 'amazon' };
type NetworkInfo = AwinInfo | CjInfo | AmazonInfo;

// -----------------------------------------------------------------------------
// ENV
// -----------------------------------------------------------------------------
const ENV = ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
const AWIN_AFFILIATE_ID = ENV.AWIN_AFFILIATE_ID ?? ''; // z. B. 2638306
const CJ_PID            = ENV.CJ_PID ?? '';
const AMAZON_TAG        = ENV.AMAZON_TAG ?? '';
const ENABLE_LOGS       = (ENV.ENABLE_LOGS ?? '').toLowerCase() === 'true';
const LOG_WEBHOOK       = ENV.LOG_WEBHOOK ?? '';

// -----------------------------------------------------------------------------
// CONSTANTS / VENDOR-GROUPS
// -----------------------------------------------------------------------------
const AMAZON_HOSTS = new Set([
  'amazon.de', 'www.amazon.de',
  'amzn.to',   'www.amzn.to',
  'amzn.eu',   'www.amzn.eu',
]);

// AWIN: domain -> MID
const AWIN_SHOPS: Record<string, string> = {
  // FASHION
  'zalando.de':   'XXXX',
  'hm.com':       'XXXX',
  'aboutyou.de':  'XXXX',

  // AMAZGIFTS
  'amazgifts.de': '87569',
};

// CJ: nur Domains (kein MID)
const CJ_SHOPS = new Set<string>([
  'ikea.com',
  'home24.de',
]);

// Amazon (optional in Listen – eigentliche Erkennung unten)
const AMAZON_DOMAINS = new Set<string>([
  'amazon.de',
]);

// -----------------------------------------------------------------------------
// UTILS
// -----------------------------------------------------------------------------
const isoNow = () => { try { return new Date().toISOString(); } catch { return ''; } };
const host   = (u: URL) => u.hostname.toLowerCase();

function makeFallback(base: URL, reason: string, extra?: Record<string, string>) {
  const u = new URL('/api/error', base);
  u.searchParams.set('reason', reason);
  if (extra) for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

function withUtm(u: URL): URL {
  const copy = new URL(u);
  if (!copy.searchParams.has('utm_source')) copy.searchParams.set('utm_source', '2list');
  if (!copy.searchParams.has('utm_medium')) copy.searchParams.set('utm_medium', 'app');
  return copy;
}

function isAmazonHost(h: string) {
  return AMAZON_HOSTS.has(h) || h.endsWith('.amazon.de');
}

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
    const ch = host(current);
    if (ch.endsWith('.amazon.de') || ch === 'amazon.de' || ch === 'www.amazon.de') break;
  }
  return current;
}

// -----------------------------------------------------------------------------
// NETWORK LOOKUP (radikal neu, kein ShopConfig/Union mit mid mehr)
// -----------------------------------------------------------------------------
function getNetworkInfo(h: string): NetworkInfo | null {
  // Amazon-Erkennung zuerst (Shortener, Subdomains)
  if (h === 'amazon.de' || h === 'www.amazon.de' || h.endsWith('.amazon.de')) {
    return { network: 'amazon' };
  }
  if (AMAZON_DOMAINS.has(h)) {
    return { network: 'amazon' };
  }

  // AWIN-Map (exakt oder Subdomain-Treffer)
  if (h in AWIN_SHOPS) {
    return { network: 'awin', mid: AWIN_SHOPS[h] };
  }
  // Subdomain von AWIN-Partner
  for (const d of Object.keys(AWIN_SHOPS)) {
    if (h.endsWith(`.${d}`)) {
      return { network: 'awin', mid: AWIN_SHOPS[d] };
    }
  }

  // CJ-Set
  if (CJ_SHOPS.has(h)) {
    return { network: 'cj' };
  }
  for (const d of CJ_SHOPS) {
    if (h.endsWith(`.${d}`)) {
      return { network: 'cj' };
    }
  }

  return null;
}

// -----------------------------------------------------------------------------
// AFFILIATE URL BUILDER (switch – mid nur im AWIN-Case)
// -----------------------------------------------------------------------------
function buildAffiliateUrl(target: URL, info: NetworkInfo): string {
  const clean = withUtm(new URL(target));

  switch (info.network) {
    case 'awin': {
      if (!AWIN_AFFILIATE_ID) return clean.toString();
      const mid = info.mid; // garantiert vorhanden in diesem Zweig
      if (!mid) return clean.toString();
      const encoded = encodeURIComponent(clean.toString());
      return `https://www.awin1.com/cread.php?awinmid=${mid}&awinaffid=${AWIN_AFFILIATE_ID}&ued=${encoded}`;
    }

    case 'cj': {
      if (!CJ_PID) return clean.toString();
      const encoded = encodeURIComponent(clean.toString());
      // TODO: advertiser-spezifische CJ-ID (letzte Zahl) pflegen
      return `https://www.anrdoezrs.net/click-${CJ_PID}-1234567?url=${encoded}`;
    }

    case 'amazon': {
      if (!AMAZON_TAG) return clean.toString();
      clean.searchParams.set('tag', AMAZON_TAG);
      return clean.toString();
    }
  }
}

// -----------------------------------------------------------------------------
// AFFILIATE-FLAG
// -----------------------------------------------------------------------------
function isAffiliateFor(info: NetworkInfo): boolean {
  switch (info.network) {
    case 'awin':   return !!AWIN_AFFILIATE_ID && !!info.mid;
    case 'cj':     return !!CJ_PID;
    case 'amazon': return !!AMAZON_TAG;
  }
}

// -----------------------------------------------------------------------------
// LOGGING
// -----------------------------------------------------------------------------
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
      if (ENABLE_LOGS) console.log(JSON.stringify({
        ts: isoNow(), app: '2list', level: 'debug', evt: 'log_webhook_result', status: res.status,
      }));
    } catch {
      if (ENABLE_LOGS) console.log(JSON.stringify({ ts: isoNow(), app: '2list', level: 'error', evt: 'log_webhook_failed' }));
    }
  }
}

// -----------------------------------------------------------------------------
// HANDLER
// -----------------------------------------------------------------------------
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

export default async function handler(req: Request): Promise<Response> {
  const here = new URL(req.url);
  const raw = here.searchParams.get('u');
  const albumId = here.searchParams.get('a') || '';
  const ua = req.headers.get('user-agent') || '';
  const prefersJson = (req.headers.get('accept') || '').includes('application/json');

  if (!raw) {
    await logEvent({ level: 'warn', evt: 'redirect_missing_u', albumId, ua });
    return prefersJson ? jsonError(400, 'Missing query parameter: u')
                       : Response.redirect(makeFallback(here, 'missing_u'), 302);
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    await logEvent({ level: 'warn', evt: 'redirect_invalid_url', albumId, ua, u: raw });
    return prefersJson ? jsonError(400, 'Invalid URL in parameter u')
                       : Response.redirect(makeFallback(here, 'invalid_url'), 302);
  }

  const protocol = target.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    await logEvent({ level: 'warn', evt: 'redirect_bad_protocol', albumId, ua, protocol, host: host(target) });
    return prefersJson ? jsonError(400, 'Only http/https protocols are allowed')
                       : Response.redirect(makeFallback(here, 'bad_protocol'), 302);
  }

  // Amazon-Shortener ggf. expandieren
  const tHost = host(target);
  if (isAmazonHost(tHost) && tHost.startsWith('amzn.')) {
    const before = target.toString();
    target = await expandIfShortener(target);
    if (ENABLE_LOGS) await logEvent({ level: 'debug', evt: 'expanded_shortlink', from: before, to: target.toString() });
  }

  // Netzwerk ermitteln
  const info = getNetworkInfo(host(target));

  // Ziel-URL (Affiliate oder clean)
  const finalUrl = info ? buildAffiliateUrl(target, info)
                        : withUtm(new URL(target)).toString();

  // Logging
  const networkLog: NetworkKind | 'direct' = info ? info.network : 'direct';
  const affiliateFlag = info ? isAffiliateFor(info) : false;
  const awinMid = (info && info.network === 'awin') ? info.mid : undefined;

  await logEvent({
    level: 'info',
    evt: 'redirect_ok',
    albumId,
    ua,
    domain: host(target),
    network: networkLog,
    isAffiliate: affiliateFlag,
    awinMid,
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
