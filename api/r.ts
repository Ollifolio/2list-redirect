// /api/r.ts — 2List Redirect (Edge, super simpel, robust)
export const config = { runtime: 'edge' };

type AwinConfig   = { network: 'awin'; mid: string };
type CjConfig     = { network: 'cj' };
type AmazonConfig = { network: 'amazon' };
type ShopConfig   = AwinConfig | CjConfig | AmazonConfig;

// ---- ENV (optional; ohne Werte: Passthrough)
const AWIN_AFFILIATE_ID = process.env.AWIN_AFFILIATE_ID || "2638306";
const CJ_PID            = process.env.CJ_PID || "";            // z.B. 1234567
const AMAZON_TAG        = process.env.AMAZON_TAG || "2list-21";

// ---- Partner-Listen (minimal)
const AMAZON_HOSTS = new Set([
  "amazon.de","www.amazon.de","smile.amazon.de",
  "amzn.to","www.amzn.to"
]);

// AWIN: host → merchant id (MID). -> Bitte echte MIDs später eintragen.
const AWIN_MAP: Record<string,string> = {
  // "www.zalando.de": "XXXX",
  // "www.breuninger.com": "YYYY",
};

// CJ: hosts
const CJ_HOSTS = new Set<string>([
  // "www.booking.com","booking.com"
]);

// ---- Helpers
function getTarget(req: Request): URL | null {
  const inUrl = new URL(req.url);
  const raw = inUrl.searchParams.get("url") || inUrl.searchParams.get("u") || inUrl.searchParams.get("t");
  if (!raw) return null;
  try { return new URL(raw); } catch { try { return new URL("https://" + raw); } catch { return null; } }
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

function detect(u: URL): ShopConfig | null {
  const host = u.host.toLowerCase();

  if (AMAZON_HOSTS.has(host) && AMAZON_TAG) return { network: "amazon" };
  if (host in AWIN_MAP && AWIN_AFFILIATE_ID && /^[0-9]+$/.test(AWIN_MAP[host])) {
    return { network: "awin", mid: AWIN_MAP[host] };
  }
  if (CJ_HOSTS.has(host) && CJ_PID) return { network: "cj" };

  return null;
}

function buildAmazon(target: URL): URL {
  if (!target.searchParams.has("tag") && AMAZON_TAG) target.searchParams.set("tag", AMAZON_TAG);
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
  // einfache CJ-Deep-Link-Variante
  const out = new URL("https://www.anrdoezrs.net/links/");
  out.pathname = `links/${encodeURIComponent(CJ_PID)}/type/dlg/${encodeURIComponent(target.toString())}`;
  return out;
}

export default async function handler(req: Request): Promise<Response> {
  const target = getTarget(req);
  if (!target) return new Response("Missing ?url", { status: 400 });

  // Säubern + eigene UTM
  stripTracking(target);
  addOwnUtm(target);

  // Netzwerk
  const cfg = detect(target);

  // Ohne Config -> sauberer Passthrough
  if (!cfg) return Response.redirect(target.toString(), 302);

  let finalUrl: URL;
  switch (cfg.network) {
    case "amazon": finalUrl = buildAmazon(target); break;
    case "awin":   finalUrl = buildAwin(target, cfg); break;
    case "cj":     finalUrl = buildCj(target); break;
    default:       finalUrl = target;
  }

  return Response.redirect(finalUrl.toString(), 302);
}
