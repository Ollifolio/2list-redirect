// /api/r.ts — 2List Affiliate Redirect (Edge, Vanilla Vercel)
export const config = { runtime: 'edge' };

type Network = 'awin' | 'cj' | 'amazon';

type AwinConfig = { network: 'awin'; mid: string };   // mid = Händler-ID bei AWIN
type CjConfig = { network: 'cj' };                     // CJ nutzt deine PID aus Env
type AmazonConfig = { network: 'amazon' };             // Amazon nutzt deinen Tag aus Env

type ShopConfig = AwinConfig | CjConfig | AmazonConfig;

// 1) Welche Domains erlauben & wie behandeln?
//    -> Trage hier Shops ein, die du unterstützen willst.
const SHOPS: Record<string, ShopConfig> = {
  // Fashion (AWIN)
  'zalando.de':   { network: 'awin', mid: 'XXXX' },   // TODO: echte AWIN-MID eintragen
  'hm.com':       { network: 'awin', mid: 'XXXX' },
  'aboutyou.de':  { network: 'awin', mid: 'XXXX' },

  // Home (CJ)
  'ikea.com':     { network: 'cj' },
  'home24.de':    { network: 'cj' },

  // Fallback-Shop direkt mit eigenem Programm
  'amazon.de':    { network: 'amazon' },
};

// 2) Deine sensiblen IDs kommen aus Env Vars (Vercel → Settings → Environment Variables)
const AWIN_AFFILIATE_ID = process.env.AWIN_AFFILIATE_ID || ''; // awinaffid
const CJ_PID            = process.env.CJ_PID || '';            // z. B. 12345678
const AMAZON_TAG        = process.env.AMAZON_TAG || '';        // z. B. dein-tag-21

// Hilfsfunktionen
function findShopConfig(url: URL): ShopConfig | null {
  const host = url.hostname.toLowerCase();
  // exakte Domain oder Subdomain (z. B. www.zalando.de)
  for (const domain of Object.keys(SHOPS)) {
    if (host === domain || host.endsWith(`.${domain}`)) {
      return SHOPS[domain];
    }
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
      // Wenn IDs fehlen, ohne Provision direkt weiter
      if (!cfg.mid || !AWIN_AFFILIATE_ID) return clean.toString();
      // AWIN DeepLink-Pattern
      const encoded = encodeURIComponent(clean.toString());
      return `https://www.awin1.com/cread.php?awinmid=${cfg.mid}&awinaffid=${AWIN_AFFILIATE_ID}&ued=${encoded}`;
    }

    case 'cj': {
      // In CJ kopierst du pro Advertiser die korrekte „click“-URL mit deiner PID.
      // Platzhalter-Fallback: wenn keine PID vorhanden, leite ohne Provision weiter.
      if (!CJ_PID) return clean.toString();
      const encoded = encodeURIComponent(clean.toString());
      // Beispiel-Pattern (Publisher-Netzwerk-URL). Ersetze ggf. mit Advertiser-spezifischer Vorlage:
      // Tipp: In CJ im Advertiser-Menü „Deep Link“ generieren und das Pattern hier eintragen.
      return `https://www.anrdoezrs.net/click-${CJ_PID}-1234567?url=${encoded}`;
    }

    case 'amazon': {
      if (!AMAZON_TAG) return clean.toString();
      clean.searchParams.set('tag', AMAZON_TAG);
      return clean.toString();
    }
  }
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const here = new URL(req.url);
    const raw = here.searchParams.get('u');
    if (!raw) {
      return new Response('Missing parameter: ?u=', { status: 400, headers: { 'Content-Type': 'text/plain' } });
    }

    // validiere Ziel-URL
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return new Response('Invalid URL format', { status: 400, headers: { 'Content-Type': 'text/plain' } });
    }

    // Allowlist + Netzwerk-Mapping
    const shopCfg = findShopConfig(target);

    // Wenn Shop bekannt → Affiliate-Link bauen, sonst sauber ohne Provision weiterleiten
    const finalUrl = shopCfg ? buildAffiliateUrl(target, shopCfg) : withUtm(target).toString();

    // Optionales Logging im Vercel-Dashboard
    console.log('2List redirect:', {
      from: target.href,
      to: finalUrl,
      matched: !!shopCfg,
      network: shopCfg?.network ?? 'none',
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: finalUrl,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('Unexpected error in redirect:', err);
    return new Response('Internal Error', { status: 500 });
  }
}
