import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { storage } from "../storage/library";
import "./Home.css";
export default function Home() {
  const navigate = useNavigate();
  const [continueWatching, setContinueWatching] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setContinueWatching(storage.listContinueWatching(20));
    setFavorites(storage.loadFavorites());
    setLoading(false);
  }, []);
  const openItem = (item, resume) => {
    const params = new URLSearchParams();
    params.set("title", item.title);
    if (item.media_type === "series") {
      params.set("season", item.season || 1);
      params.set("episode", item.episode || 1);
    }
    if (resume && item.position) params.set("resume", item.position);
    navigate(`/details/${item.provider || "moviebox"}/${item.id}?${params}`);
  };
  if (loading) return <div className="loading">Loading</div>;
  const hasContent =
    continueWatching.length > 0 || favorites.length > 0;
  return (
    <div className="home">
      <header className="home-header">
        <div className="brand">
          MayaBox
          <span className="brand-dot" />
        </div>
        <div className="header-actions">
          <button className="icon-btn" onClick={() => navigate("/search")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </button>
        </div>
      </header>
      {continueWatching.length > 0 && (
        <section className="section">
          <h2 className="section-title">Continue Watching</h2>
          <div className="row">
            {continueWatching.map((item) => (
              <div
                key={item.provider + ":" + item.id + ":" + item.season + ":" + item.episode}
                className="card"
                onClick={() => openItem(item, true)}
              >
                <div className="poster-wrap">
                  {item.poster ? (
                    <img src={item.poster} alt={item.title} className="poster" />
                  ) : (
                    <div className="poster-fallback">No Image</div>
                  )}
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: (item.percent || 0) + "%" }} />
                  </div>
                </div>
                <div className="card-title">{item.title}</div>
              </div>
            ))}
          </div>
        </section>
      )}
      {favorites.length > 0 && (
        <section className="section">
          <h2 className="section-title">My List</h2>
          <div className="row">
            {favorites.map((item) => (
              <div
                key={item.provider + ":" + item.id}
                className="card"
                onClick={() => openItem(item, false)}
              >
                <div className="poster-wrap">
                  {item.poster ? (
                    <img src={item.poster} alt={item.title} className="poster" />
                  ) : (
                    <div className="poster-fallback">No Image</div>
                  )}
                </div>
                <div className="card-title">{item.title}</div>
              </div>
            ))}
          </div>
        </section>
      )}
      {!hasContent && (
        <div className="empty">
          <div className="empty-title">Welcome to MayaBox</div>
          <div className="empty-text">
            Search for movies and series to get started. Your history and
            favorites will appear here.
          </div>
          <button className="empty-btn" onClick={() => navigate("/search")}>
            Search Now
          </button>
        </div>
      )}
    </div>
  );
}