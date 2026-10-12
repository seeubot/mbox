import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { storage } from "../storage/library";
import "./Search.css";
const VEGA_PROVIDERS = ["4khdhub", "kmmovies", "guardahd", "ridoMovies"];
const DEBOUNCE_MS = 400;
export default function Search() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [history, setHistory] = useState([]);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const abortRef = useRef(0);
  useEffect(() => {
    setHistory(storage.loadHistory());
    inputRef.current?.focus();
  }, []);
  const searchMoviebox = useCallback(async (q) => {
    try {
      const data = await api.search(q, 1);
      return (data.results || []).map((item) => ({
        key: "mb:" + item.id,
        source: "moviebox",
        sourceLabel: "MOVIEBOX",
        id: item.id,
        link: null,
        provider: "moviebox",
        title: item.title,
        year: item.year,
        image: item.poster_url,
      }));
    } catch {
      return [];
    }
  }, []);
  const searchVega = useCallback(async (provider, q) => {
    try {
      const data = await api.vegaSearch(provider, q, 1);
      const posts = data.posts || [];
      return posts.map((post, idx) => ({
        key: "vega:" + provider + ":" + idx + ":" + post.link,
        source: "vega",
        provider,
        sourceLabel: provider.toUpperCase(),
        id: null,
        link: post.link,
        title: post.title,
        year: extractYear(post.title),
        image: post.image,
      }));
    } catch {
      return [];
    }
  }, []);
  const runSearch = useCallback(
    async (q, { save = true } = {}) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setResults([]);
        setHasSearched(false);
        return;
      }
      const token = ++abortRef.current;
      setLoading(true);
      try {
        const all = await Promise.all([
          searchMoviebox(trimmed),
          ...VEGA_PROVIDERS.map((p) => searchVega(p, trimmed)),
        ]);
        if (token !== abortRef.current) return;
        const merged = all.flat();
        const seen = new Set();
        const unique = [];
        for (const item of merged) {
          const dedupeKey = (item.title || "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "")
            .slice(0, 40);
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          unique.push(item);
        }
        setResults(unique);
        setHasSearched(true);
        if (save) {
          storage.addHistory(trimmed);
          setHistory(storage.loadHistory());
        }
      } catch {
      } finally {
        if (token === abortRef.current) setLoading(false);
      }
    },
    [searchMoviebox, searchVega]
  );
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      abortRef.current++;
      setResults([]);
      setHasSearched(false);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      runSearch(trimmed, { save: false });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);
  const handleSelect = (item) => {
    storage.addHistory(query);
    const params = new URLSearchParams();
    params.set("title", item.title);
    if (item.source === "vega") {
      params.set("link", item.link);
      navigate(`/details/${item.provider}/vega?${params}`);
    } else {
      navigate(`/details/moviebox/${item.id}?${params}`);
    }
  };
  const showHistory = !query.trim() && !hasSearched && history.length > 0;
  return (
    <div className="search">
      <header className="search-header">
        <button className="back-btn" onClick={() => navigate("/")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div className="search-input-wrap">
          <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Search movies and series"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="clear-btn" onClick={() => setQuery("")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="m15 9-6 6M9 9l6 6" />
              </svg>
            </button>
          )}
        </div>
      </header>
      {showHistory && (
        <div className="history">
          <div className="history-header">
            <div className="history-title">Recent searches</div>
            <button
              className="clear-history-btn"
              onClick={() => {
                storage.clearHistory();
                setHistory([]);
              }}
            >
              Clear
            </button>
          </div>
          <div className="chips">
            {history.map((term) => (
              <button
                key={term}
                className="chip"
                onClick={() => {
                  setQuery(term);
                  runSearch(term, { save: true });
                }}
              >
                {term}
              </button>
            ))}
          </div>
        </div>
      )}
      {loading && <div className="loading">Searching</div>}
      {!loading && hasSearched && results.length === 0 && (
        <div className="empty">
          <div className="empty-title">No results</div>
          <div className="empty-text">Try a different title.</div>
        </div>
      )}
      {!loading && results.length > 0 && (
        <div className="grid">
          {results.map((item) => (
            <div
              key={item.key}
              className="grid-card"
              onClick={() => handleSelect(item)}
            >
              <div className="grid-poster-wrap">
                {item.image ? (
                  <img src={item.image} alt={item.title} className="grid-poster" />
                ) : (
                  <div className="grid-poster-fallback">No Image</div>
                )}
                <div className="source-badge">{item.sourceLabel}</div>
              </div>
              <div className="grid-title">{item.title}</div>
              {item.year && <div className="grid-year">{item.year}</div>}
            </div>
          ))}
        </div>
      )}
      {!loading && !hasSearched && !showHistory && (
        <div className="empty">
          <div className="empty-title">Search MovieBox</div>
          <div className="empty-text">
            Enter a title to browse movies and series across all providers.
          </div>
        </div>
      )}
    </div>
  );
}
function extractYear(text) {
  if (!text) return null;
  const m = String(text).match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}