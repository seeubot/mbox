const PROGRESS_KEY = "maya.watch_progress";
const FAVORITES_KEY = "maya.favorites";
const HISTORY_KEY = "maya.searchHistory";
const QUALITY_KEY = "maya.qualityPreference";
function keyOf(item) {
  const s = item.season != null ? item.season : 0;
  const e = item.episode != null ? item.episode : 0;
  return item.provider + ":" + item.id + ":" + s + ":" + e;
}
function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
export const storage = {
  saveProgress(item, seconds, duration) {
    if (!item || !item.id || !item.provider) return;
    if (!duration || duration <= 0) return;
    const map = readJson(PROGRESS_KEY, {});
    const key = keyOf(item);
    const pct = Math.min(100, Math.round((seconds / duration) * 100));
    map[key] = {
      id: item.id,
      provider: item.provider,
      title: item.title,
      poster: item.poster || null,
      year: item.year || null,
      media_type: item.media_type || "movie",
      season: item.season || 0,
      episode: item.episode || 0,
      position: Math.floor(seconds),
      duration: Math.floor(duration),
      percent: pct,
      updated_at: Date.now(),
    };
    if (pct >= 95) delete map[key];
    writeJson(PROGRESS_KEY, map);
  },
  getProgress(item) {
    if (!item || !item.id) return null;
    const map = readJson(PROGRESS_KEY, {});
    return map[keyOf(item)] || null;
  },
  listContinueWatching(limit = 20) {
    const map = readJson(PROGRESS_KEY, {});
    const arr = Object.values(map);
    arr.sort((a, b) => b.updated_at - a.updated_at);
    return arr.slice(0, limit);
  },
  loadFavorites() {
    return readJson(FAVORITES_KEY, []);
  },
  isFavorite(item) {
    if (!item || !item.id) return false;
    const list = this.loadFavorites();
    return list.some(
      (x) => x.provider === item.provider && x.id === item.id
    );
  },
  toggleFavorite(item) {
    const list = this.loadFavorites();
    const exists = list.some(
      (x) => x.provider === item.provider && x.id === item.id
    );
    if (exists) {
      const next = list.filter(
        (x) => !(x.provider === item.provider && x.id === item.id)
      );
      writeJson(FAVORITES_KEY, next);
      return false;
    }
    list.unshift({
      id: item.id,
      provider: item.provider,
      title: item.title,
      poster: item.poster || null,
      year: item.year || null,
      media_type: item.media_type || "movie",
      added_at: Date.now(),
    });
    writeJson(FAVORITES_KEY, list.slice(0, 200));
    return true;
  },
  loadHistory() {
    const arr = readJson(HISTORY_KEY, []);
    return Array.isArray(arr) ? arr.slice(0, 12) : [];
  },
  addHistory(term) {
    const trimmed = String(term || "").trim();
    if (!trimmed) return;
    const prev = this.loadHistory();
    const filtered = prev.filter(
      (x) => x.toLowerCase() !== trimmed.toLowerCase()
    );
    writeJson(HISTORY_KEY, [trimmed, ...filtered].slice(0, 12));
  },
  clearHistory() {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {}
  },
  getQuality() {
    return localStorage.getItem(QUALITY_KEY) || "auto";
  },
  setQuality(q) {
    try {
      localStorage.setItem(QUALITY_KEY, q);
    } catch {}
  },
};