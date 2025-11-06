// /api/r.ts — 2List Redirect (Edge, Allowlist, Clean UTM, Logging)
export const config = { runtime: 'edge' };

// ---- Typen
type AwinConfig   = { network: 'awin'; mid: string };
type CjConfig     = { network: 'cj' };
type AmazonConfig = { network: 'amazon' };
type ShopConfig   = AwinConfig | CjConfig | AmazonConfig;

// ---- ENV
const AWIN_AFFILIATE_ID = process.env.AWIN_AFFILIATE_ID || '';
const CJ_PID            = process.env.CJ_PID || '';
const AMAZON_TAG        = process.env.AMAZON_TAG || '';
const LOG_LEVEL         = (process.env.LOG_LEVEL || 'info').toLowerCase();

// ---- Partner-Host-Maps
const AMAZON_HOSTS = new Set([
  'amazon.de','www.amazon.de','smile.amazon.de',
  // Kurzlinks:
  'amzn.to','www.amzn.to'
]);

// AWIN: host → merchant id (mid)
const AWIN_MAP: Record<string, string> = {
  // Beispiele – bitte pflegen/erweitern
  'www.zalando.de': 'XXXX', // ← deine echte MID eintragen
  'zalando.de': 'XXXX',
  'www.breuninger.com': 'YYYY',
  'breuninger.com': 'YYYY',
};

// CJ: hosts (ohne spezielle MID)
const CJ_HOSTS = new Set<string>([
  // Beispiele:
  'www.booking.com','booking.com'
]);

// ---- Hilfsfunktionen
function log(level: 'debug'|'info'|'warn'|'error', msg: string, meta?: unknown) {
  const order = { debug: 10, info: 20, warn: 30, error: 40 } as const;
  const want  = order[LOG_LEVEL as keyof typeof order] ?? 20;
  if (order[level] >= want) {
    console[level](`[r.ts] ${level.toUpperCase()}: ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`);
  }
}

function cleanAndNormalizeTarget(raw: string): URL | null {
  try {
    // Bereits URL? sonst als https interpretieren?
    const u = new URL(raw);
    return u;
  } catch {
    // Falls nur Host/Pfad kommt (selten), versuche https:
    try {
      return new URL(`https://${raw}`);
    } catch {
      return null;
    }
  }
}

function sanitizeQuery(u: URL) {
  // UTM & Tracking-Müll entfernen; du kannst hier nach Bedarf erweitern:
  const drop = new Set([
    'utm_source','utm_medium','utm_campaign','utm_term','utm_content',
    'fbclid','gclid','mc_eid','mc_cid','awc','irgwc','aff','affid'
  ]);
  for (const k of [...u.searchParams.keys()]) {
    if (drop.has(k.toLowerCase())) u.searchParams.delete(k);
  }
}

function appendUtm(u: URL) {
  // Deine eigene Markierung
  if (!u.searchParams.has('utm_source')) u.searchParams.set('utm_source', '2list');
  if (!u.searchParams.has('utm_medium')) u.searchParams.set('utm_medium', 'app');
}

// ---- Netzwerk-Detektion
function detectShopConfig(u: URL): ShopConfig | null {
  const host = u.host.toLowerCase();

  // Amazon
  if (AMAZON_HOSTS.has(host)) {
    if (!AMAZON_TAG) return null; // Amazon erlaubt ohne Tag keinen Affiliate-Add
    return { network: 'amazon' };
  }

  // AWIN
  if (host in AWIN_MAP) {
    const mid = AWIN_MAP[host];
    if (!mid || !AWIN_AFFILIATE_ID || !/^[0-9]+$/.test(mid)) return null;
    return { network: 'awin', mid };
  }

  // CJ
  if (CJ_HOSTS.has(host)) {
    if (!CJ_PID) return null;
    return { network: 'cj' };
  }

  return null;
}

// ---- Affiliate-Builder
function buildAmazonUrl(target: URL): URL {
  // Amazon-Tag per Query anhängen:
  // amazon.de nutzt oft 'tag' als Partner-ID
  if (!target.searchParams.has('tag')) target.searchParams.set('tag', AMAZON_TAG);
  return target;
}

function buildAwinUrl(target: URL, cfg: AwinConfig): URL {
  // https://www.awin1.com/cread.php?awinmid=XXX&awinaffid=YYYY&ued=<encoded target>
  const out = new URL('https://www.awin1.com/cread.php');
  out.searchParams.set('awinmid', cfg.mid);
  out.searchParams.set('awinaffid', AWIN_AFFILIATE_ID);
  out.searchParams.set('ued', target.toString());
  return out;
}

function buildCjUrl(target: URL): URL {
  // CJ Deep Link: https://www.anrdoezrs.net/links/<PID>/type/dlg/<encoded target>
  // oder: https://www.kqzyfj.com/click-<PID>-<SID>?url=<encoded>
  // Wir nutzen hier die Deep-Link-Gateway-Variante:
  const out = new URL('https://www.anrdoezrs.net/links/');
  // /links/<PID>/type/dlg/<encoded target>
  out.pathname = `links/${encodeURIComponent(CJ_PID)}/type/dlg/${encodeURIComponent(target.toString())}`;
  return out;
}

// ---- Haupt-Handler
export default async function handler(req: Request): Promise<Response> {
  try {
    // Eingabe: ?url=…  (Fallback: ?u=… oder ?t=…)
    const inUrl = new URL(req.url);
    const raw = inUrl.searchParams.get('url') || inUrl.searchParams.get('u') || inUrl.searchParams.get('t');
    if (!raw) {
      return new Response('Missing ?url', { status: 400 });
    }

    const target = cleanAndNormalizeTarget(raw);
    if (!target) {
      return new Response('Invalid url', { status: 400 });
    }

    // Basispflege
    sanitizeQuery(target);
    appendUtm(target);

    // Netzwerk wählen
    const cfg = detectShopConfig(target);
    if (!cfg) {
      // Kein bekannter/konfigurierter Shop: direkt (clean) durchlassen
      log('info', 'passthrough', { host: target.host });
      return Response.redirect(target.toString(), 302);
    }

    // Affiliate-URL bauen
    let finalUrl: URL;
    switch (cfg.network) {
      case 'amazon':
        finalUrl = buildAmazonUrl(target);
        break;
      case 'awin':
        finalUrl = buildAwinUrl(target, cfg);
        break;
      case 'cj':
        finalUrl = buildCjUrl(target);
        break;
      default:
        // Fallback: passthrough
        finalUrl = target;
    }

    log('info', 'redirect', { network: cfg.network, to: finalUrl.toString() });
    return Response.redirect(finalUrl.toString(), 302);

  } catch (err: any) {
    log('error', 'exception', { message: err?.message });
    return new Response('Internal error', { status: 500 });
  }
}
