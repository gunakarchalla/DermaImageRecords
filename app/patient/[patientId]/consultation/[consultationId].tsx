import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { toRenderableImageUriAsync } from "../../../../lib/imageUri";
import { getConsultation } from "../../../../lib/storage";
import { Consultation } from "../../../../types/models";

export default function ViewConsultationScreen() {
  const router = useRouter();
  const { patientId, consultationId } = useLocalSearchParams<{
    patientId: string;
    consultationId: string;
  }>();

  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [photoDisplayUris, setPhotoDisplayUris] = useState<
    Record<string, string | undefined>
  >({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!patientId || !consultationId) return;
    setLoading(true);
    const data = await getConsultation(patientId, consultationId);
    setConsultation(data);

    // Resolve persisted SAF/content URIs to cache file:// URIs for rendering.
    if (data?.photoUris?.length) {
      const entries = await Promise.all(
        data.photoUris.map(async (uri) => {
          try {
            const displayUri = await toRenderableImageUriAsync(uri);
            return [uri, displayUri] as const;
          } catch {
            return [uri, undefined] as const;
          }
        })
      );
      setPhotoDisplayUris(Object.fromEntries(entries));
    } else {
      setPhotoDisplayUris({});
    }

    setLoading(false);
  }, [patientId, consultationId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  if (!consultation) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-50">
        <Text className="text-base text-slate-700">
          Consultation not found.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      >
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-2xl font-bold text-slate-900">
            Consultation
          </Text>
          <Pressable
            onPress={() =>
              router.push(
                `/patient/${patientId}/consultation/add?consultationId=${consultationId}`
              )
            }
            className="p-2"
            accessibilityLabel="Edit consultation"
          >
            <Feather name="edit-2" size={20} color="#0f172a" />
          </Pressable>
        </View>

        <Text className="text-sm text-slate-500 mb-1">
          Updated {new Date(consultation.updatedAt).toLocaleString()}
        </Text>

        <View className="bg-white rounded-2xl p-4 shadow-sm mb-4">
          <Text className="text-base text-slate-900 mb-2">Remarks</Text>
          <Text className="text-sm text-slate-700 leading-5">
            {consultation.remarks || "No remarks."}
          </Text>
        </View>

        <Text className="text-base font-semibold text-slate-900 mb-2">
          Photos
        </Text>
        {consultation.photoUris.length === 0 ? (
          <View className="bg-white rounded-xl p-4 shadow-sm">
            <Text className="text-slate-600">
              No photos for this consultation.
            </Text>
          </View>
        ) : (
          <View className="flex-row flex-wrap">
            {consultation.photoUris.map((uri) => (
              <Image
                key={uri}
                source={{ uri: photoDisplayUris[uri] ?? uri }}
                className="h-32 w-32 mr-3 mb-3 rounded-xl"
                contentFit="cover"
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
