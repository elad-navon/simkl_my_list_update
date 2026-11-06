// The outside services the page reads from, besides the episode lists
// (episode-source.js): TMDB's show details, seasons, credits and ids;
// MDBList's ratings; and the image picker's extra pictures - TVMaze and
// Metahub (no key), Fanart.tv and TheTVDB (a key from Settings).
//
// What the page provides is passed in - how to fetch, the kept copies
// (readPersistedCache / writePersistedCache), the keys, what to say when a
// key is refused - so this runs (and is tested) in Node as well. Answers are
// kept per their own time, a request already on its way is shared, and a
// failure is never kept (the next look asks again). Runs in the browser
// (window.OutsideSources) and in Node.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OutsideSources = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAY = 24 * 60 * 60 * 1000;

  // A value from the kept copy, else fetched and kept - one request per key
  // even when asked for again while it's on its way; null on failure.
  function memo(map, key, load) {
    if (!map.has(key)) map.set(key, Promise.resolve().then(load).catch(() => null));
    return map.get(key);
  }
  const keptOrFetched = (persisted, cacheKey, ttl, fetchIt) =>
    persisted.read(cacheKey, ttl).then(cached => (cached !== undefined ? cached : fetchIt().then(data => {
      if (data) persisted.write(cacheKey, data);
      return data;
    })));

  // ---- TMDB ---------------------------------------------------------------
  // get(path, params): TMDB's JSON (or null). Same methods as the page's
  // TmdbCache always had.
  const TMDB_TTL = { show: DAY, season: 6 * 3600 * 1000, episodeIds: 7 * DAY, credits: DAY, personIds: 7 * DAY };
  function createTmdbClient({ get, persisted, ttl = {} }) {
    const t = { ...TMDB_TTL, ...ttl };
    const maps = { show: new Map(), season: new Map(), episodeIds: new Map(), credits: new Map(), personIds: new Map() };
    const one = (kind, key, cacheKey, path, params) =>
      memo(maps[kind], key, () => keptOrFetched(persisted, cacheKey, t[kind], () => get(path, params)));
    return {
      // tmdbshow2: the cache key went up when content_ratings joined the
      // request, so copies from before it (without the age rating) aren't
      // served for a day. Images (all, for the picker), external ids and age
      // ratings come with the one request every show needs anyway; English
      // and untagged pictures, Hebrew as the fallback.
      getShow: id => one("show", id, `tmdbshow2:${id}`, `/tv/${id}`, {
        append_to_response: "images,external_ids,content_ratings", language: "en-US", include_image_language: "en,null,he",
      }),
      getSeason: (id, season) => one("season", `${id}:${season}`, `tmdbseason:${id}:${season}`, `/tv/${id}/season/${season}`),
      // Per-episode IMDb ids have an endpoint of their own: asked lazily.
      getEpisodeExternalIds: (id, season, episode) => one("episodeIds", `${id}:${season}:${episode}`,
        `tmdbepids:${id}:${season}:${episode}`, `/tv/${id}/season/${season}/episode/${episode}/external_ids`),
      // aggregate_credits counts every season, so long-running main cast
      // rank near the top in a show's later seasons too.
      getCredits: id => one("credits", id, `tmdbcredits:${id}`, `/tv/${id}/aggregate_credits`),
      getPersonExternalIds: id => one("personIds", id, `tmdbpersonids:${id}`, `/person/${id}/external_ids`),
    };
  }

  // ---- MDBList ratings -----------------------------------------------------
  // get(imdbId, recent) -> { imdb, tomatoes, popcorn, trakt } or null. Five
  // requests at a time. A refused key stops all requests (onRejected says
  // so once) until `disabled` is set back to false (a new key in Settings).
  function createMdblist({ fetch, key, persisted, ttlMs = DAY, recentTtlMs = 6 * 3600 * 1000, onRejected = () => {}, parallel = 5 }) {
    const map = new Map();
    let active = 0;
    const waiting = [];
    const api = { disabled: false };
    async function fetchOne(imdbId, k) {
      if (active >= parallel) await new Promise(r => waiting.push(r));
      active++;
      try {
        const res = await fetch(`https://api.mdblist.com/imdb/show/${imdbId}?apikey=${encodeURIComponent(k)}`);
        if (res.status === 401 || res.status === 403) {
          if (!api.disabled) onRejected();
          api.disabled = true;
          return null;
        }
        // Unknown to MDBList: "nothing", kept, rather than asked every load.
        if (res.status === 404) return { imdb: null, tomatoes: null, popcorn: null, trakt: null };
        if (!res.ok) return null;
        const by = {};
        for (const r of (await res.json()).ratings || []) if (r && typeof r.value === "number") by[r.source] = r.value;
        const pick = s => (by[s] != null ? by[s] : null);
        return { imdb: pick("imdb"), tomatoes: pick("tomatoes"), popcorn: pick("popcorn"), trakt: pick("trakt") };
      } finally {
        active--;
        const next = waiting.shift();
        if (next) next();
      }
    }
    // `recent`: a show in its first month is read again sooner.
    api.get = (imdbId, recent) => {
      const k = key();
      if (!k || !imdbId || api.disabled) return Promise.resolve(null);
      return memo(map, imdbId, () => keptOrFetched(persisted, `mdblist:${imdbId}`, recent ? recentTtlMs : ttlMs, () => fetchOne(imdbId, k)));
    };
    return api;
  }

  // ---- The image picker's extra pictures ------------------------------------
  // wsrv.nl: a free, caching image resizer. Some sources only serve huge
  // originals (TVMaze backgrounds are 1920x1080, 400-500 KB each); resized, a
  // thumbnail is ~8 KB and the banner actually shown ~45 KB.
  const resizedImage = (url, width) => `https://wsrv.nl/?output=jpg&q=75&w=${width}&url=${encodeURIComponent(url)}`;
  const isImdbId = id => /^tt\d+$/.test(String(id || ""));

  // Metahub: at most one poster and one background, by IMDb id - plain links,
  // nothing to ask first.
  function metahubImages(imdbId) {
    if (!isImdbId(imdbId)) return { poster: [], banner: [] };
    const meta = "https://images.metahub.space";
    return {
      poster: [{ url: resizedImage(`${meta}/poster/medium/${imdbId}/img`, 342), thumb: `${meta}/poster/small/${imdbId}/img`, src: "Metahub" }],
      banner: [{ url: resizedImage(`${meta}/background/medium/${imdbId}/img`, 780), thumb: resizedImage(`${meta}/background/medium/${imdbId}/img`, 300), src: "Metahub" }],
    };
  }

  const TVDB_API = "https://api4.thetvdb.com/v4";
  const TVDB_TOKEN_MS = 25 * DAY;
  const IMAGES_TTL_MS = 7 * DAY;

  // createImageSources({ fetchWithTimeout, tvmazeGet, persisted, fanartKey,
  //   tvdbKey, tokenStore, onRejected, now })
  // - fetchWithTimeout(url, options): gives up after a while (other people's
  //   servers, now and then not answering)
  // - tvmazeGet(url, timeoutMs): TVMaze, paced and retried (the page's)
  // - tokenStore: { read(), write(v) } - TheTVDB's month-long read token
  // - onRejected(name): a key was refused ("Fanart.tv" / "TheTVDB")
  // Each list holds { url, thumb, src }: `url` is what a card shows once
  // picked, `thumb` what the gallery shows.
  function createImageSources({ fetchWithTimeout, tvmazeGet, persisted, fanartKey, tvdbKey, tokenStore, onRejected = () => {}, now = () => Date.now() }) {
    const rejected = { fanart: false, tvdb: false };
    let loginPending = null;

    // TVMaze (many posters and 16:9 backgrounds, by IMDb id) and Metahub.
    // { poster, banner, tvdbId }; kept a week, but not when TVMaze's picture
    // list didn't come (the next opening asks again) or the lookup failed.
    async function keyless(imdbId) {
      const out = { poster: [], banner: [], tvdbId: null };
      if (!imdbId) return out;
      const cacheKey = `extraimages2:${imdbId}`; // 2: TVMaze poster tiles from the full-size file
      const cached = await persisted.read(cacheKey, IMAGES_TTL_MS);
      if (cached !== undefined) return cached;
      let partial = false;
      try {
        const lookup = await tvmazeGet(`https://api.tvmaze.com/lookup/shows?imdb=${imdbId}`);
        if (lookup.ok) {
          const show = await lookup.json();
          out.tvdbId = (show.externals && show.externals.thetvdb) || null; // lets Fanart.tv find the show too
          // TVMaze builds a show's picture list on the first request in a
          // while, which takes 5-10 seconds: a longer wait for this one.
          const res = await tvmazeGet(`https://api.tvmaze.com/shows/${show.id}/images`, 25000);
          if (res.ok) {
            for (const img of await res.json()) {
              const original = img.resolutions && img.resolutions.original && img.resolutions.original.url;
              if (!original) continue;
              // Tiles from the same full-size file the card will show: TVMaze
              // has dropped the full size of some posters but kept the small
              // one, which made a fine tile that broke once picked.
              if (img.type === "poster") out.poster.push({ url: resizedImage(original, 342), thumb: resizedImage(original, 200), src: "TVMaze" });
              else if (img.type === "background") out.banner.push({ url: resizedImage(original, 780), thumb: resizedImage(original, 300), src: "TVMaze" });
            }
          } else {
            partial = true;
          }
        } else if (lookup.status !== 404) {
          return out; // a TVMaze hiccup: what we have, asked again next time
        }
      } catch (e) {
        return out; // offline / blocked
      }
      const meta = metahubImages(imdbId);
      out.poster.push(...meta.poster);
      out.banner.push(...meta.banner);
      if (!partial) persisted.write(cacheKey, out);
      return out;
    }

    // Fanart.tv: community-curated, the richest of them; full-size
    // originals plus a small /preview/ copy for the gallery. By TheTVDB id.
    async function fanart(tvdbId) {
      const out = { poster: [], banner: [] };
      const key = fanartKey();
      if (!key || !tvdbId || rejected.fanart) return out;
      const cacheKey = `fanart:${tvdbId}`;
      const cached = await persisted.read(cacheKey, IMAGES_TTL_MS);
      if (cached !== undefined) return cached;
      try {
        const res = await fetchWithTimeout(`https://webservice.fanart.tv/v3/tv/${tvdbId}?api_key=${encodeURIComponent(key)}`);
        if (res.status === 401 || res.status === 403) { rejected.fanart = true; onRejected("Fanart.tv"); return out; }
        if (res.status === 404) { persisted.write(cacheKey, out); return out; } // not in their database
        if (!res.ok) return out;
        const d = await res.json();
        const usable = x => x && x.url;
        const english = x => !x.lang || x.lang === "en" || x.lang === "00";
        const byLikes = (a, b) => (Number(b.likes) || 0) - (Number(a.likes) || 0);
        const preview = u => u.replace("/fanart/", "/preview/");
        for (const img of (d.tvposter || []).filter(usable).filter(english).sort(byLikes)) {
          out.poster.push({ url: resizedImage(img.url, 342), thumb: preview(img.url), src: "Fanart.tv" });
        }
        // Backgrounds and the 16:9 "thumbs" both work as banners.
        for (const img of (d.showbackground || []).concat(d.tvthumb || []).filter(usable).sort(byLikes)) {
          out.banner.push({ url: resizedImage(img.url, 780), thumb: preview(img.url), src: "Fanart.tv" });
        }
        persisted.write(cacheKey, out);
      } catch (e) {
        // offline / blocked: none from Fanart.tv this time
      }
      return out;
    }

    // TheTVDB's read token: bought with the key, good for a month, kept with
    // the key it belongs to; one login shared by lookups at the same time.
    async function login(key) {
      const res = await fetchWithTimeout(`${TVDB_API}/login`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apikey: key }),
      });
      if (res.status === 401 || res.status === 403) { rejected.tvdb = true; onRejected("TheTVDB"); return null; }
      if (!res.ok) return null;
      const token = ((await res.json()).data || {}).token;
      if (token) tokenStore.write({ key, token, at: now() });
      return token || null;
    }
    function tvdbToken(key, fresh) {
      const saved = tokenStore.read();
      if (!fresh && saved && saved.key === key && saved.token && now() - saved.at < TVDB_TOKEN_MS) return Promise.resolve(saved.token);
      if (!loginPending) loginPending = login(key).finally(() => { loginPending = null; });
      return loginPending;
    }

    // TheTVDB: the artwork SIMKL and Emby show (often the newest key art).
    // Posters (type 2) and 16:9 backgrounds (type 3) only - their "banners"
    // are 758x140 strips a 16:9 card would crop to nothing. A 401: the token
    // ran out - one fresh login and a retry.
    async function tvdb(tvdbId) {
      const out = { poster: [], banner: [] };
      const key = tvdbKey();
      if (!key || !tvdbId || rejected.tvdb) return out;
      const cacheKey = `tvdb:${tvdbId}`;
      const cached = await persisted.read(cacheKey, IMAGES_TTL_MS);
      if (cached !== undefined) return cached;
      try {
        let token = await tvdbToken(key, false);
        if (!token) return out;
        const artworks = async type => {
          const url = `${TVDB_API}/series/${tvdbId}/artworks?type=${type}`;
          let res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
          if (res.status === 401 && (token = await tvdbToken(key, true))) {
            res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
          }
          if (res.status === 404) return [];
          if (!res.ok) throw new Error(`TheTVDB ${res.status}`);
          return ((await res.json()).data || {}).artworks || [];
        };
        const [posters, backgrounds] = await Promise.all([artworks(2), artworks(3)]);
        const usable = x => x && x.image && (!x.language || x.language === "eng");
        const byScore = (a, b) => (Number(b.score) || 0) - (Number(a.score) || 0);
        for (const img of posters.filter(usable).sort(byScore)) {
          out.poster.push({ url: resizedImage(img.image, 342), thumb: img.thumbnail || resizedImage(img.image, 200), src: "TheTVDB" });
        }
        for (const img of backgrounds.filter(usable).sort(byScore)) {
          out.banner.push({ url: resizedImage(img.image, 780), thumb: img.thumbnail || resizedImage(img.image, 300), src: "TheTVDB" });
        }
        persisted.write(cacheKey, out);
      } catch (e) {
        // offline / blocked: none from TheTVDB this time
      }
      return out;
    }

    return {
      keyless, fanart, tvdb, tvdbToken,
      rejected: name => !!rejected[name],
      // A new key in Settings: try again.
      resetRejected: () => { rejected.fanart = false; rejected.tvdb = false; },
    };
  }

  return { createTmdbClient, createMdblist, createImageSources, metahubImages, resizedImage, isImdbId, TMDB_TTL };
});
