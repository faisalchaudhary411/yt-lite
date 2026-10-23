/* Fetches full-length, embeddable videos from official YouTube channels and
   Creative-Commons searches, and writes data/youtube.json for the site.
   Runs in GitHub Actions (see .github/workflows/youtube.yml). Needs YT_API_KEY. */
const fs = require("fs");
const path = require("path");

const KEY = process.env.YT_API_KEY;
const API = "https://www.googleapis.com/youtube/v3";
const REGION = "PK"; // skip videos blocked in this country

/* EDIT THIS: categories shown as tabs in the Free section.
   channels: YouTube handles of OFFICIAL channels that upload full content legally.
   search:   Creative-Commons licensed searches (safe to embed and share).
   minSec:   ignore videos shorter than this. */
const CATEGORIES = [
  { key: "cc-movies", label: "Free Movies (CC)", minSec: 2400,
    search: ["full movie", "feature film", "documentary full"] },
  { key: "urdu-dramas", label: "Urdu Dramas", minSec: 1200,
    channels: ["@HUMTV", "@ARYDigital", "@GeoEntertainment"] },
  { key: "bollywood", label: "Bollywood Movies", minSec: 4200,
    channels: ["@ShemarooMovies", "@GoldminesBollywood"] }
];

const PER_CATEGORY = 120;

async function api(endpoint, params) {
  const u = new URL(API + "/" + endpoint);
  Object.entries({ ...params, key: KEY }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u);
  if (!r.ok) throw new Error(endpoint + " " + r.status + " " + (await r.text()).slice(0, 200));
  return r.json();
}

const isoToSec = d => {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || "");
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
};

async function uploadsOfHandle(handle) {
  const d = await api("channels", { part: "contentDetails,snippet", forHandle: handle });
  const c = d.items && d.items[0];
  if (!c) { console.warn("  ! channel not found:", handle); return []; }
  const pl = c.contentDetails.relatedPlaylists.uploads;
  const ids = [];
  let token = "";
  for (let i = 0; i < 2; i++) {
    const p = await api("playlistItems", { part: "contentDetails", playlistId: pl, maxResults: 50, ...(token && { pageToken: token }) });
    (p.items || []).forEach(x => ids.push(x.contentDetails.videoId));
    token = p.nextPageToken;
    if (!token) break;
  }
  console.log("  " + handle + ": " + ids.length + " recent uploads");
  return ids;
}

async function idsOfSearch(q) {
  const d = await api("search", {
    part: "id", type: "video", q, maxResults: 50, order: "viewCount",
    videoLicense: "creativeCommon", videoDuration: "long", videoEmbeddable: "true", safeSearch: "moderate"
  });
  const ids = (d.items || []).map(x => x.id.videoId).filter(Boolean);
  console.log("  search '" + q + "': " + ids.length);
  return ids;
}

async function details(ids, minSec) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const d = await api("videos", { part: "contentDetails,status,snippet", id: ids.slice(i, i + 50).join(",") });
    for (const v of d.items || []) {
      const dur = isoToSec(v.contentDetails.duration);
      if (dur < minSec) continue;
      if (!v.status || v.status.privacyStatus !== "public" || !v.status.embeddable) continue;
      const rr = v.contentDetails.regionRestriction;
      if (rr && ((rr.blocked || []).includes(REGION) || (rr.allowed && !rr.allowed.includes(REGION)))) continue;
      const th = v.snippet.thumbnails || {};
      out.push({
        id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle, dur,
        thumb: (th.medium || th.high || th.default || {}).url || "",
        published: (v.snippet.publishedAt || "").slice(0, 10)
      });
    }
  }
  return out;
}

(async () => {
  if (!KEY) { console.error("Missing YT_API_KEY"); process.exit(1); }
  const outFile = path.join(__dirname, "..", "data", "youtube.json");
  let old = { categories: {} };
  try { old = JSON.parse(fs.readFileSync(outFile, "utf8")); } catch (e) {}
  const result = { updated: new Date().toISOString(), categories: {} };

  for (const cat of CATEGORIES) {
    console.log("== " + cat.label);
    try {
      let ids = [];
      for (const h of cat.channels || []) { try { ids = ids.concat(await uploadsOfHandle(h)); } catch (e) { console.warn("  ! " + h + ": " + e.message); } }
      for (const q of cat.search || []) { try { ids = ids.concat(await idsOfSearch(q)); } catch (e) { console.warn("  ! search " + q + ": " + e.message); } }
      ids = [...new Set(ids)];
      let items = await details(ids, cat.minSec || 0);
      items.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
      items = items.slice(0, PER_CATEGORY);
      if (!items.length && old.categories[cat.key]) { console.warn("  no results, keeping previous data"); result.categories[cat.key] = old.categories[cat.key]; continue; }
      result.categories[cat.key] = { label: cat.label, items };
      console.log("  kept " + items.length);
    } catch (e) {
      console.warn("  category failed: " + e.message);
      if (old.categories[cat.key]) result.categories[cat.key] = old.categories[cat.key];
    }
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result));
  console.log("Wrote " + outFile);
})();
