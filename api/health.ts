export default function handler() {
  return new Response(JSON.stringify({
    status: "ok",
    service: "2list-redirect",
    version: "1.0.2"   // <— Zahl erhöhen, damit du es im Browser erkennst
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
