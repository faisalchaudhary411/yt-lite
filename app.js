/* CineBox - movie & TV discovery site (TMDB + Internet Archive) */

// Settings live in config.js (TMDB key, optional proxy) so updating this file never touches your key.
const CFG = window.CINEBOX_CONFIG || {};
const API_KEY = CFG.TMDB_API_KEY || "";
const PROXY = (CFG.TMDB_PROXY || "").replace(/\/+$/, "");

const API = (PROXY || "https://api.themoviedb.org") + "/3";
const IMG = "https://image.tmdb.org/t/p/";
const LS_LIST = "cinebox_watchlist";
const LS_HIST = "cinebox_history";

const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const year = d => (d || "").slice(0, 4);
const stars = v => (v ? Number(v).toFixed(1) : "NR");

/* ---------- storage ---------- */
function load(key) { try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
const inList = (id, type) => load(LS_LIST).some(x => x.id === id && x.type === type);
function toggleList(item) {
  let l = load(LS_LIST);
  if (l.some(x => x.id === item.id && x.type === item.type)) l = l.filter(x => !(x.id === item.id && x.type === item.type));
  else l.unshift(item);
  save(LS_LIST, l);
}
function addHistory(item) {
  let h = load(LS_HIST).filter(x => !(x.id === item.id && x.type === item.type));
  h.unshift(item);
  save(LS_HIST, h.slice(0, 30));
}

/* ---------- continue watching + region ---------- */
const LS_PROG = "cinebox_progress";
const LS_REGION = "cinebox_region";
function progAll() { try { return JSON.parse(localStorage.getItem(LS_PROG)) || {}; } catch (e) { return {}; } }
function progSet(id, obj) {
  const a = progAll();
  if (obj) a[id] = obj; else delete a[id];
  try { localStorage.setItem(LS_PROG, JSON.stringify(a)); } catch (e) {}
}
const REGIONS = [["PK", "Pakistan"], ["US", "United States"], ["GB", "United Kingdom"], ["IN", "India"], ["AE", "UAE"], ["SA", "Saudi Arabia"], ["CA", "Canada"], ["AU", "Australia"], ["DE", "Germany"], ["FR", "France"]];
function getRegion() {
  try { const r = localStorage.getItem(LS_REGION); if (r) return r; } catch (e) {}
  const guess = ((navigator.language || "").split("-")[1] || "").toUpperCase();
  return REGIONS.some(x => x[0] === guess) ? guess : "US";
}
function setRegion(r) { try { localStorage.setItem(LS_REGION, r); } catch (e) {} }
const fmtTime = t => { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
function continueRow() {
  const items = Object.entries(progAll()).map(([k, x]) => ({ ...x, key: x.key || k })).sort((a, b) => b.ts - a.ts).slice(0, 15);
  if (!items.length) return "";
  const cards = items.map(x => {
    const href = x.yt ? `#/yt/${encodeURIComponent(x.id)}` : `#/free/${encodeURIComponent(x.id)}`;
    const img = x.yt ? (x.thumb || "") : `https://archive.org/services/img/${encodeURIComponent(x.id)}`;
    return `
    <div class="card${x.yt ? " wide" : ""}">
      <a href="${href}">
        <img class="poster" loading="lazy" src="${esc(img)}" alt="${esc(x.title)}">
        <div class="ct">${esc(x.title)}</div>
        <div class="cs">Resume at ${fmtTime(x.t)}</div>
      </a>
      <div class="prog"><i style="width:${Math.min(100, Math.round(x.t / (x.d || 1) * 100))}%"></i></div>
      <button class="rm" type="button" data-rm="${esc(x.key)}" aria-label="Remove from Continue Watching">&times;</button>
    </div>`;
  }).join("");
  return `<section class="section" data-prog-section><h2>Continue Watching <a href="#" data-clear-prog>Clear all</a></h2><div class="row">${cards}</div></section>`;
}

let flushProgress = null; /* saves the current video's position right now */
document.addEventListener("visibilitychange", () => { if (document.hidden && flushProgress) { try { flushProgress(); } catch (e) {} } });
window.addEventListener("pagehide", () => { if (flushProgress) { try { flushProgress(); } catch (e) {} } });

/* ---------- api ---------- */
async function tmdb(path, params = {}) {
  const u = new URL(API + path);
  if (!PROXY) u.searchParams.set("api_key", API_KEY);
  u.searchParams.set("language", "en-US");
  Object.entries(params).forEach(([k, v]) => { if (v !== "" && v != null) u.searchParams.set(k, v); });
  const r = await fetch(u);
  if (!r.ok) throw new Error("TMDB error " + r.status);
  return r.json();
}

let genreCache = null;
async function genres() {
  if (genreCache) return genreCache;
  const [m, t] = await Promise.all([tmdb("/genre/movie/list"), tmdb("/genre/tv/list")]);
  genreCache = { movie: m.genres, tv: t.genres };
  return genreCache;
}

/* ---------- ui pieces ---------- */
function loading() { app.innerHTML = '<div class="loading"><div class="spinner"></div></div>'; }
function showError(msg) { app.innerHTML = `<div class="notice">${msg}</div>`; }

function keyMissing() {
  return !API_KEY && !PROXY;
}

function cardHTML(it, forcedType) {
  const type = it.media_type || forcedType;
  if (type !== "movie" && type !== "tv") return "";
  const title = it.title || it.name || "Untitled";
  const date = it.release_date || it.first_air_date || "";
  const poster = it.poster_path
    ? `<img class="poster" loading="lazy" src="${IMG}w342${it.poster_path}" alt="${esc(title)}">`
    : `<div class="no-poster">${esc(title)}</div>`;
  return `<a class="card" href="#/${type}/${it.id}">
    ${poster}
    <span class="tag">&#9733; ${stars(it.vote_average)}</span>
    <div class="ct">${esc(title)}</div>
    <div class="cs">${year(date) || "-"} &middot; ${type === "tv" ? "TV" : "Movie"}</div>
  </a>`;
}

function rowHTML(title, items, type, more) {
  const cards = (items || []).map(i => cardHTML(i, type)).join("");
  if (!cards) return "";
  return `<section class="section">
    <h2>${esc(title)} ${more ? `<a href="${more}">See all &rsaquo;</a>` : ""}</h2>
    <div class="row">${cards}</div>
  </section>`;
}

function setActiveNav(name) {
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === name));
}

