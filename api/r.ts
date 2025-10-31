// /api/r.ts — 2List Redirect (Edge, gehärtet mit Allowlist + Fallback)
export const config = { runtime: 'edge' };

type AwinConfig = { network: 'awin'; mid: string }; // mid = Händler-ID bei AWIN
type CjConfig = { network: 'cj' };                   // CJ nutzt deine PID aus Env
type AmazonConfig = { network: 'amazon' };           // Amazon nutzt deinen Tag aus Env
type ShopConfig = AwinConfig | CjConfig | AmazonConfig;

// ✅ Neutrale Fehlerseite (kannst du anpassen)
const FALLBACK_ERROR_URL = 'https://2list.app/error';

// ✅ Allowlist der Shops (nur diese Domains sind erlaubt)
const SHOPS: Record<string, ShopConfig> = {
  // Fashion (AWIN)
  'zalando.de':   { network: 'awin', mid: 'XXXX' },   // TODO: echte AWIN-MID eintragen
  'hm.com':       { network: 'awin', mid: 'XXXX' },
  'aboutyou.de':  { network: 'awin', mid: 'XXXX' },

  // Home (CJ)
  'ikea.com':     { network: 'cj' },
  'home24.de':    { network: 'cj' },

  // Direktes Programm
  'amazon.de':    { network: 'amazon' },
};

// 🔐 IDs aus Env (später in Vercel → Settings → Environment Variables setzen)
const AWIN_AFFILIATE_ID = process.env.AWIN_AFFILIATE_ID || '';
const CJ_PID            = process.env.CJ_PID || '';
const AMAZON_TAG        = process.env.AMAZON_TAG || '';

function findShopConfig(url: URL): ShopConfig | null {
  const host = url.hostname.toLowerCase();
  for (const domain of Object.keys(SHOPS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return SHOPS[domain];
  }
  return null;
}

function withUtm(u: URL): URL {
  u.searchParams.set('utm_source', '2list');
  u.searchParams.set('utm_medium', 'app');
  return u;
}

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
      // Platzhalter-Pattern: Bitte später durch dein Advertiser-spezifisches CJ-Pattern ersetzen
      return `https://www.anrdoezrs.net/click-${CJ_PID}-1234567?url=${encoded}`;
    }
    case 'amazon': {
      if (!AMAZON_TAG) return clean.toString();
      clean.searchParams.set('tag', AMAZON_TAG);
      return clean.toString();
    }
  }
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  const now = new Date().toISOString();
  const here = new URL(req.url);
  const raw = here.searchParams.get('u');
  const prefersJson = (req.headers.get('accept') || '').includes('application/json');

  if (!raw) {
    console.log(JSON.stringify({ ts: now, level: 'warn', msg: 'missing_u_param' }));
    if (prefersJson) return jsonError(400, 'Missing query parameter: u');
    return Response.redirect(`${FALLBACK_ERROR_URL}?reason=missing_u`, 302);
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    console.log(JSON.stringify({ ts: now, level: 'warn', msg: 'invalid_url', u: raw }));
    if (prefersJson) return jsonError(400, 'Invalid URL in parameter u');
    return Response.redirect(`${FALLBACK_ERROR_URL}?reason=invalid_url`, 302);
  }

  // Nur http/https zulassen
  const protocol = target.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    console.log(JSON.stringify({ ts: now, level: 'warn', msg: 'bad_protocol', protocol, u: String(target) }));
    if (prefersJson) return jsonError(400, 'Only http/https protocols are allowed');
    return Response.redirect(`${FALLBACK_ERROR_URL}?reason=bad_protocol`, 302);
  }

  // ✅ Strikte Allowlist
  const shopCfg = findShopConfig(target);
  if (!shopCfg) {
    console.log(JSON.stringify({ ts: now, level: 'warn', msg: 'blocked_by_allowlist', host: target.hostname, u: String(target) }));
    if (prefersJson) return jsonError(403, `Target hostname not allowed: ${target.hostname.toLowerCase()}`);
    return Response.redirect(`${FALLBACK_ERROR_URL}?reason=blocked&host=${encodeURIComponent(target.hostname)}`, 302);
  }

  // Affiliate-Link (oder plain Deep-Link, falls IDs fehlen)
  const finalUrl = buildAffiliateUrl(target, shopCfg);

  console.log(JSON.stringify({
    ts: now, level: 'info', msg: 'redirect_ok',
    from: target.href, to: finalUrl, network: shopCfg.network, status: 302
  }));

  return Response.redirect(finalUrl, 302);
}
