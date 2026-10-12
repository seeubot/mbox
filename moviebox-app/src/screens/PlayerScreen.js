import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  ActivityIndicator,
  Modal,
  PanResponder,
  Dimensions,
  Animated,
  Easing,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useVideoPlayer, VideoView } from "expo-video";
import * as ScreenOrientation from "expo-screen-orientation";
import * as Brightness from "expo-brightness";
import { MaterialIcons, Ionicons } from "@expo/vector-icons";
import { useStream } from "../player/useStream";
import { saveProgress } from "../storage/library";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
const SAVE_INTERVAL_SEC = 5;
const OVERLAY_HIDE_MS = 3500;
const SKIP_STEP = 10;
const DOUBLE_TAP_WINDOW = 260;
const PRIME_BLUE = "#00A8E1";
const QUALITY_KEY = "maya.qualityPreference";
const QUALITY_OPTIONS = ["auto", "1080", "720", "480", "360"];
const FIT_MODES = ["contain", "cover", "fill"];
const SEEK_SENSITIVITY = 0.35;
const TIME_POLL_MS = 250;
export default function PlayerScreen({ route, navigation }) {
  const {
    id,
    title,
    audioTrack: initialAudio,
    audioTracks = [],
    season = 0,
    episode = 0,
    resume = 0,
    localUri = null,
    poster: routePoster = null,
    streamUrl = null,
    streamHeaders = null,
    externalStream = false,
  } = route.params || {};
  const isLocal = !!localUri;
  const isExternalStream = externalStream && !!streamUrl;
  const skipFetch = isLocal || isExternalStream;
  const [audio, setAudio] = useState(initialAudio || null);
  const [quality, setQuality] = useState("auto");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(QUALITY_KEY)
      .then((v) => {
        if (v && QUALITY_OPTIONS.includes(v)) setQuality(v);
      })
      .catch(() => {});
  }, []);
  const streamParams = skipFetch
    ? { id: null, audioTrack: null, season: 0, episode: 0, maxHeight: null }
    : {
        id,
        audioTrack: audio,
        season,
        episode,
        maxHeight: null,
      };
  const { loading, error, selected, reload } = useStream(streamParams);
  const source = useMemo(() => {
    if (isLocal) {
      return { uri: localUri, contentType: "auto" };
    }
    if (isExternalStream && streamUrl) {
      return {
        uri: streamUrl,
        headers: headersToObject(streamHeaders),
        contentType: "auto",
      };
    }
    if (!selected) return null;
    return {
      uri: selected.url,
      headers: headersToObject(selected.headers),
      contentType: "auto",
    };
  }, [isLocal, localUri, isExternalStream, streamUrl, streamHeaders, selected]);
  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
  });
  const [playing, setPlaying] = useState(true);
  const [buffering, setBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [fitMode, setFitMode] = useState("contain");
  const [seeking, setSeeking] = useState(false);
  const [seekPreview, setSeekPreview] = useState(0);
  const [seekBarWidth, setSeekBarWidth] = useState(0);
  const [hud, setHud] = useState(null);
  const [brightness, setBrightness] = useState(0.5);
  const [volume, setVolume] = useState(1.0);
  const [skipHint, setSkipHintTextState] = useState(null);
  const hideTimer = useRef(null);
  const hudTimer = useRef(null);
  const skipHintTimer = useRef(null);
  const progressRef = useRef({ last: 0, loaded: false });
  const seekWidthRef = useRef(0);
  const lastTapRef = useRef({ time: 0, side: null });
  const seekValueRef = useRef(0);
  const seekingRef = useRef(false);
  const resumeToRef = useRef(0);
  const startRef = useRef({
    x: 0,
    y: 0,
    time: 0,
    mode: "pending",
    startTime: 0,
    startBrightness: 0.5,
    startVolume: 1.0,
  });
  const screen = Dimensions.get("window");
  const overlayAnim = useRef(new Animated.Value(1)).current;
  const hudAnim = useRef(new Animated.Value(0)).current;
  const playBtnScale = useRef(new Animated.Value(1)).current;
  const hintAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Brightness.getBrightnessAsync()
      .then((b) => setBrightness(b))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!player || !source) return;
    let cancelled = false;
    (async () => {
      try {
        if (typeof player.replaceAsync === "function") {
          await player.replaceAsync(source);
        } else {
          player.replace(source);
        }
        if (cancelled) return;
        player.play();
        setPlaying(true);
      } catch (_) {}
    })();
    return () => {
      cancelled = true;
    };
  }, [player, source]);
  useEffect(() => {
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE
    ).catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP
      ).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!player) return;
    const subs = [];
    const add = (event, handler) => {
      try {
        const s = player.addListener(event, handler);
        subs.push(s);
      } catch (_) {}
    };
    add("playingChange", (e) => {
      if (e && typeof e.isPlaying === "boolean") {
        setPlaying(e.isPlaying);
        if (e.isPlaying) setBuffering(false);
      }
    });
    add("statusChange", (s) => {
      if (!s || !s.status) return;
      if (s.status === "loading") setBuffering(true);
      else if (s.status === "readyToPlay") setBuffering(false);
      else if (s.status === "error") setBuffering(false);
    });
    return () => {
      subs.forEach((s) => {
        try {
          s.remove();
        } catch (_) {}
      });
    };
  }, [player]);
  useEffect(() => {
    if (!player) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      try {
        const t = player.currentTime;
        const d = player.duration;
        if (typeof t === "number" && !seekingRef.current) {
          setCurrentTime(t);
          seekValueRef.current = t;
        }
        if (typeof d === "number" && d > 0) {
          setDuration((prev) => (Math.abs(prev - d) > 0.3 ? d : prev));
        }
      } catch (_) {}
    };
    const interval = setInterval(tick, TIME_POLL_MS);
    tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [player]);
  useEffect(() => {
    if (!player || !source || progressRef.current.loaded) return;
    const initial = resume > 0 ? resume : null;
    if (!initial) {
      progressRef.current.loaded = true;
      return;
    }
    let applied = false;
    const applySeek = () => {
      if (applied) return;
      applied = true;
      try {
        player.currentTime = initial;
        setCurrentTime(initial);
      } catch (_) {}
      progressRef.current.loaded = true;
    };
    let sub = null;
    try {
      sub = player.addListener("statusChange", (s) => {
        if (s && (s.status === "readyToPlay" || s.status === "idle"))
          applySeek();
      });
    } catch (_) {}
    const t = setTimeout(applySeek, 2500);
    return () => {
      clearTimeout(t);
      try {
        if (sub) sub.remove();
      } catch (_) {}
    };
  }, [player, source, resume]);
  useEffect(() => {
    if (!player || !selected) return;
    const target = resumeToRef.current;
    if (!target || target < 1) return;
    resumeToRef.current = 0;
    let applied = false;
    const applySeek = () => {
      if (applied) return;
      applied = true;
      try {
        player.currentTime = target;
      } catch (_) {}
    };
    let sub = null;
    try {
      sub = player.addListener("statusChange", (s) => {
        if (s && (s.status === "readyToPlay" || s.status === "idle"))
          applySeek();
      });
    } catch (_) {}
    const t = setTimeout(applySeek, 2500);
    return () => {
      clearTimeout(t);
      try {
        if (sub) sub.remove();
      } catch (_) {}
    };
  }, [player, selected]);
  useEffect(() => {
    if (!player || isLocal) return;
    if (!selected) return;
    const itemMeta = {
      id: id || "external",
      provider: isExternalStream ? "vega" : "moviebox",
      title,
      poster: routePoster || selected.poster_url || null,
      year: selected.year || null,
      media_type: season > 0 && episode > 0 ? "series" : "movie",
      season,
      episode,
    };
    let sub = null;
    try {
      sub = player.addListener("timeUpdate", (data) => {
        const t =
          data && typeof data.currentTime === "number" ? data.currentTime : 0;
        const d = player.duration || 0;
        if (!d || d <= 0 || t < 5) return;
        if (t - progressRef.current.last < SAVE_INTERVAL_SEC) return;
        progressRef.current.last = t;
        saveProgress(itemMeta, t, d);
      });
    } catch (_) {}
    return () => {
      try {
        if (sub) sub.remove();
      } catch (_) {}
      try {
        const t = player.currentTime || 0;
        const d = player.duration || 0;
        if (d && d > 0 && t > 5) saveProgress(itemMeta, t, d);
      } catch (_) {}
    };
  }, [player, selected, isLocal, isExternalStream, id, title, season, episode, routePoster]);
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      Animated.timing(overlayAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setOverlayVisible(false);
      });
    }, OVERLAY_HIDE_MS);
  }, [overlayAnim]);
  useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [scheduleHide]);
  const revealOverlay = useCallback(() => {
    setOverlayVisible(true);
    Animated.timing(overlayAnim, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
    scheduleHide();
  }, [overlayAnim, scheduleHide]);
  const showHud = useCallback(
    (type, value) => {
      setHud({ type, value });
      hudAnim.setValue(0);
      Animated.timing(hudAnim, {
        toValue: 1,
        duration: 150,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      if (hudTimer.current) clearTimeout(hudTimer.current);
      hudTimer.current = setTimeout(() => {
        Animated.timing(hudAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) setHud(null);
        });
      }, 700);
    },
    [hudAnim]
  );
  const showSkipHint = useCallback(
    (text) => {
      setSkipHintTextState(text);
      hintAnim.setValue(0);
      Animated.timing(hintAnim, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
      if (skipHintTimer.current) clearTimeout(skipHintTimer.current);
      skipHintTimer.current = setTimeout(() => {
        Animated.timing(hintAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) setSkipHintTextState(null);
        });
      }, 500);
    },
    [hintAnim]
  );
  const seekBy = useCallback(
    (delta) => {
      try {
        const t = player.currentTime || 0;
        const d = player.duration || 0;
        const next = Math.max(0, Math.min(t + delta, d || t + delta));
        player.currentTime = next;
        setCurrentTime(next);
        seekValueRef.current = next;
      } catch (_) {}
    },
    [player]
  );
  const bouncePlay = useCallback(() => {
    playBtnScale.setValue(0.88);
    Animated.spring(playBtnScale, {
      toValue: 1,
      friction: 4,
      tension: 100,
      useNativeDriver: true,
    }).start();
  }, [playBtnScale]);
  const togglePlay = useCallback(() => {
    revealOverlay();
    bouncePlay();
    try {
      if (player.playing) player.pause();
      else player.play();
    } catch (_) {}
  }, [player, revealOverlay, bouncePlay]);
  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);
  const pickAudio = useCallback(
    (subjectId) => {
      setSettingsOpen(false);
      if (subjectId === audio) return;
      const t = player.currentTime || 0;
      progressRef.current.loaded = true;
      resumeToRef.current = t;
      setAudio(subjectId);
    },
    [audio, player]
  );
  const pickQuality = useCallback((q) => {
    setSettingsOpen(false);
    setQuality(q);
    AsyncStorage.setItem(QUALITY_KEY, q).catch(() => {});
  }, []);
  const cycleFit = useCallback(() => {
    setFitMode((m) => {
      const idx = FIT_MODES.indexOf(m);
      return FIT_MODES[(idx + 1) % FIT_MODES.length];
    });
    revealOverlay();
  }, [revealOverlay]);
  const handleTap = useCallback(
    (side) => {
      const now = Date.now();
      const last = lastTapRef.current;
      if (now - last.time < DOUBLE_TAP_WINDOW && last.side === side) {
        lastTapRef.current = { time: 0, side: null };
        if (side === "left") {
          seekBy(-SKIP_STEP);
          showSkipHint("-10s");
        } else {
          seekBy(SKIP_STEP);
          showSkipHint("+10s");
        }
        return;
      }
      lastTapRef.current = { time: now, side };
      setTimeout(() => {
        if (lastTapRef.current.time === now) {
          if (!overlayVisible) {
            revealOverlay();
          } else {
            Animated.timing(overlayAnim, {
              toValue: 0,
              duration: 200,
              useNativeDriver: true,
            }).start(({ finished }) => {
              if (finished) setOverlayVisible(false);
            });
          }
        }
      }, DOUBLE_TAP_WINDOW);
    },
    [seekBy, overlayVisible, revealOverlay, showSkipHint, overlayAnim]
  );
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !locked,
        onMoveShouldSetPanResponder: (_, g) => {
          if (locked) return false;
          return Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4;
        },
        onPanResponderGrant: (e, g) => {
          startRef.current = {
            x: g.x0,
            y: g.y0,
            time: Date.now(),
            mode: "pending",
            startTime: player.currentTime || 0,
            startBrightness: brightness,
            startVolume: volume,
          };
        },
        onPanResponderMove: (e, g) => {
          const start = startRef.current;
          const dx = g.dx;
          const dy = g.dy;
          if (start.mode === "pending") {
            if (Math.abs(dx) > Math.abs(dy) + 4) {
              start.mode = "seek";
            } else if (Math.abs(dy) > Math.abs(dx) + 4) {
              start.mode =
                start.x < screen.width / 2 ? "volume" : "brightness";
            } else {
              return;
            }
          }
          if (start.mode === "seek") {
            const d = player.duration || 0;
            if (!d) return;
            const deltaSec = dx * SEEK_SENSITIVITY;
            const target = Math.max(0, Math.min(d, start.startTime + deltaSec));
            seekValueRef.current = target;
            setSeekPreview(target);
            setSeeking(true);
            seekingRef.current = true;
          } else if (start.mode === "brightness") {
            const delta = -dy / (screen.height * 0.6);
            const next = Math.max(
              0,
              Math.min(1, start.startBrightness + delta)
            );
            setBrightness(next);
            Brightness.setBrightnessAsync(next).catch(() => {});
            showHud("brightness", next);
          } else if (start.mode === "volume") {
            const delta = -dy / (screen.height * 0.6);
            const next = Math.max(0, Math.min(1, start.startVolume + delta));
            setVolume(next);
            try {
              player.volume = next;
            } catch (_) {}
            showHud("volume", next);
          }
        },
        onPanResponderRelease: () => {
          const start = startRef.current;
          const elapsed = Date.now() - start.time;
          if (start.mode === "seek") {
            const target = seekValueRef.current;
            try {
              player.currentTime = target;
            } catch (_) {}
            setCurrentTime(target);
            setSeeking(false);
            seekingRef.current = false;
            revealOverlay();
          } else if (start.mode === "pending" && elapsed < 260) {
            const side = start.x < screen.width / 2 ? "left" : "right";
            handleTap(side);
          }
          start.mode = "pending";
        },
        onPanResponderTerminate: () => {
          if (seekingRef.current) {
            seekingRef.current = false;
            setSeeking(false);
          }
        },
      }),
    [
      locked,
      player,
      brightness,
      volume,
      screen.width,
      screen.height,
      revealOverlay,
      showHud,
      handleTap,
    ]
  );
  const onSeekLayout = useCallback((e) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) {
      seekWidthRef.current = w;
      setSeekBarWidth(w);
    }
  }, []);
  const computeRatio = useCallback((x) => {
    const w = seekWidthRef.current || 1;
    return Math.max(0, Math.min(1, x / w));
  }, []);
  const seekPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          seekingRef.current = true;
          setSeeking(true);
          revealOverlay();
          const ratio = computeRatio(evt.nativeEvent.locationX);
          const t = ratio * (player.duration || duration);
          setSeekPreview(t);
          seekValueRef.current = t;
        },
        onPanResponderMove: (evt) => {
          if (!seekingRef.current) return;
          const ratio = computeRatio(evt.nativeEvent.locationX);
          const t = ratio * (player.duration || duration);
          setSeekPreview(t);
          seekValueRef.current = t;
        },
        onPanResponderRelease: () => {
          if (!seekingRef.current) return;
          const target = seekValueRef.current;
          try {
            player.currentTime = target;
          } catch (_) {}
          setCurrentTime(target);
          setSeeking(false);
          seekingRef.current = false;
          revealOverlay();
        },
        onPanResponderTerminate: () => {
          if (seekingRef.current) {
            setSeeking(false);
            seekingRef.current = false;
          }
        },
      }),
    [computeRatio, duration, player, revealOverlay]
  );
  if (!skipFetch && loading) return <LoadingState message="Loading stream..." />;
  if (!skipFetch && error) return <ErrorState message={error} onRetry={reload} />;
  if (!skipFetch && !selected)
    return <ErrorState message="No stream available" onRetry={reload} />;
  const displayTime = seeking ? seekPreview : currentTime;
  const totalDuration = duration > 0 ? duration : 0;
  const progressRatio =
    totalDuration > 0
      ? Math.min(1, Math.max(0, displayTime / totalDuration))
      : 0;
  const fillWidth = seekBarWidth * progressRatio;
  const currentAudioLabel =
    (audioTracks.find((t) => t.subject_id === audio) || {}).language ||
    "Default";
  const seekDelta = displayTime - currentTime;
  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <VideoView
        style={styles.video}
        player={player}
        nativeControls={false}
        requiresLinearPlayback={false}
        contentFit={fitMode}
        allowsFullscreen={false}
        allowsPictureInPicture
      />
      <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers} />
      {skipHint && (
        <Animated.View
          style={[
            styles.skipHintCard,
            {
              opacity: hintAnim,
              transform: [
                {
                  scale: hintAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.85, 1],
                  }),
                },
              ],
            },
          ]}
          pointerEvents="none"
        >
          <MaterialIcons
            name={skipHint.startsWith("+") ? "forward-10" : "replay-10"}
            size={18}
            color={PRIME_BLUE}
          />
          <Text style={styles.skipHintText}>{skipHint}</Text>
        </Animated.View>
      )}
      {hud && !seeking && (
        <Animated.View
          style={[
            styles.hudCard,
            {
              opacity: hudAnim,
              transform: [
                {
                  scale: hudAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.92, 1],
                  }),
                },
              ],
            },
          ]}
          pointerEvents="none"
        >
          <MaterialIcons
            name={
              hud.type === "brightness"
                ? "brightness-medium"
                : hud.value === 0
                ? "volume-off"
                : hud.value < 0.5
                ? "volume-down"
                : "volume-up"
            }
            size={22}
            color={PRIME_BLUE}
          />
          <View style={styles.hudBarTrack}>
            <View
              style={[
                styles.hudBarFill,
                { width: `${Math.round(hud.value * 100)}%` },
              ]}
            />
          </View>
          <Text style={styles.hudValueText}>
            {Math.round(hud.value * 100)}%
          </Text>
        </Animated.View>
      )}
      {buffering && !seeking && (
        <View style={styles.bufferingContainer} pointerEvents="none">
          <View style={styles.bufferingBubble}>
            <ActivityIndicator size="small" color={PRIME_BLUE} />
          </View>
        </View>
      )}
      {locked && (
        <Pressable
          onPress={() => setLocked(false)}
          style={({ pressed }) => [
            styles.unlockButton,
            pressed && { opacity: 0.6 },
          ]}
        >
          <MaterialIcons name="lock" size={18} color="#fff" />
        </Pressable>
      )}
      {overlayVisible && !locked && (
        <Animated.View
          style={[styles.overlayContainer, { opacity: overlayAnim }]}
          pointerEvents="box-none"
        >
          <LinearGradient
            colors={["rgba(0,0,0,0.75)", "transparent"]}
            style={styles.topGradient}
            pointerEvents="none"
          />
          <View style={styles.topNavbar} pointerEvents="box-none">
            <Pressable
              onPress={handleBack}
              style={({ pressed }) => [
                styles.topIconButton,
                pressed && styles.iconButtonPressed,
              ]}
              hitSlop={12}
            >
              <Ionicons name="chevron-back" size={26} color="#fff" />
            </Pressable>
            <View style={styles.headerInfoBlock} pointerEvents="none">
              <Text style={styles.headerTitleText} numberOfLines={1}>
                {title || "Now Playing"}
              </Text>
              <Text style={styles.headerSubtitleText} numberOfLines={1}>
                {isLocal ? "Offline" : isExternalStream ? "External" : "Stream"}
                {season > 0 && episode > 0 ? ` · S${season} E${episode}` : ""}
                {!isLocal && !isExternalStream && selected?.quality
                  ? ` · ${selected.quality}`
                  : ""}
                {!isLocal && !isExternalStream && currentAudioLabel
                  ? ` · ${currentAudioLabel}`
                  : ""}
              </Text>
            </View>
            <Pressable
              onPress={() => setLocked(true)}
              style={({ pressed }) => [
                styles.topIconButton,
                pressed && styles.iconButtonPressed,
              ]}
              hitSlop={12}
            >
              <Ionicons name="lock-open-outline" size={22} color="#fff" />
            </Pressable>
          </View>
          <View style={styles.centerActionsGrid} pointerEvents="box-none">
            <Pressable
              onPress={() => {
                seekBy(-SKIP_STEP);
                showSkipHint("-10s");
              }}
              style={({ pressed }) => [
                styles.sideButton,
                pressed && styles.iconButtonPressed,
              ]}
              hitSlop={12}
            >
              <Ionicons name="play-back-outline" size={32} color="#fff" />
              <Text style={styles.sideButtonLabel}>10</Text>
            </Pressable>
            <Pressable onPress={togglePlay}>
              <Animated.View
                style={[
                  styles.mainPlayCircle,
                  { transform: [{ scale: playBtnScale }] },
                ]}
              >
                <Ionicons
                  name={playing ? "pause-outline" : "play-outline"}
                  size={44}
                  color="#fff"
                  style={{ marginLeft: playing ? 0 : 3 }}
                />
              </Animated.View>
            </Pressable>
            <Pressable
              onPress={() => {
                seekBy(SKIP_STEP);
                showSkipHint("+10s");
              }}
              style={({ pressed }) => [
                styles.sideButton,
                pressed && styles.iconButtonPressed,
              ]}
              hitSlop={12}
            >
              <Ionicons name="play-forward-outline" size={32} color="#fff" />
              <Text style={styles.sideButtonLabel}>10</Text>
            </Pressable>
          </View>
          <View style={styles.bottomControlBar} pointerEvents="box-none">
            {!isLocal && !isExternalStream && (
              <Pressable
                onPress={() => {
                  revealOverlay();
                  setSettingsOpen(true);
                }}
                style={({ pressed }) => [
                  styles.bottomIconButton,
                  pressed && styles.iconButtonPressed,
                ]}
                hitSlop={10}
              >
                <Ionicons name="settings-outline" size={22} color="#fff" />
              </Pressable>
            )}
            <View
              style={styles.seekContainer}
              onLayout={onSeekLayout}
              {...seekPanResponder.panHandlers}
            >
              {seeking && (
                <View
                  style={[
                    styles.seekTooltip,
                    {
                      left: Math.max(
                        0,
                        Math.min(fillWidth - 30, (seekBarWidth || 1) - 60)
                      ),
                    },
                  ]}
                  pointerEvents="none"
                >
                  <Text style={styles.seekTooltipText}>
                    {formatTime(displayTime)}
                  </Text>
                </View>
              )}
              <View style={styles.seekTrack}>
                <View style={styles.seekBg} />
                {seekBarWidth > 0 && (
                  <View style={[styles.seekFill, { width: fillWidth }]} />
                )}
                {seekBarWidth > 0 && (
                  <View
                    style={[
                      styles.seekThumb,
                      {
                        left: fillWidth,
                        transform: [{ scale: seeking ? 1.5 : 1 }],
                      },
                    ]}
                  />
                )}
              </View>
            </View>
            <Pressable
              onPress={cycleFit}
              style={({ pressed }) => [
                styles.bottomIconButton,
                pressed && styles.iconButtonPressed,
              ]}
              hitSlop={10}
            >
              <Ionicons name="scan-outline" size={22} color="#fff" />
            </Pressable>
          </View>
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.75)"]}
            style={styles.bottomGradient}
            pointerEvents="none"
          />
        </Animated.View>
      )}
      {!isLocal && !isExternalStream && (
        <SettingsModal
          visible={settingsOpen}
          onClose={() => {
            setSettingsOpen(false);
            revealOverlay();
          }}
          audioTracks={audioTracks}
          currentAudio={audio}
          onPickAudio={pickAudio}
          currentQuality={quality}
          onPickQuality={pickQuality}
          fitMode={fitMode}
          onPickFit={(m) => setFitMode(m)}
        />
      )}
    </View>
  );
}
function SettingsModal({
  visible,
  onClose,
  audioTracks,
  currentAudio,
  onPickAudio,
  currentQuality,
  onPickQuality,
  fitMode,
  onPickFit,
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdropOverlay} onPress={onClose}>
        <Pressable style={styles.settingsModalCard} onPress={() => {}}>
          <View style={styles.modalHeadingRow}>
            <Text style={styles.modalMainTitle}>Playback Options</Text>
            <Pressable onPress={onClose} style={styles.modalCloseButton}>
              <Ionicons name="close" size={20} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>
          <Text style={styles.modalSectionCategory}>Stream Resolution</Text>
          <View style={styles.pillSelectionGrid}>
            {QUALITY_OPTIONS.map((q) => {
              const active = currentQuality === q;
              return (
                <Pressable
                  key={q}
                  onPress={() => onPickQuality(q)}
                  style={[
                    styles.selectionPillCard,
                    active && styles.selectionPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.selectionPillText,
                      active && styles.selectionPillTextActive,
                    ]}
                  >
                    {q === "auto" ? "Auto" : q + "p"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.modalSectionCategory}>Audio Language</Text>
          {audioTracks.length === 0 ? (
            <Text style={styles.modalNoteText}>No additional audio tracks</Text>
          ) : (
            <View style={styles.pillSelectionGrid}>
              {audioTracks.map((t, i) => {
                const active = currentAudio === t.subject_id;
                return (
                  <Pressable
                    key={(t.subject_id || "a") + "-" + i}
                    onPress={() => onPickAudio(t.subject_id)}
                    style={[
                      styles.selectionPillCard,
                      active && styles.selectionPillActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.selectionPillText,
                        active && styles.selectionPillTextActive,
                      ]}
                    >
                      {t.language || "Default"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          <Text style={styles.modalSectionCategory}>Display Scaling</Text>
          <View style={styles.pillSelectionGrid}>
            {FIT_MODES.map((m) => {
              const active = fitMode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => onPickFit(m)}
                  style={[
                    styles.selectionPillCard,
                    active && styles.selectionPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.selectionPillText,
                      active && styles.selectionPillTextActive,
                    ]}
                  >
                    {m.toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
function headersToObject(list) {
  if (!list) return undefined;
  if (Array.isArray(list)) {
    const out = {};
    for (const pair of list) {
      if (Array.isArray(pair) && pair.length === 2) out[pair[0]] = pair[1];
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (typeof list === "object") {
    const out = {};
    for (const k of Object.keys(list)) out[k] = String(list[k]);
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
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
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  video: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  skipHintCard: {
    position: "absolute",
    alignSelf: "center",
    top: "34%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(20, 20, 20, 0.85)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  skipHintText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  hudCard: {
    position: "absolute",
    alignSelf: "center",
    top: "34%",
    backgroundColor: "rgba(20, 20, 20, 0.9)",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    minWidth: 150,
    gap: 6,
  },
  hudBarTrack: {
    width: 110,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    overflow: "hidden",
  },
  hudBarFill: { height: "100%", backgroundColor: "#fff" },
  hudValueText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  bufferingContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  bufferingBubble: {
    backgroundColor: "rgba(20, 20, 20, 0.7)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 24,
  },
  unlockButton: {
    position: "absolute",
    bottom: 24,
    left: 24,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(20, 20, 20, 0.8)",
    alignItems: "center",
    justifyContent: "center",
  },
  overlayContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "space-between",
  },
  topGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 140,
  },
  bottomGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 140,
  },
  topNavbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 12,
  },
  topIconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonPressed: { opacity: 0.55 },
  headerInfoBlock: { flex: 1, marginHorizontal: 4 },
  headerTitleText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  headerSubtitleText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    marginTop: 2,
  },
  centerActionsGrid: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 64,
  },
  sideButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  sideButtonLabel: {
    position: "absolute",
    color: "#fff",
    fontSize: 9,
    fontWeight: "700",
    marginTop: 1,
  },
  mainPlayCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.4)",
  },
  bottomControlBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 8,
    gap: 12,
  },
  bottomIconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  seekContainer: {
    flex: 1,
    height: 44,
    justifyContent: "center",
    position: "relative",
  },
  seekTrack: {
    height: 44,
    justifyContent: "center",
    position: "relative",
  },
  seekBg: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  seekFill: {
    position: "absolute",
    left: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: PRIME_BLUE,
  },
  seekThumb: {
    position: "absolute",
    top: 16,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: PRIME_BLUE,
    marginLeft: -6,
  },
  seekTooltip: {
    position: "absolute",
    top: -22,
    backgroundColor: "rgba(20, 20, 20, 0.95)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 60,
    alignItems: "center",
  },
  seekTooltipText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  modalBackdropOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
  },
  settingsModalCard: {
    width: "72%",
    maxWidth: 440,
    backgroundColor: "#141414",
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  modalHeadingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  modalMainTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  modalCloseButton: { padding: 4 },
  modalSectionCategory: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 14,
    marginBottom: 8,
  },
  modalNoteText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    fontStyle: "italic",
  },
  pillSelectionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  selectionPillCard: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  selectionPillActive: {
    backgroundColor: "rgba(0,168,225,0.18)",
    borderColor: PRIME_BLUE,
  },
  selectionPillText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    fontWeight: "500",
  },
  selectionPillTextActive: { color: "#fff", fontWeight: "700" },
});