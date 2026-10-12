const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  "https://sour-cheetah-seeutech-508ef070.koyeb.app";
async function get(path) {
  const url = API_URL + path;
  const startedAt = Date.now();
  console.log("[api] GET " + url);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const elapsed = Date.now() - startedAt;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.log(
        "[api] FAIL " + response.status + " (" + elapsed + "ms) " + path
      );
      console.log("[api] body " + text.slice(0, 300));
      throw new Error(
        "HTTP " + response.status + (text ? ": " + text.slice(0, 120) : "")
      );
    }
    const data = await response.json();
    console.log("[api] OK " + response.status + " (" + elapsed + "ms) " + path);
    return data;
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    console.log("[api] ERR (" + elapsed + "ms) " + path);
    console.log("[api] err " + (err.message || String(err)));
    throw err;
  }
}
export const api = {
  search: (query, page = 1) =>
    get("/api/search?q=" + encodeURIComponent(query) + "&page=" + page),
  details: (id) => get("/api/details?id=" + encodeURIComponent(id)),
  streams: (id, season = 0, episode = 0, audio = null, maxHeight = null) => {
    let path =
      "/api/streams?id=" +
      encodeURIComponent(id) +
      "&season=" +
      season +
      "&episode=" +
      episode;
    if (audio && String(audio).length > 0) {
      path += "&audio=" + encodeURIComponent(audio);
    }
    if (maxHeight && maxHeight !== "auto") {
      path += "&max_height=" + encodeURIComponent(maxHeight);
    }
    return get(path);
  },
  downloadInfo: (
    id,
    season = 0,
    episode = 0,
    audio = null,
    title = null,
    maxHeight = null
  ) => {
    let path =
      "/api/download-info?id=" +
      encodeURIComponent(id) +
      "&season=" +
      season +
      "&episode=" +
      episode;
    if (audio && String(audio).length > 0) {
      path += "&audio=" + encodeURIComponent(audio);
    }
    if (title) {
      path += "&title=" + encodeURIComponent(title);
    }
    if (maxHeight && maxHeight !== "auto") {
      path += "&max_height=" + encodeURIComponent(maxHeight);
    }
    return get(path);
  },
  providers: () => get("/api/providers"),
  vegaProviders: () => get("/api/vega/providers"),
  vegaCatalog: (provider) =>
    get("/api/vega/catalog?provider=" + encodeURIComponent(provider)),
  vegaPosts: (provider, filter = "", page = 1) =>
    get(
      "/api/vega/posts?provider=" +
        encodeURIComponent(provider) +
        "&filter=" +
        encodeURIComponent(filter) +
        "&page=" +
        page
    ),
  vegaSearch: (provider, query, page = 1) =>
    get(
      "/api/vega/search?provider=" +
        encodeURIComponent(provider) +
        "&q=" +
        encodeURIComponent(query) +
        "&page=" +
        page
    ),
  vegaDetails: (provider, link) =>
    get(
      "/api/vega/details?provider=" +
        encodeURIComponent(provider) +
        "&link=" +
        encodeURIComponent(link)
    ),
  vegaEpisodes: (provider, url) =>
    get(
      "/api/vega/episodes?provider=" +
        encodeURIComponent(provider) +
        "&url=" +
        encodeURIComponent(url)
    ),
  vegaStream: (provider, link, type = "movie") =>
    get(
      "/api/vega/stream?provider=" +
        encodeURIComponent(provider) +
        "&link=" +
        encodeURIComponent(link) +
        "&type=" +
        encodeURIComponent(type)
    ),
};
export function buildDownloadUrl({
  id,
  season = 0,
  episode = 0,
  audio,
  title,
  maxHeight,
}) {
  let path =
    API_URL +
    "/api/download?id=" +
    encodeURIComponent(id) +
    "&season=" +
    season +
    "&episode=" +
    episode;
  if (audio && String(audio).length > 0) {
    path += "&audio=" + encodeURIComponent(audio);
  }
  if (title) {
    path += "&title=" + encodeURIComponent(title);
  }
  if (maxHeight && maxHeight !== "auto") {
    path += "&max_height=" + encodeURIComponent(maxHeight);
  }
  return path;
}