/* ---------- modal (trailers / players) ---------- */
function openModal(html) { $("#modalBody").innerHTML = html; $("#modal").classList.remove("hidden"); }
function closeModal() { $("#modal").classList.add("hidden"); $("#modalBody").innerHTML = ""; }
$("#modalClose").addEventListener("click", closeModal);
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
function playTrailer(key) {
  openModal(`<iframe src="https://www.youtube.com/embed/${encodeURIComponent(key)}?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`);
}

/* ---------- views ---------- */
const MOODS = {
  feelgood: { label: "Feel-good", g: "35|10751" },
  thrilling: { label: "Edge of your seat", g: "53|28" },
  romantic: { label: "Romantic", g: "10749" },
  mind: { label: "Mind-bending", g: "878|9648" },
  scary: { label: "Scary night", g: "27" },
  family: { label: "Family time", g: "16|10751" },
  epic: { label: "Epic adventure", g: "12|14" },
  real: { label: "True stories", g: "36|99" }
};

let heroTimer = null;

function heroInner(it) {
  const t = it.title || it.name;
  return `<div class="meta"><span class="rating">&#9733; ${stars(it.vote_average)}</span>
      <span>${year(it.release_date || it.first_air_date)}</span>
      <span class="badge">${it.media_type === "tv" ? "TV Series" : "Movie"}</span></div>
    <h1>${esc(t)}</h1>
    <p>${esc(it.overview)}</p>
    <div class="btn-row"><a class="btn" href="#/${it.media_type}/${it.id}">&#9654; Details &amp; Trailer</a></div>`;
}

async function viewHome() {
  setActiveNav("home");
  loading();
  const [trending, popM, topM, popT, topT, nowM, soon, gems, g] = await Promise.all([
    tmdb("/trending/all/week"),
    tmdb("/movie/popular"),
    tmdb("/movie/top_rated"),
    tmdb("/tv/popular"),
    tmdb("/tv/top_rated"),
    tmdb("/movie/now_playing"),
    tmdb("/movie/upcoming"),
    tmdb("/discover/movie", { sort_by: "vote_average.desc", "vote_count.gte": 500, "vote_count.lte": 4000, "vote_average.gte": 7.4 }),
    genres()
  ]);

  const slides = trending.results.filter(x => x.backdrop_path && (x.media_type === "movie" || x.media_type === "tv")).slice(0, 5);
  const bg = it => `${IMG}w1280${it.backdrop_path}`;
  let hero = "";
  if (slides.length) {
    hero = `<section class="hero" id="hero" style="background-image:url(${bg(slides[0])})">
      <div class="hero-inner" id="heroInner">${heroInner(slides[0])}</div>
      <div class="hero-dots" id="heroDots">${slides.map((_, i) => `<button type="button" data-i="${i}" class="${i === 0 ? "on" : ""}" aria-label="Slide ${i + 1}"></button>`).join("")}</div>
    </section>`;
  }

  const chips = `<div class="chips">${g.movie.map(x => `<a class="chip" href="#/search?type=movie&genre=${x.id}">${esc(x.name)}</a>`).join("")}</div>`;

  const pool = [...topM.results, ...popM.results].filter(x => x.backdrop_path && x.overview);
  let pickHTML = "";
  if (pool.length) {
    const pk = pool[Math.floor(Date.now() / 864e5) % pool.length];
    pickHTML = `<section class="section"><h2>Tonight's Pick</h2>
      <a class="pick" href="#/movie/${pk.id}" style="background-image:url(${IMG}w780${pk.backdrop_path})">
        <div class="pick-in"><span class="badge">&#9733; ${stars(pk.vote_average)} &middot; ${year(pk.release_date)}</span>
        <h3>${esc(pk.title)}</h3><p>${esc(pk.overview)}</p></div>
      </a></section>`;
  }

  const moods = `<section class="section"><h2>What's your mood?</h2>
    <div class="chips" style="padding-top:0">${Object.entries(MOODS).map(([k, m]) => `<a class="chip" href="#/search?type=movie&mood=${k}">${m.label}</a>`).join("")}<a class="chip surprise" href="#/surprise">&#127922; Surprise me</a></div></section>`;

  app.innerHTML = hero + chips + continueRow() + pickHTML + moods +
    rowHTML("Trending This Week", trending.results, null, "#/search?sort=popularity.desc") +
    rowHTML("Now in Cinemas", nowM.results, "movie") +
    rowHTML("Coming Soon", soon.results, "movie") +
    rowHTML("Popular Movies", popM.results, "movie", "#/search?type=movie&sort=popularity.desc") +
    rowHTML("Hidden Gems", gems.results, "movie") +
    rowHTML("Top Rated Movies", topM.results, "movie", "#/search?type=movie&sort=vote_average.desc") +
    rowHTML("Popular TV Shows", popT.results, "tv", "#/search?type=tv&sort=popularity.desc") +
    rowHTML("Top Rated TV Shows", topT.results, "tv", "#/search?type=tv&sort=vote_average.desc");

  if (slides.length > 1) {
    let cur = 0;
    const heroEl = $("#hero"), inner = $("#heroInner"), dots = $("#heroDots");
    const show = i => {
      cur = i;
      heroEl.style.backgroundImage = `url(${bg(slides[i])})`;
      inner.innerHTML = heroInner(slides[i]);
      dots.querySelectorAll("button").forEach((b, n) => b.classList.toggle("on", n === i));
    };
    const start = () => { clearInterval(heroTimer); heroTimer = setInterval(() => show((cur + 1) % slides.length), 6000); };
    dots.addEventListener("click", e => { const b = e.target.closest("button[data-i]"); if (b) { show(+b.dataset.i); start(); } });
    start();
  }
}

