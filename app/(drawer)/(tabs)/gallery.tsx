import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { memo, useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "../../../components/ui/EmptyState";
import { useDatasetFocusRefresh } from "../../../hooks/useDatasetFocusRefresh";
import { useResolvedImageUri } from "../../../hooks/useResolvedImageUri";
import { useSyncRefresh } from "../../../hooks/useSyncRefresh";
import { useThemeColors } from "../../../hooks/useThemeColors";
import type { PhotoCursor } from "../../../services/db/dermaDb";
import { consultationIndexService } from "../../../services/indexing/consultationIndexService";
import { initStorage } from "../../../services/storage/storage";
import type { PhotoIndexRow } from "../../../types/models";

const PAGE_SIZE = 60;
const COLUMNS = 3;
const CELL_GAP = 2;

const GalleryCell = memo(function GalleryCell({
  item,
  size,
  onPress,
}: {
  item: PhotoIndexRow;
  size: number;
  onPress: (item: PhotoIndexRow) => void;
}) {
  const displayUri = useResolvedImageUri(item.thumbUri ?? item.uri);

  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityLabel="Open photo"
      style={{ width: size, height: size, padding: CELL_GAP / 2 }}
    >
      <Image
        source={{ uri: displayUri }}
        recyclingKey={`${item.patientId}/${item.consultationId}/${item.file}`}
        cachePolicy="memory-disk"
        style={{ flex: 1, borderRadius: 4 }}
        contentFit="cover"
      />
    </Pressable>
  );
});

/** Every photo across all patients, newest capture first, paged from the photos index. */
export default function GalleryScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const cellSize = width / COLUMNS;

  const [items, setItems] = useState<PhotoIndexRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const cursorRef = useRef<PhotoCursor | undefined>(undefined);
  const loadSeq = useRef(0);

  const loadFirstPage = useCallback(async () => {
    loadSeq.current += 1;
    const seq = loadSeq.current;
    setLoading(true);
    try {
      await initStorage();
      cursorRef.current = undefined;
      const { items: page, nextCursor } =
        await consultationIndexService.queryPhotosPageAsync({ limit: PAGE_SIZE });

      if (seq !== loadSeq.current) return;
      setItems(page);
      cursorRef.current = nextCursor;
      setHasMore(Boolean(nextCursor));
    } catch {
      if (seq === loadSeq.current) setItems([]);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    const cursor = cursorRef.current;
    if (!cursor) return;

    loadSeq.current += 1;
    const seq = loadSeq.current;
    setLoadingMore(true);
    try {
      const { items: page, nextCursor } =
        await consultationIndexService.queryPhotosPageAsync({ limit: PAGE_SIZE, cursor });

      if (seq !== loadSeq.current) return;
      setItems((prev) => [...prev, ...page]);
      cursorRef.current = nextCursor;
      setHasMore(Boolean(nextCursor));
    } catch {
      // Best-effort paging.
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loading, loadingMore]);

  useDatasetFocusRefresh(loadFirstPage);

  // Swipe down to run a sync (when on) and reload the grid.
  const { refreshing, onRefresh } = useSyncRefresh(loadFirstPage);

  const openPhoto = useCallback(
    (item: PhotoIndexRow) => {
      router.push(
        `/patient/${item.patientId}/consultation/${item.consultationId}/photos?index=${item.position}`,
      );
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: PhotoIndexRow }) => (
      <GalleryCell item={item} size={cellSize} onPress={openPhoto} />
    ),
    [cellSize, openPhoto],
  );

  // Shared between the populated grid and the empty state so both are pullable — a fresh
  // synced device lands on the empty gallery, exactly where pulling to sync matters most.
  const refreshControlEl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.accent}
      colors={[colors.accent]}
      progressBackgroundColor={colors.surface}
    />
  );

  return (
    <SafeAreaView
      edges={["bottom", "left", "right"]}
      className="flex-1 bg-slate-50 dark:bg-slate-950"
    >
      {loading && !refreshing ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : items.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={refreshControlEl}
        >
          <EmptyState
            icon="image"
            title="No photos yet"
            message="Photos you take during consultations will appear here, newest first."
          />
        </ScrollView>
      ) : (
        <FlashList
          data={items}
          numColumns={COLUMNS}
          keyExtractor={(item) => `${item.patientId}/${item.consultationId}/${item.file}`}
          renderItem={renderItem}
          refreshControl={refreshControlEl}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ padding: CELL_GAP / 2 }}
          ListFooterComponent={
            loadingMore ? (
              <View className="py-6">
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}
