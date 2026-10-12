import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { api, buildDownloadUrl } from "../api/client";
import { storage } from "../storage/library";
import "./Details.css";
export default function Details() {
  const { provider, id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const title = params.get("title") || "";
  const link = params.get("link") || "";
  const isVega = provider !== "moviebox";
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isFav, setIsFav] = useState(false);
  const [busy, setBusy] = useState(false);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const loadVegaDetails = useCallback(async () => {
    const data = await api.vegaDetails(provider, link);
    const info = (data && data.info) || {};
    const downloadOptions = Array.isArray(info.linkList)
      ? info.linkList
          .map((entry, idx) => {
            const first = (entry.directLinks || [])[0];
            const hasEpisodes = !!entry.episodesLink;
            const url = (first && first.link) || entry.episodesLink;
            if (!url) return null;
            return {
              key: "vega-" + idx,
              title: (entry.title || (first && first.title) || "Download").trim(),
              quality: entry.quality || null,
              url,
              isEpisodesLink: !first && hasEpisodes,
            };
          })
          .filter(Boolean)
      : [];
    return {
      id: "vega:" + provider + ":" + (link || ""),
      provider,
      title: info.title || title || "Untitled",
      year: extractYear(info.title || title),
      media_type:
        (info.type || "movie").toLowerCase() === "series" ? "series" : "movie",
      poster_url: info.image || null,
      backdrop_url: info.image || null,
      description: info.synopsis || null,
      imdb_rating: info.rating || null,
      genres: Array.isArray(info.tags) ? info.tags : [],
      cast: Array.isArray(info.cast) ? info.cast : [],
      audio_tracks: [],
      link_list: downloadOptions,
      web_url: info.webUrl || null,
      vega_link: link,
      is_vega: true,
    };
  }, [provider, link, title]);
  const loadMovieboxDetails = useCallback(async () => {
    const data = await api.details(id);
    return { ...data, provider: "moviebox", is_vega: false, link_list: [] };
  }, [id]);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = isVega
        ? await loadVegaDetails()
        : await loadMovieboxDetails();
      if (!isMountedRef.current) return;
      setDetails(data);
      const fav = storage.isFavorite({
        id: data.id,
        provider: data.provider,
      });
      setIsFav(fav);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err.message || "Failed to load details");
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [isVega, loadVegaDetails, loadMovieboxDetails]);
  useEffect(() => {
    load();
  }, [load]);
  const handleFavorite = () => {
    if (!details) return;
    const next = storage.toggleFavorite({
      id: details.id,
      provider: details.provider,
      title: details.title,
      poster: details.poster_url,
      year: details.year,
      media_type: details.media_type,
    });
    setIsFav(next);
  };
  const playMoviebox = () => {
    if (!details) return;
    const p = new URLSearchParams();
    p.set("title", details.title);
    p.set("poster", details.poster_url || "");
    p.set("audio", details.audio_tracks?.[0]?.subject_id || "");
    navigate(`/player/moviebox/${details.id}?${p}`);
  };
  const playVegaOption = async (opt) => {
    if (!details) return;
    setBusy(true);
    try {
      let streamLink = opt.url;
      if (opt.isEpisodesLink) {
        const eps = await api.vegaEpisodes(details.provider, opt.url);
        const list = (eps && eps.episodes) || [];
        if (list.length > 0 && list[0].link) streamLink = list[0].link;
      }
      const data = await api.vegaStream(
        details.provider,
        streamLink,
        details.media_type
      );
      const streams = (data && data.streams) || [];
      const first = streams.find(
        (s) =>
          s &&
          s.link &&
          (s.link.includes(".m3u8") ||
            s.link.includes(".mp4") ||
            s.link.includes(".mpd"))
      );
      if (first) {
        const p = new URLSearchParams();
        p.set("title", details.title);
        p.set("poster", details.poster_url || "");
        p.set("streamUrl", first.link);
        navigate(`/player/vega/external?${p}`);
        return;
      }
    } catch (_) {
    } finally {
      if (isMountedRef.current) setBusy(false);
    }
    if (window.confirm("This stream cannot be played in-app. Open in browser?")) {
      window.open(opt.url, "_blank");
    }
  };
  if (loading) return <div className="loading">Loading details</div>;
  if (error)
    return (
      <div className="error">
        <div className="error-title">Error</div>
        <div className="error-text">{error}</div>
        <button className="retry-btn" onClick={load}>
          Retry
        </button>
      </div>
    );
  if (!details) return null;
  return (
    <div className="details">
      <header className="details-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div className="header-title">{details.title}</div>
      </header>
      <div className="details-hero">
        {details.backdrop_url && (
          <img
            src={details.backdrop_url}
            alt=""
            className="details-backdrop"
          />
        )}
        <div className="details-hero-inner">
          {details.poster_url && (
            <img
              src={details.poster_url}
              alt={details.title}
              className="details-poster"
            />
          )}
          <div className="details-hero-body">
            <h1 className="details-title">{details.title}</h1>
            <div className="details-meta">
              {details.year && <span>{details.year}</span>}
              {details.imdb_rating && (
                <span className="rating">IMDb {details.imdb_rating}</span>
              )}
              {isVega && (
                <span className="source-chip">
                  {String(details.provider).toUpperCase()}
                </span>
              )}
            </div>
            {details.genres && details.genres.length > 0 && (
              <div className="genre-row">
                {details.genres.slice(0, 5).map((g, i) => (
                  <span key={g + i} className="genre-chip">
                    {g}
                  </span>
                ))}
              </div>
            )}
            <div className="action-row">
              {!isVega && (
                <button
                  className="primary-btn"
                  onClick={playMoviebox}
                  disabled={busy}
                >
                  Play
                </button>
              )}
              {isVega && details.web_url && (
                <button
                  className="primary-btn"
                  onClick={() => window.open(details.web_url, "_blank")}
                >
                  Open Source
                </button>
              )}
              <button
                className={"icon-btn" + (isFav ? " active" : "")}
                onClick={handleFavorite}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill={isFav ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="details-body">
        {details.description && (
          <section className="section">
            <h2 className="section-title">Overview</h2>
            <p className="description">{details.description}</p>
          </section>
        )}
        {isVega && details.cast && details.cast.length > 0 && (
          <section className="section">
            <h2 className="section-title">Cast</h2>
            <div className="cast-row">
              {details.cast.slice(0, 12).map((name, i) => (
                <span key={name + i} className="cast-chip">
                  {name}
                </span>
              ))}
            </div>
          </section>
        )}
        {isVega && details.link_list && details.link_list.length > 0 && (
          <section className="section">
            <h2 className="section-title">Download Options</h2>
            <div className="download-list">
              {details.link_list.map((opt) => (
                <button
                  key={opt.key}
                  className="download-row"
                  onClick={() => playVegaOption(opt)}
                  disabled={busy}
                >
                  <div className="download-icon">
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="m10 8 6 4-6 4V8z" fill="currentColor" />
                    </svg>
                  </div>
                  <div className="download-body">
                    <div className="download-title">{opt.title}</div>
                    {opt.quality && (
                      <div className="download-quality">{opt.quality}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
function extractYear(text) {
  if (!text) return null;
  const m = String(text).match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}