async function viewSurprise() {
  loading();
  const d = await tmdb("/discover/movie", { sort_by: "popularity.desc", "vote_count.gte": 1000, "vote_average.gte": 6.5, page: 1 + Math.floor(Math.random() * 25) });
  const list = d.results.filter(x => x.poster_path);
  const pick = list[Math.floor(Math.random() * list.length)];
  if (!pick) { location.replace("#/"); return; }
  location.replace("#/movie/" + pick.id);
}

async function viewSearch(p) {
  setActiveNav("search");
  loading();
  const g = await genres();
  const type = p.get("type") || "movie";
  const q = p.get("q") || "";
  const mood = MOODS[p.get("mood")];
  const genre = p.get("genre") || (mood ? mood.g : "");
  const yr = p.get("year") || "";
  const minRating = p.get("rating") || "";
  const sort = p.get("sort") || "popularity.desc";
  const page = Math.max(1, parseInt(p.get("page") || "1", 10));

  let data;
  if (q) {
    data = await tmdb(type === "tv" ? "/search/tv" : "/search/movie", { query: q, page, first_air_date_year: type === "tv" ? yr : "", year: type === "movie" ? yr : "" });
  } else {
    const params = { page, sort_by: sort, with_genres: genre, "vote_average.gte": minRating };
    if (sort.startsWith("vote_average")) params["vote_count.gte"] = 300;
    if (type === "movie") params.primary_release_year = yr; else params.first_air_date_year = yr;
    data = await tmdb(type === "tv" ? "/discover/tv" : "/discover/movie", params);
  }

  const list = g[type] || [];
  const nowY = new Date().getFullYear();
  let yearOpts = '<option value="">Any year</option>';
  for (let y = nowY; y >= 1950; y--) yearOpts += `<option value="${y}" ${String(y) === yr ? "selected" : ""}>${y}</option>`;

  const sorts = [["popularity.desc", "Most popular"], ["vote_average.desc", "Top rated"], [type === "tv" ? "first_air_date.desc" : "primary_release_date.desc", "Newest"]];

  app.innerHTML = `
    <form class="filters" id="filterForm">
      <input class="wide" name="q" placeholder="Search by title..." value="${esc(q)}">
      <select name="type"><option value="movie" ${type === "movie" ? "selected" : ""}>Movies</option><option value="tv" ${type === "tv" ? "selected" : ""}>TV Shows</option></select>
      <select name="genre"><option value="">All genres</option>${list.map(x => `<option value="${x.id}" ${String(x.id) === genre ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
      <select name="year">${yearOpts}</select>
      <select name="rating">
        <option value="">Any rating</option>
        ${[5, 6, 7, 8].map(r => `<option value="${r}" ${String(r) === minRating ? "selected" : ""}>${r}+ stars</option>`).join("")}
      </select>
      <select name="sort">${sorts.map(([v, l]) => `<option value="${v}" ${v === sort ? "selected" : ""}>${l}</option>`).join("")}</select>
    </form>
    <h1 class="page-title page-pad" style="padding-bottom:0">${q ? `Results for "${esc(q)}"` : mood ? esc(mood.label) : "Browse"}</h1>
    <div class="page-pad" style="color:var(--muted);font-size:13px;padding-top:2px">${data.total_results.toLocaleString()} titles</div>
    ${data.results.length ? `<div class="grid">${data.results.map(i => cardHTML(i, type)).join("")}</div>` : '<div class="empty">Nothing found. Try different filters.</div>'}
    <div class="pager">
      <button class="btn ghost" id="prevPg" ${page <= 1 ? "disabled" : ""}>&lsaquo; Prev</button>
      <span>Page ${page} of ${Math.min(data.total_pages, 500)}</span>
      <button class="btn ghost" id="nextPg" ${page >= Math.min(data.total_pages, 500) ? "disabled" : ""}>Next &rsaquo;</button>
    </div>`;

  const form = $("#filterForm");
  const go = (pg) => {
    const fd = new FormData(form);
    const np = new URLSearchParams();
    fd.forEach((v, k) => { if (v) np.set(k, v); });
    if (pg > 1) np.set("page", pg);
    location.hash = "#/search?" + np.toString();
  };
  form.addEventListener("submit", e => { e.preventDefault(); go(1); });
  form.querySelectorAll("select").forEach(s => s.addEventListener("change", () => go(1)));
  $("#prevPg").addEventListener("click", () => { go(page - 1); window.scrollTo(0, 0); });
  $("#nextPg").addEventListener("click", () => { go(page + 1); window.scrollTo(0, 0); });
}

function watchHTML(d) {
  const all = (d["watch/providers"] && d["watch/providers"].results) || {};
  const want = getRegion();
  let code = want, r = all[code], note = "";
  if (!r) {
    code = all.US ? "US" : Object.keys(all)[0];
    r = code ? all[code] : null;
    if (r) note = `Not listed in ${want}. Showing ${code}.`;
  }
  const picker = `<select id="regionSel" aria-label="Country">${REGIONS.map(([c, n]) => `<option value="${c}" ${c === want ? "selected" : ""}>${n}</option>`).join("")}</select>`;
  const groups = [["flatrate", "Stream"], ["free", "Free"], ["ads", "Free with ads"], ["rent", "Rent"], ["buy", "Buy"]];
  let body = "";
  if (r) {
    groups.forEach(([k, label]) => {
      if (!r[k] || !r[k].length) return;
      body += `<div class="ww-group"><b>${label}</b><div class="ww-logos">${r[k].map(p => `<a href="${esc(r.link || "#")}" target="_blank" rel="noopener" title="${esc(p.provider_name)}"><img src="${IMG}w92${p.logo_path}" alt="${esc(p.provider_name)}"></a>`).join("")}</div></div>`;
    });
  }
  if (!body) body = '<div class="ww-none">No streaming info available for this title yet.</div>';
  const tt = encodeURIComponent(d.title || d.name || "");
  const findFree = `<div class="ww-group"><b>Search for free</b><div class="ww-links">
    <a class="chip" href="https://tubitv.com/search/${tt}" target="_blank" rel="noopener">Tubi</a>
    <a class="chip" href="https://www.youtube.com/results?search_query=${tt}+full+movie" target="_blank" rel="noopener">YouTube</a>
    <a class="chip" href="https://archive.org/search?query=${tt}" target="_blank" rel="noopener">Internet Archive</a></div></div>`;
  return `<div class="ww-top">${picker}${note ? `<span class="ww-note">${esc(note)}</span>` : ""}</div>${body}${findFree}<div class="ww-credit">Streaming data by JustWatch</div>`;
}

async function viewDetail(type, id) {
  setActiveNav("");
  loading();
  const d = await tmdb(`/${type}/${id}`, { append_to_response: "videos,credits,similar,watch/providers" });
  const title = d.title || d.name;
  const date = d.release_date || d.first_air_date;
  const item = { id: d.id, type, title, poster: d.poster_path, date: date || "", rating: d.vote_average };
  addHistory(item);
  document.title = title + " - CineBox";

  const vids = (d.videos && d.videos.results) || [];
  const trailer = vids.find(v => v.site === "YouTube" && v.type === "Trailer") || vids.find(v => v.site === "YouTube");
  const cast = ((d.credits && d.credits.cast) || []).slice(0, 15);
  const runtime = type === "movie" ? (d.runtime ? `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m` : "-") : (d.episode_run_time && d.episode_run_time[0] ? d.episode_run_time[0] + " min/ep" : "-");
  const director = ((d.credits && d.credits.crew) || []).find(c => c.job === "Director");

  const facts = [
    ["Status", d.status || "-"],
    ["Language", (d.original_language || "-").toUpperCase()],
    type === "movie" ? ["Director", director ? director.name : "-"] : ["Seasons", `${d.number_of_seasons || "-"} (${d.number_of_episodes || "-"} eps)`],
    type === "movie" ? ["Budget", d.budget ? "$" + d.budget.toLocaleString() : "-"] : ["Network", (d.networks && d.networks[0] && d.networks[0].name) || "-"]
  ];

  app.innerHTML = `
    <div class="detail-bg" style="background-image:url(${d.backdrop_path ? IMG + "w1280" + d.backdrop_path : ""})"></div>
    <div class="detail-head">
      ${d.poster_path ? `<img class="poster" src="${IMG}w500${d.poster_path}" alt="${esc(title)}">` : '<div class="poster"></div>'}
      <div class="info">
        <h1>${esc(title)}</h1>
        <div class="meta">
          <span class="rating">&#9733; ${stars(d.vote_average)}</span>
          <span>${year(date) || "-"}</span><span>${runtime}</span>
          <span class="badge">${type === "tv" ? "TV Series" : "Movie"}</span>
        </div>
        <div class="meta" style="margin-top:6px">${(d.genres || []).map(x => `<span class="badge">${esc(x.name)}</span>`).join("")}</div>
      </div>
    </div>
    ${d.tagline ? `<div class="tagline">"${esc(d.tagline)}"</div>` : ""}
    <p class="overview">${esc(d.overview) || "No overview available."}</p>
    <div class="detail-actions btn-row">
      ${trailer ? '<button class="btn" id="trailerBtn">&#9654; Watch Trailer</button>' : ""}
      <button class="btn ghost" id="listBtn"></button>
      <button class="btn ghost" id="shareBtn" type="button">Share</button>
      ${d.homepage ? `<a class="btn ghost" href="${esc(d.homepage)}" target="_blank" rel="noopener">Official Site</a>` : ""}
    </div>
    <div class="facts">${facts.map(([k, v]) => `<div class="fact"><b>${k}</b><span>${esc(v)}</span></div>`).join("")}</div>
    <section class="section"><h2>Where to Watch</h2><div id="wwBox" class="ww"></div></section>
    ${cast.length ? `<section class="section"><h2>Top Cast</h2><div class="row">${cast.map(c => `
      <div class="cast">
        ${c.profile_path ? `<img loading="lazy" src="${IMG}w185${c.profile_path}" alt="${esc(c.name)}">` : '<div class="cph">&#9786;</div>'}
        <div class="cn">${esc(c.name)}</div><div class="cr">${esc(c.character)}</div>
      </div>`).join("")}</div></section>` : ""}
    ${rowHTML("More Like This", d.similar && d.similar.results, type)}
  `;

  const wwBox = $("#wwBox");
  const drawWatch = () => { wwBox.innerHTML = watchHTML(d); };
  drawWatch();
  wwBox.addEventListener("change", e => { if (e.target.id === "regionSel") { setRegion(e.target.value); drawWatch(); } });

  const listBtn = $("#listBtn");
  const refresh = () => {
    const on = inList(item.id, type);
    listBtn.innerHTML = on ? "&#10003; In My List" : "+ My List";
    listBtn.classList.toggle("on", on);
  };
  refresh();
  listBtn.addEventListener("click", () => { toggleList(item); refresh(); });
  bindShare($("#shareBtn"), title);
  if (trailer) $("#trailerBtn").addEventListener("click", () => playTrailer(trailer.key));
}

function viewWatchlist() {
  setActiveNav("watchlist");
  document.title = "My List - CineBox";
  const toCard = x => cardHTML({ id: x.id, media_type: x.type, title: x.title, poster_path: x.poster, release_date: x.date, vote_average: x.rating });
  const list = load(LS_LIST);
  const hist = load(LS_HIST);
  app.innerHTML = `
    <h1 class="page-title page-pad">My List</h1>
    ${list.length ? `<div class="grid">${list.map(toCard).join("")}</div>` : '<div class="empty">Your list is empty.<br>Open any title and tap "+ My List".</div>'}
    ${hist.length ? `<section class="section" style="padding-top:26px"><h2>Recently Viewed <a href="#/watchlist" id="clearHist">Clear</a></h2><div class="row">${hist.map(toCard).join("")}</div></section>` : ""}
  `;
  const c = $("#clearHist");
  if (c) c.addEventListener("click", e => { e.preventDefault(); save(LS_HIST, []); viewWatchlist(); });
}

/* ---------- free movies (Internet Archive, public domain) ---------- */
const FREE_CATS = {
  movies: ["Movies", "collection:feature_films AND mediatype:movies"],
  cartoons: ["Cartoons", "collection:animationandcartoons AND mediatype:movies"],
  tv: ["TV Classics", "collection:classic_tv AND mediatype:movies"],
  docs: ["Documentaries", "collection:moviesandfilms AND subject:documentary AND mediatype:movies"],
  silent: ["Silent Films", "collection:silent_films AND mediatype:movies"]
};

async function viewFree(p) {
  setActiveNav("free");
  document.title = "Free Movies - CineBox";
  loading();
  const q = p.get("q") || "";
  const rawCat = p.get("cat") || "";
  if (rawCat.startsWith("yt:")) return viewYT(rawCat.slice(3), p);
  const cat = FREE_CATS[rawCat] ? rawCat : "movies";
  const page = Math.max(1, parseInt(p.get("page") || "1", 10));
  const rows = 30;
  let query = FREE_CATS[cat][1];
  if (q) query += ` AND title:(${q.replace(/[^\w\s]/g, " ")})`;
  const u = new URL("https://archive.org/advancedsearch.php");
  u.searchParams.set("q", query);
  ["identifier", "title", "year"].forEach(f => u.searchParams.append("fl[]", f));
  u.searchParams.set("sort[]", "downloads desc");
  u.searchParams.set("rows", rows);
  u.searchParams.set("page", page);
  u.searchParams.set("output", "json");
  const r = await fetch(u);
  if (!r.ok) throw new Error("Archive error " + r.status);
  const data = (await r.json()).response;
  const pages = Math.max(1, Math.ceil(data.numFound / rows));

  const cards = data.docs.map(m => `
    <a class="card" href="#/free/${encodeURIComponent(m.identifier)}">
      <img class="poster" loading="lazy" src="https://archive.org/services/img/${encodeURIComponent(m.identifier)}" alt="${esc(m.title)}">
      <div class="ct">${esc(m.title)}</div>
      <div class="cs">${esc(m.year || "Classic")} &middot; Free</div>
    </a>`).join("");

  const tabsHTML = await freeTabsHTML(cat);
  app.innerHTML = `
    <div class="free-head">
      <h1>Free Movies</h1>
      <p>Public-domain classics you can watch right here.</p>
    </div>
    ${tabsHTML}
    ${page === 1 && !q ? continueRow() : ""}
    <form class="free-search" id="freeForm">
      <input type="search" name="q" placeholder="Search free movies..." value="${esc(q)}" aria-label="Search free movies">
      <button class="btn" type="submit">Search</button>
    </form>
    ${cards ? `<div class="grid free-grid">${cards}</div>` : '<div class="empty">No free movies found for that search.</div>'}
    <div class="pager">
      <button class="btn ghost" id="fPrev" ${page <= 1 ? "disabled" : ""}>&lsaquo; Prev</button>
      <span>${page} / ${pages}</span>
      <button class="btn ghost" id="fNext" ${page >= pages ? "disabled" : ""}>Next &rsaquo;</button>
    </div>`;

  const go = pg => {
    const np = new URLSearchParams();
    const v = $("#freeForm input").value.trim();
    if (cat !== "movies") np.set("cat", cat);
    if (v) np.set("q", v);
    if (pg > 1) np.set("page", pg);
    location.hash = "#/free" + (np.toString() ? "?" + np.toString() : "");
  };
  $("#freeForm").addEventListener("submit", e => { e.preventDefault(); go(1); });
  $("#fPrev").addEventListener("click", () => go(page - 1));
  $("#fNext").addEventListener("click", () => go(page + 1));
}

function archiveVideos(files) {
  const isVid = f => /\.(mp4|m4v|webm|ogv)$/i.test(f.name || "");
  const all = (files || []).filter(isVid);
  const good = all.filter(f => /h\.?264|mpeg4/i.test(f.format || ""));
  const list = (good.length ? good : all).filter(f => !/_512kb|_thumb|sample|trailer/i.test(f.name));
  const seen = new Set();
  return list.filter(f => !seen.has(f.name) && seen.add(f.name)).slice(0, 12);
}
const archiveUrl = (id, name) => "https://archive.org/download/" + encodeURIComponent(id) + "/" + name.split("/").map(encodeURIComponent).join("/");

async function viewFreePlayer(id) {
  setActiveNav("free");
  loading();
  const r = await fetch("https://archive.org/metadata/" + encodeURIComponent(id));
  if (!r.ok) throw new Error("Archive error " + r.status);
  const j = await r.json();
  const m = j.metadata || {};
  const title = Array.isArray(m.title) ? m.title[0] : m.title || id;
  let desc = Array.isArray(m.description) ? m.description.join(" ") : m.description || "";
  desc = desc.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  document.title = title + " - CineBox";
  const vids = archiveVideos(j.files);
  const saved = progAll()[id];
  const startI = saved && saved.i < vids.length ? saved.i : 0;
  const poster = "https://archive.org/services/img/" + encodeURIComponent(id);

  app.innerHTML = `
    <div class="back-row"><a href="#/free" class="chip">&lsaquo; All free movies</a></div>
    <div class="player"><div class="frame" id="frame"></div></div>
    ${vids.length > 1 ? `<div class="parts" id="parts">${vids.map((v, i) => `<button class="chip${i === startI ? " sel" : ""}" data-i="${i}">${esc(v.name.replace(/\.[^.]+$/, "").slice(-28))}</button>`).join("")}</div>` : ""}
    <h1 class="free-title">${esc(title)}</h1>
    <div class="meta free-meta">${m.year ? `<span>${esc(m.year)}</span>` : ""}${m.creator ? `<span>${esc(Array.isArray(m.creator) ? m.creator[0] : m.creator)}</span>` : ""}<span class="badge">Free</span></div>
    <p class="overview">${esc(desc.slice(0, 900)) || "No description available."}</p>
    <div class="detail-actions btn-row"><button class="btn ghost" id="shareBtn" type="button">Share</button><a class="btn ghost" target="_blank" rel="noopener" href="https://archive.org/details/${encodeURIComponent(id)}">Open on Internet Archive</a></div>`;

  bindShare($("#shareBtn"), title);
  const frame = $("#frame");
  const useEmbed = () => { frame.innerHTML = `<iframe src="https://archive.org/embed/${encodeURIComponent(id)}" allowfullscreen allow="fullscreen"></iframe>`; };
  const playFile = i => {
    frame.innerHTML = `<video controls playsinline preload="metadata" poster="${poster}" src="${archiveUrl(id, vids[i].name)}"></video>`;
    const v = $("video", frame);
    v.addEventListener("error", useEmbed, { once: true });
    v.addEventListener("loadedmetadata", () => {
      const s2 = progAll()[id];
      if (s2 && s2.i === i && s2.t > 10 && s2.t < v.duration - 30) v.currentTime = s2.t;
    }, { once: true });
    let last = 0;
    const store = () => {
      if (!v.duration || !isFinite(v.duration)) return;
      if (v.currentTime / v.duration > 0.95) { progSet(id, null); return; }
      if (v.currentTime > 10) progSet(id, { id, title, i, t: v.currentTime, d: v.duration, ts: Date.now() });
    };
    flushProgress = store;
    v.addEventListener("timeupdate", () => { const n = Date.now(); if (n - last > 5000) { last = n; store(); } });
    v.addEventListener("pause", store);
    v.addEventListener("ended", () => progSet(id, null));
  };
  if (vids.length) playFile(startI); else useEmbed();

  const parts = $("#parts");
  if (parts) parts.addEventListener("click", e => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    parts.querySelectorAll(".chip").forEach(c => c.classList.toggle("sel", c === b));
    playFile(+b.dataset.i);
  });
}

/* ---------- share ---------- */
function bindShare(btn, title) {
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const url = location.href, text = title + " on CineBox";
    if (navigator.share) { try { await navigator.share({ title, text, url }); } catch (e) {} }
    else window.open("https://wa.me/?text=" + encodeURIComponent(text + " " + url), "_blank", "noopener");
  });
}

/* ---------- YouTube free section (data/youtube.json built by GitHub Action) ---------- */
let ytP = null;
function loadYT() {
  if (!ytP) ytP = fetch("data/youtube.json?v=" + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null);
  return ytP;
}

async function freeTabsHTML(active) {
  const yt = await loadYT();
  const tabs = Object.entries(FREE_CATS).map(([k, v]) => [k, v[0]]);
  if (yt && yt.categories) Object.entries(yt.categories).forEach(([k, c]) => { if (c.items && c.items.length) tabs.push(["yt:" + k, c.label]); });
  return `<div class="chips free-tabs">${tabs.map(([k, l]) => `<a class="chip${k === active ? " sel" : ""}" href="#/free?cat=${encodeURIComponent(k)}">${esc(l)}</a>`).join("")}<a class="chip" href="#/sites">More free sites &rsaquo;</a></div>`;
}

const ytCard = x => `<a class="card wide" href="#/yt/${encodeURIComponent(x.id)}">
  <img class="poster" loading="lazy" src="${esc(x.thumb)}" alt="${esc(x.title)}">
  <span class="tag dur">${fmtTime(x.dur)}</span>
  <div class="ct">${esc(x.title)}</div>
  <div class="cs">${esc(x.channel)}</div>
</a>`;

async function viewYT(key, p) {
  const yt = await loadYT();
  const cat = yt && yt.categories && yt.categories[key];
  const tabs = await freeTabsHTML("yt:" + key);
  const q = (p.get("q") || "").trim();
  const page = Math.max(1, parseInt(p.get("page") || "1", 10));
  const per = 24;
  let items = cat ? cat.items : [];
  if (q) items = items.filter(i => i.title.toLowerCase().includes(q.toLowerCase()));
  const pages = Math.max(1, Math.ceil(items.length / per));
  const slice = items.slice((page - 1) * per, page * per);

  app.innerHTML = `
    <div class="free-head"><h1>${esc(cat ? cat.label : "Free")}</h1>
      <p>Full-length videos from official channels and Creative Commons uploads. Played through YouTube.</p></div>
    ${tabs}
    <form class="free-search" id="freeForm">
      <input type="search" name="q" placeholder="Search in this list..." value="${esc(q)}" aria-label="Search">
      <button class="btn" type="submit">Search</button>
    </form>
    ${slice.length ? `<div class="grid free-grid yt-grid">${slice.map(ytCard).join("")}</div>` : '<div class="empty">Nothing here yet.</div>'}
    <div class="pager">
      <button class="btn ghost" id="fPrev" ${page <= 1 ? "disabled" : ""}>&lsaquo; Prev</button>
      <span>${page} / ${pages}</span>
      <button class="btn ghost" id="fNext" ${page >= pages ? "disabled" : ""}>Next &rsaquo;</button>
    </div>`;

  const go = pg => {
    const np = new URLSearchParams({ cat: "yt:" + key });
    const v = $("#freeForm input").value.trim();
    if (v) np.set("q", v);
    if (pg > 1) np.set("page", pg);
    location.hash = "#/free?" + np.toString();
  };
  $("#freeForm").addEventListener("submit", e => { e.preventDefault(); go(1); });
  $("#fPrev").addEventListener("click", () => go(page - 1));
  $("#fNext").addEventListener("click", () => go(page + 1));
}

let ytApiP = null;
function loadYTApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(true);
  if (!ytApiP) ytApiP = new Promise(res => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(true); };
    const sc = document.createElement("script");
    sc.src = "https://www.youtube.com/iframe_api";
    sc.onerror = () => res(false);
    document.head.appendChild(sc);
    setTimeout(() => res(!!(window.YT && window.YT.Player)), 8000);
  });
  return ytApiP;
}
let ytTimer = null;

async function viewYTPlayer(id) {
  setActiveNav("free");
  if (!/^[\w-]{6,20}$/.test(id)) { location.replace("#/free"); return; }
  const yt = await loadYT();
  let item = null, catKey = "";
  if (yt && yt.categories) Object.entries(yt.categories).forEach(([k, c]) => { const f = (c.items || []).find(x => x.id === id); if (f && !item) { item = f; catKey = k; } });
  const title = item ? item.title : "Video";
  document.title = title + " - CineBox";
  const more = item ? yt.categories[catKey].items.filter(x => x.id !== id).slice(0, 12) : [];
  app.innerHTML = `
    <div class="back-row"><a href="#/free${catKey ? "?cat=" + encodeURIComponent("yt:" + catKey) : ""}" class="chip">&lsaquo; Back</a></div>
    <div class="player"><div class="frame"><div id="ytp"></div></div></div>
    <h1 class="free-title">${esc(title)}</h1>
    <div class="meta free-meta">${item ? `<span>${esc(item.channel)}</span><span>${fmtTime(item.dur)}</span>` : ""}<span class="badge">Free</span></div>
    <div class="detail-actions btn-row" style="padding-top:12px">
      <button class="btn ghost" id="shareBtn" type="button">Share</button>
      <a class="btn ghost" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${encodeURIComponent(id)}">Open on YouTube</a>
    </div>
    ${more.length ? `<section class="section"><h2>More like this</h2><div class="row">${more.map(ytCard).join("")}</div></section>` : ""}`;
  bindShare($("#shareBtn"), title);

  const frame = $(".player .frame");
  const plain = () => { frame.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`; };
  const ok = await loadYTApi();
  if (!$("#ytp")) return; /* user already left this page */
  if (!ok) { plain(); return; }

  const key = "yt_" + id;
  const saved = progAll()[key];
  let player;
  const store = () => {
    try {
      const t = player.getCurrentTime(), d = player.getDuration();
      if (!d) return;
      if (t / d > 0.95) { progSet(key, null); return; }
      if (t > 10) progSet(key, { key, yt: 1, id, title, thumb: item ? item.thumb : "", t, d, ts: Date.now() });
    } catch (e) {}
  };
  flushProgress = store;
  player = new YT.Player("ytp", {
    host: "https://www.youtube-nocookie.com",
    videoId: id,
    playerVars: { autoplay: 1, rel: 0, playsinline: 1, start: saved && saved.t > 10 ? Math.floor(saved.t) : 0 },
    events: {
      onStateChange: e => {
        if (e.data === 2) store();
        if (e.data === 0) progSet(key, null);
      },
      onError: () => { clearInterval(ytTimer); plain(); }
    }
  });
  clearInterval(ytTimer);
  ytTimer = setInterval(() => {
    if (!document.body.contains(frame)) { clearInterval(ytTimer); return; }
    try { if (player.getPlayerState() === 1) store(); } catch (e) {}
  }, 5000);
}

