import { Feather } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { sharePatientReportAsync } from "../../../../features/pdf/shareReport";
import { useDatasetFocusRefresh } from "../../../../hooks/useDatasetFocusRefresh";
import { useResolvedPhotoUris } from "../../../../hooks/useResolvedImageUri";
import { useThemeColors } from "../../../../hooks/useThemeColors";
import { consultationIndexService } from "../../../../services/indexing/consultationIndexService";
import { getConsultation } from "../../../../services/storage/storage";
import { Consultation } from "../../../../types/models";

const COLUMNS = 3;
const GRID_PADDING = 16;
const CELL_GAP = 6;

export default function ViewConsultationScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const { patientId, consultationId } = useLocalSearchParams<{
    patientId: string;
    consultationId: string;
  }>();

  const [consultation, setConsultation] = useState<Consultation | null>(null);
  // Derived display ordinal (position over createdAt); the stored consultation has no number.
  const [number, setNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharingPdf, setSharingPdf] = useState(false);

  const onSharePdf = useCallback(async () => {
    if (!patientId || !consultationId) return;
    setSharingPdf(true);
    try {
      await sharePatientReportAsync(patientId, [consultationId]);
    } catch (error) {
      Alert.alert("Couldn't create the PDF", (error as Error).message);
    } finally {
      setSharingPdf(false);
    }
  }, [consultationId, patientId]);

  // Grid tiles render thumbnails when present (full image as fallback), resolved from
  // persisted SAF/content URIs to cache file:// URIs.
  const gridSourceUris = (consultation?.photoUris ?? []).map(
    (uri, index) => consultation?.thumbUris[index] ?? uri,
  );
  const photoDisplayUris = useResolvedPhotoUris(gridSourceUris);

  const load = useCallback(async () => {
    if (!patientId || !consultationId) return;
    setLoading(true);
    const data = await getConsultation(patientId, consultationId);
    setConsultation(data);
    setNumber(await consultationIndexService.getConsultationNumberAsync(patientId, consultationId));
    setLoading(false);
  }, [patientId, consultationId]);

  // Re-query only when the dataset changed (e.g. returning from an edit), not on every focus.
  useDatasetFocusRefresh(load);

  const openPhoto = useCallback(
    (index: number) => {
      router.push(
        `/patient/${patientId}/consultation/${consultationId}/photos?index=${index}`,
      );
    },
    [consultationId, patientId, router],
  );

  const cellSize = (width - GRID_PADDING * 2) / COLUMNS;

  const renderPhoto = useCallback(
    ({ item: source, index }: { item: string; index: number }) => (
      <Pressable
        onPress={() => openPhoto(index)}
        accessibilityLabel="Open photo"
        style={{ width: cellSize, height: cellSize, padding: CELL_GAP / 2 }}
      >
        <Image
          source={{ uri: photoDisplayUris[source] ?? source }}
          recyclingKey={source}
          cachePolicy="memory-disk"
          style={{ flex: 1, borderRadius: 12 }}
          contentFit="cover"
        />
      </Pressable>
    ),
    [cellSize, openPhoto, photoDisplayUris],
  );

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (!consultation) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Text className="text-base text-slate-700 dark:text-slate-200">
          Consultation not found.
        </Text>
      </SafeAreaView>
    );
  }

  const header = (
    <View>
      <View className="flex-row items-center justify-between mb-1">
        <Text className="flex-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
          Consultation {consultation.cid}
        </Text>
        <Pressable
          onPress={() => void onSharePdf()}
          disabled={sharingPdf}
          className="p-2"
          accessibilityLabel="Share as PDF"
          style={{ opacity: sharingPdf ? 0.4 : 1 }}
        >
          {sharingPdf ? (
            <ActivityIndicator size="small" color={colors.iconStrong} />
          ) : (
            <Feather name="share-2" size={20} color={colors.iconStrong} />
          )}
        </Pressable>
        <Pressable
          onPress={() =>
            router.push(
              `/patient/${patientId}/consultation/add?consultationId=${consultationId}`,
            )
          }
          className="p-2"
          accessibilityLabel="Edit consultation"
        >
          <Feather name="edit-2" size={20} color={colors.iconStrong} />
        </Pressable>
      </View>

      <Text className="text-sm text-slate-500 mb-3 dark:text-slate-400">
        {number ? `Visit #${number} · ` : ""}
        Updated {new Date(consultation.updatedAt).toLocaleString()}
      </Text>

      <View className="bg-white rounded-2xl p-4 shadow-sm mb-4 dark:bg-slate-900">
        <Text className="text-base text-slate-900 mb-2 dark:text-slate-100">Remarks</Text>
        <Text className="text-sm text-slate-700 leading-5 dark:text-slate-200">
          {consultation.remarks || "No remarks."}
        </Text>
      </View>

      <Text className="text-base font-semibold text-slate-900 mb-2 dark:text-slate-100">
        Photos
      </Text>
      {consultation.photoUris.length === 0 ? (
        <View className="bg-white rounded-xl p-4 shadow-sm dark:bg-slate-900">
          <Text className="text-slate-600 dark:text-slate-300">
            No photos for this consultation.
          </Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
      {/* The photo grid is the scroll container (virtualized — a consultation can hold
          many photos); the title/remarks ride along as its header. */}
      <FlashList
        data={gridSourceUris}
        numColumns={COLUMNS}
        keyExtractor={(item, index) => `${index}-${item}`}
        renderItem={renderPhoto}
        ListHeaderComponent={header}
        contentContainerStyle={{ padding: GRID_PADDING, paddingBottom: 48 }}
      />
    </SafeAreaView>
  );
}
