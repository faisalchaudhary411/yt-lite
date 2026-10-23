/* Fetches full-length, embeddable videos from OFFICIAL YouTube channels and
   Creative-Commons searches, and writes data/youtube.json for the site.
   Runs in GitHub Actions (see .github/workflows/youtube.yml). Needs YT_API_KEY.

   Channels are found by handle first, then by exact channel name. What was found
   is remembered in data/channels.json (so it costs no quota next time) and printed
   in the Actions log: CHECK THE LOG once to make sure each match is the real channel.
   To force a channel, add "id": "UCxxxxxxxxxxxxxxxxxxxxxx" to its entry below. */
const fs = require("fs");
const path = require("path");

const KEY = process.env.YT_API_KEY;
const API = "https://www.googleapis.com/youtube/v3";
const REGION = "PK"; // skip videos blocked in this country
const DATA = path.join(__dirname, "..", "data");

/* EDIT THIS: categories shown as tabs in the Free section.
   channels: official channels that upload full content legally ({name, handle?, id?}).
   search:   Creative-Commons licensed searches (safe to embed and share).
   minSec:   ignore videos shorter than this. */
const CATEGORIES = [
  { key: "cc-movies", label: "Free Movies (CC)", minSec: 2400,
    search: ["full movie", "feature film", "documentary full"] },
  { key: "urdu-dramas", label: "Urdu Dramas", minSec: 1200, channels: [
    { name: "HUM TV", handle: "@HUMTV" },
    { name: "ARY Digital", handle: "@arydigital" },
    { name: "Geo Entertainment", handle: "@GeoEntertainment" },
    { name: "Express Entertainment" },
    { name: "Green Entertainment" },
    { name: "Aplus Entertainment" }
  ] },
  { key: "bollywood", label: "Bollywood Movies", minSec: 4200, channels: [
    { name: "Shemaroo Movies" },
    { name: "Goldmines" },
    { name: "Ultra Movie Parlour" },
    { name: "Pen Movies" },
    { name: "Rajshri" },
    { name: "Venus Movies" }
  ] },
  { key: "hollywood", label: "English Movies", minSec: 4200, channels: [
    { name: "FilmRise Movies" },
    { name: "Popcornflix" },
    { name: "Timeless Classic Movies" },
    { name: "Cinema Quest" }
  ] },
  { key: "documentaries", label: "Documentaries", minSec: 1800, channels: [
    { name: "DW Documentary", handle: "@DWDocumentary" },
    { name: "Real Stories" },
    { name: "Free Documentary" }
  ] },
  { key: "kids", label: "Kids & Cartoons", minSec: 1500, channels: [
    { name: "Masha and The Bear" },
    { name: "Peppa Pig - Official Channel" },
    { name: "Cocomelon - Nursery Rhymes" }
  ] },
  { key: "anime", label: "Anime", minSec: 1200, channels: [
    { name: "Muse Asia" },
    { name: "Ani-One Asia" }
  ] }
];

const PER_CATEGORY = 120;
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

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

let chCache = {};
async function resolveChannel(ch) {
  const ck = ch.id || ch.handle || ch.name;
  if (chCache[ck]) return chCache[ck];
  let found = null;
  if (ch.id) {
    const d = await api("channels", { part: "snippet", id: ch.id });
    if (d.items && d.items[0]) found = { id: d.items[0].id, title: d.items[0].snippet.title };
  }
  if (!found && ch.handle) {
    const d = await api("channels", { part: "snippet", forHandle: ch.handle });
    if (d.items && d.items[0]) found = { id: d.items[0].id, title: d.items[0].snippet.title };
  }
  if (!found) {
    const d = await api("search", { part: "snippet", type: "channel", q: ch.name, maxResults: 5 });
    const hit = (d.items || []).find(x => norm(x.snippet.channelTitle) === norm(ch.name)) ||
                (d.items || []).find(x => norm(x.snippet.channelTitle).includes(norm(ch.name)));
    if (hit) found = { id: hit.snippet.channelId || hit.id.channelId, title: hit.snippet.channelTitle };
  }
  if (!found) { console.warn("  ! channel not found: " + ck); return null; }
  console.log("  matched '" + ck + "' -> " + found.title + " (" + found.id + ")");
  chCache[ck] = found;
  return found;
}

async function uploadsOf(ch) {
  const f = await resolveChannel(ch);
  if (!f) return [];
  const pl = "UU" + f.id.slice(2); /* uploads playlist id */
  const ids = [];
  let token = "";
  for (let i = 0; i < 2; i++) {
    const p = await api("playlistItems", { part: "contentDetails", playlistId: pl, maxResults: 50, ...(token && { pageToken: token }) });
    (p.items || []).forEach(x => ids.push(x.contentDetails.videoId));
    token = p.nextPageToken;
    if (!token) break;
  }
  console.log("  " + f.title + ": " + ids.length + " recent uploads");
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
  fs.mkdirSync(DATA, { recursive: true });
  const outFile = path.join(DATA, "youtube.json");
  const chFile = path.join(DATA, "channels.json");
  let old = { categories: {} };
  try { old = JSON.parse(fs.readFileSync(outFile, "utf8")); } catch (e) {}
  try { chCache = JSON.parse(fs.readFileSync(chFile, "utf8")); } catch (e) {}
  const result = { updated: new Date().toISOString(), categories: {} };

  for (const cat of CATEGORIES) {
    console.log("== " + cat.label);
    try {
      let ids = [];
      for (const ch of cat.channels || []) { try { ids = ids.concat(await uploadsOf(ch)); } catch (e) { console.warn("  ! " + ch.name + ": " + e.message); } }
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
  fs.writeFileSync(outFile, JSON.stringify(result));
  fs.writeFileSync(chFile, JSON.stringify(chCache, null, 1));
  console.log("Wrote " + outFile);
})();
