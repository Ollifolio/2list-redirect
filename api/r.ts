// /api/r.ts — 2List Redirect (Edge, robust, accepts url|u|t, TS-safe)
export const config = { runtime: 'edge' };

type AwinConfig   = { network: 'awin'; mid: string };
type CjConfig     = { network: 'cj' };
type AmazonConfig = { network: 'amazon' };
type ShopConfig   = AwinConfig | CjConfig | AmazonConfig;

// ---- ENV (mit Defaults fürs Testen – später in Vercel setzen)
const AWIN_AFFILIATE_ID = process.env.AWIN_AFFILIATE_ID || "2638306";
const CJ_PID            = process.env.CJ_PID || "";
const AMAZON_TAG        = process.env.AMAZON_TAG || "2list-21";

// ---- Partner-Listen
const AMAZON_HOSTS = new Set([
  "amazon.de","www.amazon.de","smile.amazon.de",
  "amzn.to","www.amzn.to"
]);

// AWIN: host -> MID (Zahlen-String!). Später echte MIDs eintragen.
const AWIN_MAP: Record<string, string> = {
  // "www.zalando.de": "12345",
  // "www.breuninger.com": "67890",
};

// CJ: Hosts
const CJ_HOSTS = new Set<string>([
  // "www.booking.com","booking.com"
]);

// ---- kleine Utils
function htmlError(title: string, reason: string, status = 400) {
  const html = `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>
body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;padding:2rem;max-width:780px;margin:0 auto;color:#111}
h1{font-size:1.8rem;margin:0 0 1rem} code{background:#f3f4f6;padding:.15rem .35rem;border-radius:.35rem}
.muted{color:#6b7280;font-size:.9rem;margin-top:1.25rem}
</style>
<h1>${title}</h1>
<p>Dein Aufruf konnte nicht weitergeleitet werden.</p>
<ul><li><strong>Reason:</strong> <code>${reason}</code></li></ul>
<p>Beispiel: <code>/api/r?url=https%3A%2F%2Fwww.zalando.de%2F</code></p>
<hr class="muted"/><div class="muted">2list-redirect · Status: ${status}</div>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function parseTargetParam(req: Request): string | null {
  const u = new URL(req.url);
  return u.searchParams.get("url") ?? u.searchParams.get("u") ?? u.searchParams.get("t");
}

function toUrl(raw: string): URL | null {
  try { return new URL(raw); } catch {}
  try { return new URL("https://" + raw); } catch {}
  return null;
}

function stripTracking(u: URL) {
  const drop = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid","awc","irgwc","aff","affid"];
  for (const k of [...u.searchParams.keys()]) {
    if (drop.includes(k.toLowerCase())) u.searchParams.delete(k);
  }
}

function addOwnUtm(u: URL) {
  if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source","2list");
  if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium","app");
}

// ---- Type Guards (lösen den TS-Fehler sicher)
function isAwin(cfg: ShopConfig | null): cfg is AwinConfig {
  return !!cfg && cfg.network === "awin";
}
function isCj(cfg: ShopConfig | null): cfg is CjConfig {
  return !!cfg && cfg.network === "cj";
}
function isAmazon(cfg: ShopConfig | null): cfg is AmazonConfig {
  return !!cfg && cfg.network === "amazon";
}

// ---- Netzwerkerkennung
function detect(u: URL): ShopConfig | null {
  const host = u.host.toLowerCase();

  if (AMAZON_HOSTS.has(host) && AMAZON_TAG) {
    return { network: "amazon" };
  }

  if (host in AWIN_MAP) {
    const mid = AWIN_MAP[host];
    if (AWIN_AFFILIATE_ID && /^[0-9]+$/.test(mid)) {
      return { network: "awin", mid };
    }
  }

  if (CJ_HOSTS.has(host) && CJ_PID) {
    return { network: "cj" };
  }

  return null; // passthrough
}

function buildAmazon(target: URL): URL {
  if (!target.searchParams.has("tag") && AMAZON_TAG) {
    target.searchParams.set("tag", AMAZON_TAG);
  }
  return target;
}

function buildAwin(target: URL, cfg: AwinConfig): URL {
  const out = new URL("https://www.awin1.com/cread.php");
  out.searchParams.set("awinmid", cfg.mid);
  out.searchParams.set("awinaffid", AWIN_AFFILIATE_ID);
  out.searchParams.set("ued", target.toString());
  return out;
}

function buildCj(target: URL): URL {
  const out = new URL("https://www.anrdoezrs.net/links/");
  out.pathname = `links/${encodeURIComponent(CJ_PID)}/type/dlg/${encodeURIComponent(target.toString())}`;
  return out;
}

// ---- Handler
export default async function handler(req: Request): Promise<Response> {
  const raw = parseTargetParam(req);
  if (!raw) return htmlError("Weiterleitung nicht möglich", "missing_url", 400);

  const target = toUrl(raw);
  if (!target) return htmlError("Weiterleitung nicht möglich", "invalid_url", 400);

  stripTracking(target);
  addOwnUtm(target);

  const cfg = detect(target);

  if (!cfg) {
    // kein bekanntes Netzwerk -> sauber durchreichen
    return Response.redirect(target.toString(), 302);
  }

  let finalUrl: URL;

  if (isAmazon(cfg)) {
    finalUrl = buildAmazon(target);
  } else if (isAwin(cfg)) {
    finalUrl = buildAwin(target, cfg);
  } else if (isCj(cfg)) {
    finalUrl = buildCj(target);
  } else {
    finalUrl = target;
  }

  return Response.redirect(finalUrl.toString(), 302);
}
