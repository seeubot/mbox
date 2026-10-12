import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { api, proxyUrl } from "../api/client";
import { storage } from "../storage/library";
import "./Player.css";
export default function Player() {
  const { provider, id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const title = params.get("title") || "";
  const poster = params.get("poster") || "";
  const streamUrlParam = params.get("streamUrl") || "";
  const audioTrack = params.get("audio") || null;
  const externalStream = !!streamUrlParam;
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const shakaRef = useRef(null);
  const containerRef = useRef(null);
  const [streamData, setStreamData] = useState(null);
  const [loading, setLoading] = useState(!externalStream);
  const [error, setError] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [quality] = useState(storage.getQuality() || "auto");
  const hideTimer = useRef(null);
  const progressRef = useRef({ last: 0 });
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOverlayVisible(false), 3500);
  }, []);
  const revealOverlay = useCallback(() => {
    setOverlayVisible(true);
    scheduleHide();
  }, [scheduleHide]);
  useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [scheduleHide]);
  const headerValue = useCallback(
    (name) => {
      if (!streamData || !streamData.headers) return null;
      const list = Array.isArray(streamData.headers)
        ? streamData.headers
        : Object.entries(streamData.headers);
      const found = list.find(
        ([k]) => String(k).toLowerCase() === String(name).toLowerCase()
      );
      return found ? found[1] : null;
    },
    [streamData]
  );
  // ---- Load stream source ----
  useEffect(() => {
    if (externalStream) {
      setStreamData({
        url: streamUrlParam,
        headers: null,
        quality,
      });
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await api.streams(
          id,
          0,
          0,
          audioTrack,
          quality === "auto" ? null : quality
        );
        const streams = (data.streams || []).filter((s) => s.url);
        if (streams.length === 0) throw new Error("No streams available");
        const sorted = [...streams].sort(
          (a, b) => (b.size_bytes || 0) - (a.size_bytes || 0)
        );
        if (cancelled) return;
        setStreamData(sorted[0]);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Failed to load stream");
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id, audioTrack, quality, externalStream, streamUrlParam]);
  // ---- Attach stream to video ----
  useEffect(() => {
    if (!streamData || !streamData.url || !videoRef.current) return;
    const video = videoRef.current;
    const url = streamData.url;
    const referer = headerValue("Referer") || "https://sportslive.wine";
    const ua =
      headerValue("User-Agent") ||
      "com.community.oneroom/50020121 (Linux; U; Android 13; en_US)";
    const cookie = headerValue("Cookie") || null;
    const proxied = (u) => proxyUrl(u, { referer, ua, cookie });
    const cleanup = () => {
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {}
        hlsRef.current = null;
      }
      if (shakaRef.current) {
        try {
          shakaRef.current.destroy();
        } catch {}
        shakaRef.current = null;
      }
    };
    cleanup();
    async function setup() {
      const isMpd = url.includes(".mpd");
      const isM3u8 = url.includes(".m3u8");
      const isMp4 = url.includes(".mp4");
      try {
        if (isMpd) {
          const shakaModule = await import("shaka-player");
          const shaka = shakaModule.default || shakaModule;
          if (shaka.polyfill) shaka.polyfill.installAll();
          const player = new shaka.Player();
          shakaRef.current = player;
          await player.attach(video);
          player.getNetworkingEngine().registerRequestFilter((type, request) => {
            for (let i = 0; i < request.uris.length; i++) {
              request.uris[i] = proxied(request.uris[i]);
            }
          });
          await player.load(proxied(url));
          video.play().catch(() => {});
          return;
        }
        if (isM3u8) {
          const HlsModule = await import("hls.js");
          const Hls = HlsModule.default || HlsModule;
          if (Hls && Hls.isSupported && Hls.isSupported()) {
            const hls = new Hls();
            hlsRef.current = hls;
            hls.loadSource(proxied(url));
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              video.play().catch(() => {});
            });
            return;
          }
          if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = proxied(url);
            video.play().catch(() => {});
            return;
          }
        }
        // Direct MP4 or fallback
        if (isMp4) {
          video.src = url;
          video.play().catch(() => {});
        } else {
          video.src = proxied(url);
          video.play().catch(() => {});
        }
      } catch (err) {
        console.error("[player] setup error:", err);
        setError(err.message || "Failed to play stream");
      }
    }
    setup();
    return cleanup;
  }, [streamData, headerValue]);
  // ---- Video events ----
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      if (video.duration && isFinite(video.duration))
        setDuration(video.duration);
      const now = Date.now();
      if (now - progressRef.current.last > 5000 && video.currentTime > 5) {
        progressRef.current.last = now;
        storage.saveProgress(
          {
            id: id || "external",
            provider: provider || "moviebox",
            title,
            poster,
            media_type: "movie",
            season: 0,
            episode: 0,
          },
          video.currentTime,
          video.duration
        );
      }
    };
    const onLoadedMetadata = () => {
      if (video.duration && isFinite(video.duration))
        setDuration(video.duration);
    };
    const onError = () => setError("Playback error");
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("error", onError);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("error", onError);
    };
  }, [id, provider, title, poster]);
  const togglePlay = useCallback(() => {
    revealOverlay();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, [revealOverlay]);
  const seekBy = useCallback(
    (delta) => {
      revealOverlay();
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = Math.max(
        0,
        Math.min((video.currentTime || 0) + delta, video.duration || 0)
      );
    },
    [revealOverlay]
  );
  const onSeek = useCallback((e) => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = ratio * video.duration;
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      const video = videoRef.current;
      if (!video) return;
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") {
        seekBy(-10);
      } else if (e.key === "ArrowRight") {
        seekBy(10);
      } else if (e.key === "f") {
        toggleFullscreen();
      } else if (e.key === "Escape") {
        navigate(-1);
      } else if (e.key === "ArrowUp") {
        video.volume = Math.min(1, video.volume + 0.1);
      } else if (e.key === "ArrowDown") {
        video.volume = Math.max(0, video.volume - 0.1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seekBy, toggleFullscreen, navigate]);
  if (loading) return <div className="loading">Loading stream...</div>;
  if (error)
    return (
      <div className="error">
        <div className="error-title">Error</div>
        <div className="error-text">{error}</div>
        <button className="retry-btn" onClick={() => navigate(-1)}>
          Back
        </button>
      </div>
    );
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  return (
    <div
      className="player"
      ref={containerRef}
      onMouseMove={revealOverlay}
      onClick={(e) => {
        if (e.target === videoRef.current) {
          if (overlayVisible) setOverlayVisible(false);
          else revealOverlay();
        }
      }}
    >
      <video
        ref={videoRef}
        className="player-video"
        controls={false}
        autoPlay
        playsInline
      />
      {overlayVisible && (
        <div className="player-overlay">
          <div className="player-top">
            <button className="player-icon-btn" onClick={() => navigate(-1)}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <div className="player-title-wrap">
              <div className="player-title">{title || "Now Playing"}</div>
              <div className="player-subtitle">
                {externalStream ? "External" : "Stream"}
                {streamData && streamData.quality
                  ? " · " + streamData.quality
                  : ""}
              </div>
            </div>
            <button className="player-icon-btn" onClick={toggleFullscreen}>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            </button>
          </div>
          <div className="player-center">
            <button className="player-skip-btn" onClick={() => seekBy(-10)}>
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              <div className="skip-label">10</div>
            </button>
            <button className="player-play-btn" onClick={togglePlay}>
              {playing ? (
                <svg
                  width="44"
                  height="44"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg
                  width="44"
                  height="44"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <button className="player-skip-btn" onClick={() => seekBy(10)}>
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
              <div className="skip-label">10</div>
            </button>
          </div>
          <div className="player-bottom">
            <div className="player-time">{formatTime(currentTime)}</div>
            <div className="player-seek" onClick={onSeek}>
              <div className="seek-bg" />
              <div className="seek-fill" style={{ width: progress + "%" }} />
              <div className="seek-thumb" style={{ left: progress + "%" }} />
            </div>
            <div className="player-time">{formatTime(duration)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (h > 0) return h + ":" + pad(m) + ":" + pad(s);
  return pad(m) + ":" + pad(s);
}