import { Feather } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useColorScheme } from "nativewind";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConsultationPicker } from "../../../../components/ConsultationPicker";
import { PhotoSlide } from "../../../../components/PhotoSlide";
import { useThemeColors } from "../../../../hooks/useThemeColors";
import { toRenderableImageUriAsync } from "../../../../services/imageUri";
import { consultationIndexService } from "../../../../services/indexing/consultationIndexService";
import { getConsultation } from "../../../../services/storage/storage";
import type { ConsultationIndexRow } from "../../../../types/models";

const CONSULTATIONS_PAGE_SIZE = 100;
// The picker is a single scrollable sheet, so cap how much we pull into memory.
const MAX_CONSULTATIONS = 500;

/** Drain the cursor-paginated index into one list, newest visit first. */
const loadAllConsultationsAsync = async (patientId: string) => {
  const all: ConsultationIndexRow[] = [];

  let page = await consultationIndexService.queryConsultationsPageAsync({
    patientId,
    limit: CONSULTATIONS_PAGE_SIZE,
  });
  all.push(...page.items);

  while (page.nextCursor && all.length < MAX_CONSULTATIONS) {
    page = await consultationIndexService.queryConsultationsPageAsync({
      patientId,
      limit: CONSULTATIONS_PAGE_SIZE,
      cursor: page.nextCursor,
    });
    all.push(...page.items);
  }

  // The index orders by updatedAt; compare is chronological, so re-sort by visit date.
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

/** Persisted SAF `content://` URIs don't render on Android; resolve to cache `file://` URIs. */
const loadPhotoUrisAsync = async (patientId: string, consultationId: string) => {
  const consultation = await getConsultation(patientId, consultationId);
  if (!consultation?.photoUris?.length) return [];

  return Promise.all(
    consultation.photoUris.map(async (uri) => {
      try {
        return (await toRenderableImageUriAsync(uri)) ?? uri;
      } catch {
        return uri;
      }
    }),
  );
};

/** `null` while loading, `[]` when the consultation has no photos. */
function useConsultationPhotos(patientId?: string, consultationId?: string) {
  const [photos, setPhotos] = useState<string[] | null>(null);

  useEffect(() => {
    if (!patientId || !consultationId) {
      setPhotos(null);
      return;
    }

    let cancelled = false;
    setPhotos(null);

    void (async () => {
      try {
        const uris = await loadPhotoUrisAsync(patientId, consultationId);
        if (!cancelled) setPhotos(uris);
      } catch {
        if (!cancelled) setPhotos([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [patientId, consultationId]);

  return photos;
}

type ComparePaneProps = {
  photos: string[] | null;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
};

function ComparePane({
  photos,
  activeIndex,
  onActiveIndexChange,
}: ComparePaneProps) {
  const listRef = useRef<FlatList<string>>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  // Swapping the consultation replaces the photo list; rewind to the first page.
  useEffect(() => {
    if (!photos?.length) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    });
  }, [photos]);

  const onMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!size.width || !photos?.length) return;
    const current = Math.round(event.nativeEvent.contentOffset.x / size.width);
    onActiveIndexChange(Math.max(0, Math.min(photos.length - 1, current)));
  };

  const isMeasured = size.width > 0 && size.height > 0;

  return (
    <View
      onLayout={onLayout}
      className="flex-1 rounded-2xl overflow-hidden bg-black"
    >
      {photos === null ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color="#e2e8f0" />
        </View>
      ) : photos.length === 0 ? (
        <View className="flex-1 items-center justify-center px-4">
          <Text className="text-sm text-slate-400 text-center">
            This consultation has no photos.
          </Text>
        </View>
      ) : isMeasured ? (
        <>
          <FlatList
            ref={listRef}
            data={photos}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item, index) => `${index}:${item}`}
            onMomentumScrollEnd={onMomentumEnd}
            getItemLayout={(_, index) => ({
              length: size.width,
              offset: size.width * index,
              index,
            })}
            renderItem={({ item, index }) => (
              <PhotoSlide
                sourceUri={item}
                width={size.width}
                height={size.height}
                isActive={index === activeIndex}
              />
            )}
          />

          <View className="absolute bottom-2 left-0 right-0 items-center">
            <View className="rounded-full bg-black/60 px-3 py-1">
              <Text className="text-xs text-slate-200">
                {activeIndex + 1} / {photos.length}
              </Text>
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

export default function CompareConsultationsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const { patientId } = useLocalSearchParams<{ patientId: string }>();

  const [consultations, setConsultations] = useState<ConsultationIndexRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [topId, setTopId] = useState<string>();
  const [bottomId, setBottomId] = useState<string>();
  const [topIndex, setTopIndex] = useState(0);
  const [bottomIndex, setBottomIndex] = useState(0);

  const topPhotos = useConsultationPhotos(patientId, topId);
  const bottomPhotos = useConsultationPhotos(patientId, bottomId);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;

    void (async () => {
      try {
        const all = await loadAllConsultationsAsync(patientId);
        if (cancelled) return;

        setConsultations(all);
        // Default to the two most recent visits, oldest on top, so dragging the
        // overlay slider left-to-right moves forward in time.
        setTopId(all[1]?.id ?? all[0]?.id);
        setBottomId(all[0]?.id);
      } catch (error) {
        if (!cancelled) {
          Alert.alert(
            "Load failed",
            `Could not load consultations. Error: ${(error as Error).message}`,
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const canOverlay =
    Boolean(topId) &&
    Boolean(bottomId) &&
    Boolean(topPhotos?.length) &&
    Boolean(bottomPhotos?.length);

  const openOverlay = () => {
    if (!canOverlay) return;
    router.push(
      `/patient/${patientId}/compare/overlay?topId=${topId}&topIndex=${topIndex}&bottomId=${bottomId}&bottomIndex=${bottomIndex}`,
    );
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Stack.Screen options={{ title: "Compare" }} />
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (consultations.length === 0) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center px-8 bg-slate-50 dark:bg-slate-950">
        <Stack.Screen options={{ title: "Compare" }} />
        <Text className="text-base text-slate-700 text-center dark:text-slate-200">
          Add a consultation before comparing.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
      <Stack.Screen options={{ title: "Compare" }} />

      <View className="flex-1 px-4 pt-3 pb-4">
        <View className="flex-1">
          <ConsultationPicker
            label="Before (top)"
            consultations={consultations}
            selectedId={topId}
            onSelect={(id) => {
              setTopId(id);
              setTopIndex(0);
            }}
          />
          <View className="h-2" />
          <ComparePane
            photos={topPhotos}
            activeIndex={topIndex}
            onActiveIndexChange={setTopIndex}
          />
        </View>

        <View className="h-3" />

        <View className="flex-1">
          <ConsultationPicker
            label="After (bottom)"
            consultations={consultations}
            selectedId={bottomId}
            onSelect={(id) => {
              setBottomId(id);
              setBottomIndex(0);
            }}
          />
          <View className="h-2" />
          <ComparePane
            photos={bottomPhotos}
            activeIndex={bottomIndex}
            onActiveIndexChange={setBottomIndex}
          />
        </View>

        <Pressable
          onPress={openOverlay}
          disabled={!canOverlay}
          accessibilityLabel="Overlay the two photos"
          style={{ opacity: canOverlay ? 1 : 0.4 }}
          className="mt-4 flex-row items-center justify-center rounded-xl py-3 bg-slate-900 dark:bg-slate-100"
        >
          <Feather name="layers" size={16} color={isDark ? "#0f172a" : "white"} />
          <Text className="ml-2 font-semibold text-white dark:text-slate-900">
            Overlay
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