/* ---------- free streaming sites directory (links out, official sites only) ---------- */
const FREE_SITES = [
  { name: "Tubi", url: "https://tubitv.com", note: "Large free library with ads: movies and TV." },
  { name: "Pluto TV", url: "https://pluto.tv", note: "Free live channels plus on-demand movies and shows." },
  { name: "Plex (free)", url: "https://watch.plex.tv", note: "Free ad-supported movies and live TV." },
  { name: "The Roku Channel", url: "https://therokuchannel.roku.com", note: "Free ad-supported movies and shows." },
  { name: "YouTube Movies", url: "https://www.youtube.com/movies", note: "Has a free-with-ads section of full movies." },
  { name: "Internet Archive", url: "https://archive.org/details/movies", note: "Public-domain films, classic TV, cartoons. Played inside CineBox's Free tab." },
  { name: "Open Culture", url: "https://www.openculture.com/freemovies", note: "Hand-picked list of legally free classic films and documentaries." },
  { name: "Kanopy", url: "https://www.kanopy.com", note: "Free with a participating public library or university login." }
];

function viewSites() {
  setActiveNav("free");
  document.title = "Free Streaming Sites - CineBox";
  app.innerHTML = `
    <div class="free-head"><h1>More Free Sites</h1>
      <p>Official free streaming services. They open on their own websites, and some are only available in certain countries.</p></div>
    <div class="sites">${FREE_SITES.map(s => `
      <a class="site" href="${s.url}" target="_blank" rel="noopener noreferrer">
        <b>${esc(s.name)}</b><small>${esc(s.url.replace(/^https?:\/\/(www\.)?/, ""))}</small>
        <span>${esc(s.note)}</span>
      </a>`).join("")}</div>
    <p class="sites-note">CineBox only links to services that license their content. These sites don't offer embeds, so playback happens on their pages.</p>`;
}

