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
  ScrollView,
  StyleSheet,
  Pressable,
  Alert,
  Linking,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { api, buildDownloadUrl } from "../api/client";
import { colors, spacing, radius } from "../theme/colors";
import { useResponsive } from "../hooks/useResponsive";
import { toggleFavorite, isFavorite, getProgress } from "../storage/library";
import {
  getDownloadByContent,
  formatSize,
} from "../storage/downloads";
import {
  ensureStoragePermission,
  hasEnoughSpace,
  openAppSettings,
  formatBytes,
} from "../storage/permissions";
import { useDownloads } from "../hooks/useDownload";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
export default function DetailsScreen({ route, navigation }) {
  const {
    id,
    title,
    provider = "moviebox",
    link = null,
  } = route.params || {};
  const isVega = provider !== "moviebox";
  const { isTV } = useResponsive();
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [isFav, setIsFav] = useState(false);
  const [resumeInfo, setResumeInfo] = useState(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [existingDownload, setExistingDownload] = useState(null);
  const { downloads, start: startDownload, refresh: refreshDownloads } =
    useDownloads();
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
      duration: null,
      imdb_rating: info.rating || null,
      genres: Array.isArray(info.tags) ? info.tags : [],
      cast: Array.isArray(info.cast) ? info.cast : [],
      audio_tracks: [],
      seasons: [],
      link_list: downloadOptions,
      web_url: info.webUrl || null,
      vega_link: link,
      is_vega: true,
    };
  }, [provider, link, title]);
  const loadMovieboxDetails = useCallback(async () => {
    const data = await api.details(id);
    return {
      ...data,
      provider: "moviebox",
      is_vega: false,
      link_list: [],
    };
  }, [id]);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let data;
      if (isVega) {
        data = await loadVegaDetails();
      } else {
        data = await loadMovieboxDetails();
      }
      if (!isMountedRef.current) return;
      setDetails(data);
      if (Array.isArray(data.audio_tracks) && data.audio_tracks.length > 0) {
        setSelectedTrack(data.audio_tracks[0].subject_id);
      }
      const seasons = data.seasons || [];
      if (seasons.length > 0) setSelectedSeason(seasons[0].number);
      const fav = await isFavorite({
        id: data.id,
        provider: data.provider || "moviebox",
      });
      if (!isMountedRef.current) return;
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
  useEffect(() => {
    if (title) navigation.setOptions({ title });
  }, [title, navigation]);
  useEffect(() => {
    if (!details || isVega) return;
    const isSeries = details.media_type === "series";
    const target = isSeries
      ? {
          id: details.id,
          provider: "moviebox",
          season: selectedSeason,
          episode: 1,
        }
      : { id: details.id, provider: "moviebox", season: 0, episode: 0 };
    getProgress(target).then((p) => {
      if (isMountedRef.current) setResumeInfo(p);
    });
  }, [details, selectedSeason, isVega]);
  useEffect(() => {
    if (!details || !selectedTrack || isVega) return;
    getDownloadByContent({
      contentId: details.id,
      season: 0,
      episode: 0,
      audioSubjectId: selectedTrack,
    }).then((rec) => {
      if (isMountedRef.current) setExistingDownload(rec);
    });
  }, [details, selectedTrack, isVega, downloads]);
  const handleFavorite = useCallback(async () => {
    if (!details) return;
    const next = await toggleFavorite({
      id: details.id,
      provider: details.provider || "moviebox",
      title: details.title,
      poster: details.poster_url,
      year: details.year,
      media_type: details.media_type,
    });
    if (isMountedRef.current) setIsFav(next);
  }, [details]);
  const tracks = details?.audio_tracks || [];
  const seasons = details?.seasons || [];
  const isSeries =
    details?.media_type === "series" && seasons.length > 0 && !isVega;
  const currentSeason = useMemo(
    () =>
      seasons.find((s) => s.number === selectedSeason) || seasons[0] || null,
    [seasons, selectedSeason]
  );
  const episodes = currentSeason ? currentSeason.episodes || [] : [];
  const openExternal = useCallback(async (url) => {
    if (!url) return;
    try {
      const ok = await Linking.canOpenURL(url);
      if (!ok) {
        Alert.alert("Cannot open", "No browser available for this link.");
        return;
      }
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert("Cannot open", err.message || "Failed to open link.");
    }
  }, []);
  const playMovie = useCallback(() => {
    if (!details) return;
    navigation.navigate("Player", {
      id: details.id,
      title: details.title,
      poster: details.poster_url || null,
      audioTrack: selectedTrack,
      audioTracks: tracks,
      season: 0,
      episode: 0,
      resume: resumeInfo ? resumeInfo.position : 0,
    });
  }, [details, navigation, selectedTrack, tracks, resumeInfo]);
  const playEpisode = useCallback(
    (episode) => {
      if (!details || !currentSeason) return;
      navigation.navigate("Player", {
        id: details.id,
        title:
          details.title +
          " S" +
          currentSeason.number +
          "E" +
          episode.number,
        poster: details.poster_url || null,
        audioTrack: selectedTrack,
        audioTracks: tracks,
        season: currentSeason.number,
        episode: episode.number,
        resume: 0,
      });
    },
    [details, currentSeason, navigation, selectedTrack, tracks]
  );
  const playVegaOption = useCallback(
    async (opt) => {
      if (!details) return;
      if (isMountedRef.current) setDownloadBusy(true);
      try {
        let streamLink = opt.url;
        if (opt.isEpisodesLink) {
          const eps = await api.vegaEpisodes(details.provider, opt.url);
          const list = (eps && eps.episodes) || [];
          if (list.length > 0 && list[0].link) {
            streamLink = list[0].link;
          }
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
          navigation.navigate("Player", {
            id: null,
            title: details.title,
            poster: details.poster_url || null,
            audioTrack: null,
            audioTracks: [],
            season: 0,
            episode: 0,
            resume: 0,
            streamUrl: first.link,
            streamHeaders: first.headers || null,
            externalStream: true,
          });
          return;
        }
      } catch (_) {
      } finally {
        if (isMountedRef.current) setDownloadBusy(false);
      }
      Alert.alert(
        "External playback",
        "This stream cannot be played in-app. Open the source page in your browser?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open", onPress: () => openExternal(opt.url) },
        ]
      );
    },
    [details, navigation, openExternal]
  );
  const runDownloadFlow = useCallback(
    async ({ season, episode, episodeTitle }) => {
      if (!details || isVega) return;
      if (downloadBusy) return;
      setDownloadBusy(true);
      try {
        const existing = await getDownloadByContent({
          contentId: details.id,
          season,
          episode,
          audioSubjectId: selectedTrack,
        });
        if (existing && existing.status === "completed") {
          Alert.alert(
            "Already downloaded",
            "This title is already available offline.",
            [
              { text: "OK" },
              {
                text: "Open Downloads",
                onPress: () => navigation.navigate("Downloads"),
              },
            ]
          );
          return;
        }
        const perm = await ensureStoragePermission();
        if (!perm.granted) {
          Alert.alert(
            "Storage permission required",
            "MayaBox needs storage permission to save downloads on your device.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Open settings", onPress: () => openAppSettings() },
            ]
          );
          return;
        }
        let sizeBytes = null;
        let quality = null;
        try {
          const data = await api.streams(
            details.id,
            season,
            episode,
            selectedTrack,
            null
          );
          const streams = (data.streams || []).filter((s) => s.url);
          if (streams.length > 0) {
            const sorted = [...streams].sort(
              (a, b) => (b.size_bytes || 0) - (a.size_bytes || 0)
            );
            sizeBytes = sorted[0].size_bytes || null;
            quality = sorted[0].quality || null;
          }
        } catch (_) {}
        if (sizeBytes) {
          const space = await hasEnoughSpace(sizeBytes);
          if (!space.ok) {
            Alert.alert(
              "Not enough storage",
              "This download needs about " +
                formatBytes(space.needed) +
                " but only " +
                formatBytes(space.free) +
                " is free.\n\nFree up some space and try again.",
              [{ text: "OK" }]
            );
            return;
          }
        }
        const audioLabel =
          (tracks.find((t) => t.subject_id === selectedTrack) || {})
            .language || "Default";
        const sizeText = sizeBytes ? formatBytes(sizeBytes) : "Unknown size";
        const header = episodeTitle || details.title;
        const confirmed = await new Promise((resolve) => {
          Alert.alert(
            "Start download?",
            header +
              "\n\n" +
              (quality || "Auto") +
              "  ·  " +
              sizeText +
              "  ·  " +
              audioLabel,
            [
              {
                text: "Cancel",
                style: "cancel",
                onPress: () => resolve(false),
              },
              { text: "Download", onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) }
          );
        });
        if (!confirmed) return;
        let info = null;
        try {
          info = await api.downloadInfo(
            details.id,
            season,
            episode,
            selectedTrack,
            header,
            null
          );
        } catch (_) {
          info = null;
        }
        let sourceUrl;
        let downloadHeaders = {};
        if (
          info &&
          info.type === "direct" &&
          info.url &&
          info.url.includes(".mp4")
        ) {
          sourceUrl = info.url;
          downloadHeaders = info.headers || {};
        } else {
          sourceUrl = buildDownloadUrl({
            id: details.id,
            season,
            episode,
            audio: selectedTrack,
            title:
              details.title +
              (episode > 0 ? " S" + season + "E" + episode : ""),
            maxHeight: null,
          });
          downloadHeaders = {};
        }
        if (info && info.size_bytes && !sizeBytes) {
          sizeBytes = info.size_bytes;
        }
        navigation.navigate("Downloads");
        startDownload({
          contentId: details.id,
          provider: "moviebox",
          title: header,
          poster: details.poster_url || null,
          year: details.year || null,
          media_type: isSeries ? "series" : "movie",
          season,
          episode,
          audioSubjectId: selectedTrack,
          audioLabel,
          quality,
          sizeBytes,
          sourceUrl,
          headers: downloadHeaders,
        }).then((res) => {
          if (res && res.ok) {
            refreshDownloads();
          }
        });
      } catch (err) {
        Alert.alert("Download failed", err.message || "Something went wrong.");
      } finally {
        if (isMountedRef.current) setDownloadBusy(false);
      }
    },
    [
      details,
      isVega,
      downloadBusy,
      selectedTrack,
      tracks,
      isSeries,
      navigation,
      startDownload,
      refreshDownloads,
    ]
  );
  const handleDownloadMovie = useCallback(() => {
    runDownloadFlow({ season: 0, episode: 0, episodeTitle: null });
  }, [runDownloadFlow]);
  const handleDownloadEpisode = useCallback(
    (ep) => {
      if (!currentSeason) return;
      const label =
        details.title +
        " S" +
        currentSeason.number +
        "E" +
        ep.number +
        (ep.title ? " · " + ep.title : "");
      runDownloadFlow({
        season: currentSeason.number,
        episode: ep.number,
        episodeTitle: label,
      });
    },
    [runDownloadFlow, currentSeason, details]
  );
  if (loading) return <LoadingState message="Loading details" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!details) return null;
  const hasResume =
    !isSeries && !isVega && resumeInfo && resumeInfo.position > 0;
  const resumePercent =
    hasResume && resumeInfo.duration
      ? Math.min(
          100,
          Math.round((resumeInfo.position / resumeInfo.duration) * 100)
        )
      : 0;
  const downloadDone =
    !isVega && existingDownload && existingDownload.status === "completed";
  const downloadActive =
    !isVega && existingDownload && existingDownload.status === "downloading";
  const downloadProgress = existingDownload ? existingDownload.progress : 0;
  const backdropUri = details.backdrop_url || details.poster_url;
  const posterUri = details.poster_url || details.backdrop_url;
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroWrap}>
          {backdropUri ? (
            <Image
              source={{ uri: backdropUri }}
              style={styles.heroBackdrop}
              contentFit="cover"
              blurRadius={isVega ? 8 : 30}
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={styles.heroBackdrop} />
          )}
          <LinearGradient
            colors={[
              "rgba(13,13,13,0.4)",
              "rgba(13,13,13,0.85)",
              colors.background,
            ]}
            locations={[0, 0.6, 1]}
            style={styles.heroGradient}
          />
          <View style={[styles.heroInner, isTV && styles.heroInnerTV]}>
            <View style={[styles.posterWrap, isTV && styles.posterWrapTV]}>
              {posterUri ? (
                <Image
                  source={{ uri: posterUri }}
                  style={styles.poster}
                  contentFit="cover"
                  transition={200}
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={[styles.poster, styles.posterFallback]}>
                  <Ionicons
                    name="film-outline"
                    size={48}
                    color={colors.foregroundDim}
                  />
                </View>
              )}
            </View>
            <View style={styles.heroDetails}>
              <Text
                style={[styles.title, isTV && styles.titleTV]}
                numberOfLines={2}
              >
                {details.title}
              </Text>
              <View style={styles.metaRow}>
                {details.year ? (
                  <Text style={styles.metaText}>{details.year}</Text>
                ) : null}
                {details.year && details.duration ? (
                  <View style={styles.dot} />
                ) : null}
                {details.duration ? (
                  <Text style={styles.metaText}>{details.duration}</Text>
                ) : null}
                {details.imdb_rating ? (
                  <>
                    {(details.year || details.duration) && (
                      <View style={styles.dot} />
                    )}
                    <View style={styles.ratingChip}>
                      <Text style={styles.ratingLabel}>IMDb</Text>
                      <Text style={styles.ratingValue}>
                        {details.imdb_rating}
                      </Text>
                    </View>
                  </>
                ) : null}
                {isSeries ? (
                  <>
                    <View style={styles.dot} />
                    <Text style={styles.metaText}>
                      {seasons.length} season{seasons.length > 1 ? "s" : ""}
                    </Text>
                  </>
                ) : null}
                {isVega ? (
                  <>
                    <View style={styles.dot} />
                    <View style={styles.sourceChip}>
                      <Text style={styles.sourceLabel}>
                        {String(details.provider).toUpperCase()}
                      </Text>
                    </View>
                  </>
                ) : null}
              </View>
              {details.genres && details.genres.length > 0 ? (
                <View style={styles.genreRow}>
                  {details.genres.slice(0, 5).map((g, i) => (
                    <View key={g + i} style={styles.genreChip}>
                      <Text style={styles.genreText}>{g}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {hasResume && (
                <View style={styles.resumeBanner}>
                  <View style={styles.resumeBarTrack}>
                    <View
                      style={[
                        styles.resumeBarFill,
                        { width: resumePercent + "%" },
                      ]}
                    />
                  </View>
                  <Text style={styles.resumeText}>
                    {resumePercent}% watched
                  </Text>
                </View>
              )}
              <View style={styles.actionRow}>
                {!isSeries && !isVega ? (
                  <Pressable
                    onPress={playMovie}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      pressed && styles.btnPressed,
                    ]}
                  >
                    <Ionicons
                      name="play"
                      size={18}
                      color={colors.background}
                    />
                    <Text style={styles.primaryBtnText}>
                      {hasResume ? "Resume" : "Play"}
                    </Text>
                  </Pressable>
                ) : null}
                {!isVega && !isSeries ? (
                  <Pressable
                    onPress={handleDownloadMovie}
                    disabled={downloadBusy || downloadActive}
                    style={({ pressed }) => [
                      styles.secondaryBtn,
                      downloadDone && styles.secondaryBtnDone,
                      pressed && styles.btnPressed,
                    ]}
                  >
                    <Ionicons
                      name={
                        downloadDone
                          ? "checkmark-circle"
                          : downloadActive
                          ? "cloud-download"
                          : "download-outline"
                      }
                      size={18}
                      color={
                        downloadDone
                          ? colors.accent
                          : downloadActive
                          ? colors.accent
                          : colors.foreground
                      }
                    />
                    <Text
                      style={[
                        styles.secondaryBtnText,
                        downloadDone && styles.secondaryBtnTextActive,
                      ]}
                    >
                      {downloadDone
                        ? "Downloaded"
                        : downloadActive
                        ? downloadProgress + "%"
                        : "Download"}
                    </Text>
                  </Pressable>
                ) : null}
                {isVega && details.web_url ? (
                  <Pressable
                    onPress={() => openExternal(details.web_url)}
                    style={({ pressed }) => [
                      styles.secondaryBtn,
                      pressed && styles.btnPressed,
                    ]}
                  >
                    <Ionicons
                      name="open-outline"
                      size={18}
                      color={colors.foreground}
                    />
                    <Text style={styles.secondaryBtnText}>Open Source</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={handleFavorite}
                  style={({ pressed }) => [
                    styles.iconBtn,
                    isFav && styles.iconBtnActive,
                    pressed && styles.btnPressed,
                  ]}
                >
                  <Ionicons
                    name={isFav ? "heart" : "heart-outline"}
                    size={20}
                    color={isFav ? colors.error : colors.foreground}
                  />
                </Pressable>
              </View>
            </View>
          </View>
        </View>
        <View style={styles.body}>
          {details.description ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Overview</Text>
              <Text style={styles.description}>{details.description}</Text>
            </View>
          ) : null}
          {isVega && details.cast && details.cast.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Cast</Text>
              <View style={styles.castRow}>
                {details.cast.slice(0, 12).map((name, i) => (
                  <View key={name + i} style={styles.castChip}>
                    <Text style={styles.castText}>{name}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          {!isVega && tracks.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Audio</Text>
              <View style={styles.pillRow}>
                {tracks.map((track, idx) => {
                  const active = selectedTrack === track.subject_id;
                  return (
                    <Pressable
                      key={track.subject_id + "-" + idx}
                      onPress={() => setSelectedTrack(track.subject_id)}
                      style={({ pressed }) => [
                        styles.pill,
                        active && styles.pillActive,
                        pressed && styles.pillPressed,
                      ]}
                    >
                      {active ? (
                        <Ionicons
                          name="checkmark"
                          size={14}
                          color={colors.background}
                        />
                      ) : null}
                      <Text
                        style={[
                          styles.pillText,
                          active && styles.pillTextActive,
                        ]}
                      >
                        {track.language}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          {isVega && details.link_list && details.link_list.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Download Options</Text>
              <View style={styles.downloadList}>
                {details.link_list.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => playVegaOption(opt)}
                    disabled={downloadBusy}
                    style={({ pressed }) => [
                      styles.downloadRow,
                      pressed && styles.downloadRowPressed,
                    ]}
                  >
                    <View style={styles.downloadIcon}>
                      <Ionicons
                        name="play-circle-outline"
                        size={22}
                        color={colors.accent}
                      />
                    </View>
                    <View style={styles.downloadBody}>
                      <Text
                        style={styles.downloadTitle}
                        numberOfLines={3}
                      >
                        {opt.title}
                      </Text>
                      {opt.quality ? (
                        <Text style={styles.downloadQuality}>
                          {opt.quality}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.foregroundMuted}
                    />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {isSeries && currentSeason ? (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Season</Text>
                <View style={styles.pillRow}>
                  {seasons.map((s) => {
                    const active = selectedSeason === s.number;
                    return (
                      <Pressable
                        key={s.number}
                        onPress={() => setSelectedSeason(s.number)}
                        style={({ pressed }) => [
                          styles.pill,
                          active && styles.pillActive,
                          pressed && styles.pillPressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.pillText,
                            active && styles.pillTextActive,
                          ]}
                        >
                          {"Season " + s.number}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {"Episodes · Season " + currentSeason.number}
                </Text>
                <View style={styles.episodeList}>
                  {episodes.map((ep) => (
                    <View key={ep.number} style={styles.episodeRow}>
                      <Pressable
                        onPress={() => playEpisode(ep)}
                        style={styles.episodeMain}
                      >
                        <View style={styles.episodeNumBadge}>
                          <Text style={styles.episodeNumText}>
                            {ep.number}
                          </Text>
                        </View>
                        <View style={styles.episodeBody}>
                          <Text
                            style={styles.episodeTitle}
                            numberOfLines={1}
                          >
                            {ep.title || "Episode " + ep.number}
                          </Text>
                          {ep.overview ? (
                            <Text
                              style={styles.episodeOverview}
                              numberOfLines={2}
                            >
                              {ep.overview}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.episodePlayIcon}>
                          <Ionicons
                            name="play"
                            size={16}
                            color={colors.foreground}
                          />
                        </View>
                      </Pressable>
                      <Pressable
                        onPress={() => handleDownloadEpisode(ep)}
                        disabled={downloadBusy}
                        style={({ pressed }) => [
                          styles.episodeDownloadBtn,
                          pressed && styles.btnPressed,
                        ]}
                        hitSlop={8}
                      >
                        <Ionicons
                          name="download-outline"
                          size={18}
                          color={colors.foreground}
                        />
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
function extractYear(text) {
  if (!text) return null;
  const m = String(text).match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing.xxl },
  heroWrap: {
    position: "relative",
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  heroBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 340,
    opacity: 0.5,
  },
  heroGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 340,
  },
  heroInner: {
    flexDirection: "column",
    paddingHorizontal: spacing.lg,
  },
  heroInnerTV: {
    flexDirection: "row",
    gap: spacing.xxl,
    alignItems: "flex-start",
  },
  posterWrap: {
    width: 160,
    aspectRatio: 2 / 3,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surface,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  posterWrapTV: { width: 280, marginBottom: 0 },
  poster: { width: "100%", height: "100%" },
  posterFallback: { alignItems: "center", justifyContent: "center" },
  heroDetails: { flex: 1 },
  title: {
    color: colors.foreground,
    fontSize: 24,
    fontWeight: "800",
    marginBottom: spacing.sm,
    letterSpacing: 0.2,
    lineHeight: 30,
  },
  titleTV: { fontSize: 34, lineHeight: 42 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  metaText: {
    color: colors.foregroundMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.foregroundDim,
  },
  ratingChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  ratingLabel: {
    color: colors.foregroundMuted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  ratingValue: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: "800",
  },
  sourceChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "rgba(0,168,225,0.14)",
    borderWidth: 1,
    borderColor: "rgba(0,168,225,0.35)",
  },
  sourceLabel: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  genreRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: spacing.md,
  },
  genreChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  genreText: {
    color: colors.foregroundMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  resumeBanner: { marginBottom: spacing.md },
  resumeBarTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)",
    overflow: "hidden",
    marginBottom: 6,
  },
  resumeBarFill: { height: "100%", backgroundColor: colors.accent },
  resumeText: {
    color: colors.foregroundMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: "wrap",
    alignItems: "center",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    minWidth: 120,
  },
  primaryBtnText: {
    color: colors.background,
    fontWeight: "800",
    fontSize: 14,
    letterSpacing: 0.3,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    minWidth: 130,
  },
  secondaryBtnDone: {
    backgroundColor: "rgba(0,168,225,0.12)",
    borderColor: "rgba(0,168,225,0.35)",
  },
  secondaryBtnText: {
    color: colors.foreground,
    fontWeight: "700",
    fontSize: 13,
  },
  secondaryBtnTextActive: { color: colors.accent },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  iconBtnActive: {
    backgroundColor: "rgba(255,71,71,0.12)",
    borderColor: "rgba(255,71,71,0.35)",
  },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  body: {
    paddingHorizontal: spacing.lg,
    gap: spacing.xl,
    marginTop: spacing.md,
  },
  section: { gap: spacing.sm },
  sectionTitle: {
    color: colors.foregroundMuted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  description: {
    color: colors.foreground,
    fontSize: 14,
    lineHeight: 22,
  },
  castRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  castChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  castText: {
    color: colors.foreground,
    fontSize: 12,
    fontWeight: "600",
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  pillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  pillPressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  pillText: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "600",
  },
  pillTextActive: {
    color: colors.background,
    fontWeight: "800",
  },
  downloadList: { gap: spacing.sm },
  downloadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  downloadRowPressed: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  downloadIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,168,225,0.1)",
    borderWidth: 1,
    borderColor: "rgba(0,168,225,0.25)",
  },
  downloadBody: { flex: 1, gap: 2 },
  downloadTitle: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  downloadQuality: {
    color: colors.foregroundMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  episodeList: { gap: spacing.sm, marginTop: spacing.xs },
  episodeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    paddingRight: spacing.sm,
  },
  episodeMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  episodeNumBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  episodeNumText: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "800",
  },
  episodeBody: { flex: 1, gap: 2 },
  episodeTitle: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "700",
  },
  episodeOverview: {
    color: colors.foregroundMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  episodePlayIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  episodeDownloadBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
});