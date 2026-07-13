import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useDatasetFocusRefresh } from "../../../../hooks/useDatasetFocusRefresh";
import { useResolvedPhotoUris } from "../../../../hooks/useResolvedImageUri";
import { useThemeColors } from "../../../../hooks/useThemeColors";
import { consultationIndexService } from "../../../../services/indexing/consultationIndexService";
import { getConsultation } from "../../../../services/storage/storage";
import { Consultation } from "../../../../types/models";

export default function ViewConsultationScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { patientId, consultationId } = useLocalSearchParams<{
    patientId: string;
    consultationId: string;
  }>();

  const [consultation, setConsultation] = useState<Consultation | null>(null);
  // Derived display ordinal (position over createdAt); the stored consultation has no number.
  const [number, setNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Resolve persisted SAF/content URIs to cache file:// URIs for rendering.
  const photoDisplayUris = useResolvedPhotoUris(consultation?.photoUris ?? []);

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

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      >
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {number ? `Consultation #${number}` : "Consultation"}
          </Text>
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

        <Text className="text-sm text-slate-500 mb-1 dark:text-slate-400">
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
        ) : (
          <View className="flex-row flex-wrap">
            {consultation.photoUris.map((uri, index) => (
              <Pressable
                key={uri}
                onPress={() =>
                  router.push(
                    `/patient/${patientId}/consultation/${consultationId}/photos?index=${index}`,
                  )
                }
                accessibilityLabel="Open photo"
              >
                <Image
                  source={{ uri: photoDisplayUris[uri] ?? uri }}
                  className="h-32 w-32 mr-3 mb-3 rounded-xl"
                  contentFit="cover"
                />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