/* ---------- router ---------- */
async function route() {
  if (flushProgress) { try { flushProgress(); } catch (e) {} flushProgress = null; }
  clearInterval(ytTimer);
  closeModal();
  hideSuggest();
  clearInterval(heroTimer);
  window.scrollTo(0, 0);
  document.title = "CineBox - Discover Movies & TV";
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  const p = new URLSearchParams(qs || "");
  const parts = path.split("/").filter(Boolean);

  if (parts[0] !== "free" && parts[0] !== "watchlist" && parts[0] !== "yt" && parts[0] !== "sites" && keyMissing()) {
    showError('Add your TMDB API key: open <code>config.js</code> and put your free key (from themoviedb.org/settings/api) inside the quotes after <code>TMDB_API_KEY</code>.');
    return;
  }

  try {
    if (!parts.length) await viewHome();
    else if (parts[0] === "search") await viewSearch(p);
    else if ((parts[0] === "movie" || parts[0] === "tv") && parts[1]) await viewDetail(parts[0], parts[1]);
    else if (parts[0] === "watchlist") viewWatchlist();
    else if (parts[0] === "yt" && parts[1]) await viewYTPlayer(decodeURIComponent(parts[1]));
    else if (parts[0] === "surprise") await viewSurprise();
    else if (parts[0] === "sites") viewSites();
    else if (parts[0] === "free" && parts[1]) await viewFreePlayer(decodeURIComponent(parts[1]));
    else if (parts[0] === "free") await viewFree(p);
    else await viewHome();
  } catch (err) {
    console.error(err);
    showError("Something went wrong loading this page. Check your internet connection" + (keyMissing() ? "" : " and API key") + ", then refresh.");
  }
}

