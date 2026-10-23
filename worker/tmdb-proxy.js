/* Cloudflare Worker that keeps your TMDB key secret.
   Setup (works from a phone browser, free plan):
   1. dash.cloudflare.com -> Workers & Pages -> Create -> Worker -> paste this file -> Deploy.
   2. Worker -> Settings -> Variables and Secrets:
        TMDB_API_KEY    (type Secret)  = your TMDB v3 key
        ALLOWED_ORIGINS (type Text)    = https://YOURNAME.github.io   (comma-separate several; no trailing slash)
   3. Put the worker URL in config.js as TMDB_PROXY and leave TMDB_API_KEY empty. */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const ok = !allowed.length || allowed.includes(origin);
    const cors = { "Access-Control-Allow-Origin": ok ? (origin || "*") : "null", "Vary": "Origin" };

    if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "*" } });
    if (!ok) return new Response("Forbidden", { status: 403, headers: cors });
    if (req.method !== "GET" || !url.pathname.startsWith("/3/")) return new Response("Not found", { status: 404, headers: cors });

    const target = new URL("https://api.themoviedb.org" + url.pathname);
    url.searchParams.forEach((v, k) => { if (k !== "api_key") target.searchParams.set(k, v); });
    target.searchParams.set("api_key", env.TMDB_API_KEY);

    const res = await fetch(target, { cf: { cacheTtl: 600, cacheEverything: true } });
    const h = new Headers(res.headers);
    Object.entries(cors).forEach(([k, v]) => h.set(k, v));
    h.set("Cache-Control", "public, max-age=600");
    return new Response(res.body, { status: res.status, headers: h });
  }
};
