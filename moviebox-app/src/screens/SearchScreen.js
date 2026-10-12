import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  Keyboard,
  Pressable,
  Platform,
  FlatList,
  ScrollView,
  Image,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../api/client";
import { colors, spacing, radius } from "../theme/colors";
import { useResponsive } from "../hooks/useResponsive";
import GridLayout from "../components/GridLayout";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
const HISTORY_KEY = "maya.searchHistory";
const HISTORY_MAX = 12;
const DEBOUNCE_MS = 400;
const VEGA_PROVIDERS = ["4khdhub"];
export default function SearchScreen({ navigation }) {
  const { isTV, columns } = useResponsive();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [history, setHistory] = useState([]);
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef(null);
  const abortRef = useRef(0);
  const debounceRef = useRef(null);
  const loadHistory = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setHistory(
          parsed.filter((x) => typeof x === "string").slice(0, HISTORY_MAX)
        );
      }
    } catch (_) {}
  }, []);
  const persistHistory = useCallback(async (next) => {
    try {
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch (_) {}
  }, []);
  const addToHistory = useCallback(
    (term) => {
      const trimmed = term.trim();
      if (!trimmed) return;
      setHistory((prev) => {
        const filtered = prev.filter(
          (x) => x.toLowerCase() !== trimmed.toLowerCase()
        );
        const next = [trimmed, ...filtered].slice(0, HISTORY_MAX);
        persistHistory(next);
        return next;
      });
    },
    [persistHistory]
  );
  const removeFromHistory = useCallback(
    (term) => {
      setHistory((prev) => {
        const next = prev.filter((x) => x !== term);
        persistHistory(next);
        return next;
      });
    },
    [persistHistory]
  );
  const clearHistory = useCallback(() => {
    setHistory([]);
    AsyncStorage.removeItem(HISTORY_KEY).catch(() => {});
  }, []);
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);
  const searchMoviebox = useCallback(async (q) => {
    try {
      const data = await api.search(q, 1);
      const items = (data.results || []).map((item) => ({
        key: "mb:" + item.id,
        source: "moviebox",
        sourceLabel: "MovieBox",
        id: item.id,
        link: null,
        title: item.title,
        year: item.year,
        image: item.poster_url,
        media_type: item.media_type,
      }));
      return items;
    } catch (_) {
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
        media_type: "movie",
      }));
    } catch (_) {
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
      setError(null);
      try {
        const mbPromise = searchMoviebox(trimmed);
        const vegaPromises = VEGA_PROVIDERS.map((p) =>
          searchVega(p, trimmed)
        );
        const [mbResults, ...vegaResults] = await Promise.all([
          mbPromise,
          ...vegaPromises,
        ]);
        if (token !== abortRef.current) return;
        const flatVega = vegaResults.flat();
        const merged = [...mbResults, ...flatVega];
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
        if (save) addToHistory(trimmed);
      } catch (err) {
        if (token !== abortRef.current) return;
        setError(err.message || "Request failed");
      } finally {
        if (token === abortRef.current) setLoading(false);
      }
    },
    [searchMoviebox, searchVega, addToHistory]
  );
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      abortRef.current++;
      setResults([]);
      setHasSearched(false);
      setLoading(false);
      setError(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      runSearch(trimmed, { save: false });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);
  const onSubmit = useCallback(() => {
    Keyboard.dismiss();
    const trimmed = query.trim();
    if (!trimmed) return;
    runSearch(trimmed, { save: true });
  }, [query, runSearch]);
  const handleSelect = useCallback(
    (item) => {
      addToHistory(query);
      if (item.source === "vega") {
        navigation.navigate("Details", {
          provider: item.provider,
          link: item.link,
          title: item.title,
        });
      } else {
        navigation.navigate("Details", {
          id: item.id,
          title: item.title,
          provider: "moviebox",
        });
      }
    },
    [navigation, query, addToHistory]
  );
  const handleHistoryTap = useCallback(
    (term) => {
      setQuery(term);
      Keyboard.dismiss();
      runSearch(term, { save: true });
    },
    [runSearch]
  );
  const handleClearInput = useCallback(() => {
    setQuery("");
    setResults([]);
    setHasSearched(false);
    setError(null);
    inputRef.current?.focus();
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (!isTV && inputRef.current) {
        setTimeout(() => inputRef.current?.focus(), 250);
      }
    }, [isTV])
  );
  const showHistory =
    !query.trim() && !hasSearched && history.length > 0;
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={[styles.header, isTV && styles.headerTV]}>
        <View style={styles.headingRow}>
          <Text style={styles.heading}>Search</Text>
          <Pressable
            onPress={() => navigation.navigate("Downloads")}
            style={({ pressed }) => [
              styles.iconBtn,
              pressed && styles.iconBtnPressed,
            ]}
          >
            <Ionicons
              name="download-outline"
              size={20}
              color={colors.foreground}
            />
          </Pressable>
        </View>
        <View style={styles.searchRow}>
          <View style={styles.inputWrap}>
            <Ionicons
              name="search"
              size={18}
              color={colors.foregroundDim}
              style={styles.inputLeadingIcon}
            />
            <TextInput
              ref={inputRef}
              style={[styles.input, isTV && styles.inputTV]}
              placeholder="Search movies and series"
              placeholderTextColor={colors.foregroundDim}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={onSubmit}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 ? (
              <Pressable
                onPress={handleClearInput}
                hitSlop={10}
                style={styles.inputClearBtn}
              >
                <Ionicons
                  name="close-circle"
                  size={20}
                  color={colors.foregroundDim}
                />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
      {showHistory ? (
        <ScrollView
          contentContainerStyle={styles.historyScroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>Recent searches</Text>
            <Pressable
              onPress={clearHistory}
              style={({ pressed }) => [
                styles.clearHistoryBtn,
                pressed && styles.clearHistoryBtnPressed,
              ]}
            >
              <Ionicons
                name="trash-outline"
                size={14}
                color={colors.foregroundMuted}
              />
              <Text style={styles.clearHistoryText}>Clear</Text>
            </Pressable>
          </View>
          <View style={styles.chipsWrap}>
            {history.map((term) => (
              <Pressable
                key={term}
                onPress={() => handleHistoryTap(term)}
                onLongPress={() => removeFromHistory(term)}
                delayLongPress={400}
                style={({ pressed }) => [
                  styles.chip,
                  pressed && styles.chipPressed,
                ]}
              >
                <Ionicons
                  name="time-outline"
                  size={14}
                  color={colors.foregroundMuted}
                />
                <Text style={styles.chipText} numberOfLines={1}>
                  {term}
                </Text>
                <Pressable
                  onPress={() => removeFromHistory(term)}
                  hitSlop={8}
                  style={styles.chipClose}
                >
                  <Ionicons
                    name="close"
                    size={12}
                    color={colors.foregroundMuted}
                  />
                </Pressable>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      ) : loading ? (
        <LoadingState message="Searching" />
      ) : error ? (
        <ErrorState message={error} onRetry={onSubmit} />
      ) : hasSearched && results.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons
            name="film-outline"
            size={48}
            color={colors.foregroundDim}
            style={styles.emptyIcon}
          />
          <Text style={styles.emptyTitle}>No results</Text>
          <Text style={styles.emptyText}>Try a different title.</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          key={"grid-" + columns}
          numColumns={columns}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={
            columns > 1 ? { gap: spacing.sm } : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons
                name="search-outline"
                size={48}
                color={colors.foregroundDim}
                style={styles.emptyIcon}
              />
              <Text style={styles.emptyTitle}>Search MovieBox</Text>
              <Text style={styles.emptyText}>
                Enter a title to browse movies and series.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ResultCard
              item={item}
              columns={columns}
              onPress={() => handleSelect(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
function ResultCard({ item, columns, onPress }) {
  const { width } = useResponsive();
  const cardWidth =
    (width - spacing.md * 2 - spacing.sm * (columns - 1)) / columns;
  const cardHeight = cardWidth * 1.5;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { width: cardWidth, marginBottom: spacing.md },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View
        style={{
          width: cardWidth,
          height: cardHeight,
          borderRadius: radius.md,
          overflow: "hidden",
          backgroundColor: colors.surface,
          position: "relative",
        }}
      >
        {item.image ? (
          <Image
            source={{ uri: item.image }}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
          />
        ) : (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons
              name="film-outline"
              size={28}
              color={colors.foregroundDim}
            />
          </View>
        )}
        <View style={styles.sourceBadge}>
          <Text style={styles.sourceBadgeText} numberOfLines={1}>
            {item.sourceLabel}
          </Text>
        </View>
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.title}
      </Text>
      {item.year ? (
        <Text style={styles.cardYear}>{item.year}</Text>
      ) : null}
    </Pressable>
  );
}
function extractYear(text) {
  if (!text) return null;
  const m = String(text).match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTV: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  heading: {
    color: colors.foreground,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  iconBtn: {
    backgroundColor: colors.surface,
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconBtnPressed: { opacity: 0.7 },
  searchRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  inputLeadingIcon: {
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    color: colors.foreground,
    paddingVertical: Platform.OS === "ios" ? spacing.md : spacing.sm,
    fontSize: 15,
  },
  inputTV: {
    fontSize: 18,
    paddingVertical: spacing.md,
  },
  inputClearBtn: {
    padding: 4,
    marginLeft: spacing.sm,
  },
  historyScroll: {
    padding: spacing.md,
  },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  historyTitle: {
    color: colors.foregroundMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  clearHistoryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  clearHistoryBtnPressed: { opacity: 0.6 },
  clearHistoryText: {
    color: colors.foregroundMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: "100%",
  },
  chipPressed: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  chipClose: {
    marginLeft: 2,
    padding: 2,
  },
  gridContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xl * 2,
    paddingHorizontal: spacing.lg,
  },
  emptyIcon: {
    marginBottom: spacing.md,
  },
  emptyTitle: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  emptyText: {
    color: colors.foregroundMuted,
    fontSize: 13,
    textAlign: "center",
  },
  sourceBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  sourceBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  cardTitle: {
    color: colors.foreground,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
    lineHeight: 16,
  },
  cardYear: {
    color: colors.foregroundMuted,
    fontSize: 10,
    fontWeight: "600",
    marginTop: 1,
  },
});