$("#topSearch").addEventListener("submit", e => {
  e.preventDefault();
  const v = $("#topSearchInput").value.trim();
  if (v) { location.hash = "#/search?q=" + encodeURIComponent(v); $("#topSearchInput").blur(); }
});

/* ---------- search suggestions ---------- */
const sugBox = $("#suggest");
const hideSuggest = () => { sugBox.classList.add("hidden"); sugBox.innerHTML = ""; };
let sugTimer = null, sugSeq = 0;
$("#topSearchInput").addEventListener("input", e => {
  clearTimeout(sugTimer);
  const v = e.target.value.trim();
  if (v.length < 2 || keyMissing()) { hideSuggest(); return; }
  sugTimer = setTimeout(async () => {
    const my = ++sugSeq;
    try {
      const d = await tmdb("/search/multi", { query: v });
      if (my !== sugSeq) return;
      const rows = d.results.filter(x => x.media_type === "movie" || x.media_type === "tv").slice(0, 6);
      if (!rows.length) { hideSuggest(); return; }
      sugBox.innerHTML = rows.map(x => {
        const t = x.title || x.name;
        return `<a href="#/${x.media_type}/${x.id}">
          ${x.poster_path ? `<img src="${IMG}w92${x.poster_path}" alt="">` : '<span class="sph"></span>'}
          <span><b>${esc(t)}</b><small>${year(x.release_date || x.first_air_date) || "-"} &middot; ${x.media_type === "tv" ? "TV" : "Movie"}</small></span></a>`;
      }).join("");
      sugBox.classList.remove("hidden");
    } catch (err) { hideSuggest(); }
  }, 250);
});
sugBox.addEventListener("click", () => { hideSuggest(); $("#topSearchInput").value = ""; });
document.addEventListener("click", e => { if (!e.target.closest("#topSearch")) hideSuggest(); });
$("#topSearch").addEventListener("submit", hideSuggest);

/* ---------- install app + offline shell ---------- */
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; $("#installBtn").classList.remove("hidden"); });
$("#installBtn").addEventListener("click", async () => {
  if (!installEvt) return;
  installEvt.prompt();
  try { await installEvt.userChoice; } catch (e) {}
  installEvt = null;
  $("#installBtn").classList.add("hidden");
});
window.addEventListener("appinstalled", () => $("#installBtn").classList.add("hidden"));
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

document.addEventListener("click", e => {
  const rm = e.target.closest("[data-rm]");
  const clr = e.target.closest("[data-clear-prog]");
  if (rm) {
    e.preventDefault();
    progSet(rm.dataset.rm, null);
    const sec = rm.closest("[data-prog-section]");
    rm.closest(".card").remove();
    if (sec && !sec.querySelector(".card")) sec.remove();
  } else if (clr) {
    e.preventDefault();
    try { localStorage.removeItem(LS_PROG); } catch (err) {}
    document.querySelectorAll("[data-prog-section]").forEach(x => x.remove());
  }
});

window.addEventListener("hashchange", route);
route();
