import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  InteractionManager,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { consumeConsultationCaptureQueue } from "../../../../services/consultationCaptureHandoff";
import { toRenderableImageUriAsync } from "../../../../services/imageUri";
import {
  getConsultation,
  saveConsultation,
} from "../../../../services/storage";

export default function AddConsultationScreen() {
  const router = useRouter();
  const { patientId, consultationId } = useLocalSearchParams<{
    patientId: string;
    consultationId?: string;
  }>();

  const [remarks, setRemarks] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoPreviewUris, setPhotoPreviewUris] = useState<
    Record<string, string | undefined>
  >({});
  const [loading, setLoading] = useState(false);
  const [pickingImage, setPickingImage] = useState(false);

  const loadExisting = useCallback(async () => {
    if (consultationId && patientId) {
      setLoading(true);
      const existing = await getConsultation(patientId, consultationId);
      if (existing) {
        setRemarks(existing.remarks);
        setPhotos(existing.photoUris ?? []);
      }
      setLoading(false);
    }
  }, [consultationId, patientId]);

  useEffect(() => {
    loadExisting();
  }, [loadExisting]);

  useEffect(() => {
    // Convert any non-renderable URIs (e.g., SAF/content://) to cache file:// URIs for previews.
    // Keep `photos` unchanged because it is the persisted source-of-truth.
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        photos.map(async (uri) => {
          try {
            const previewUri = await toRenderableImageUriAsync(uri);
            return [uri, previewUri] as const;
          } catch {
            return [uri, undefined] as const;
          }
        }),
      );
      if (cancelled) return;
      setPhotoPreviewUris(Object.fromEntries(entries));
    })();

    return () => {
      cancelled = true;
    };
  }, [photos]);

  useFocusEffect(
    useCallback(() => {
      if (!patientId) return;

      const capturedPhotoUris = consumeConsultationCaptureQueue(
        patientId,
        consultationId,
      );
      if (capturedPhotoUris.length === 0) return;

      setPhotos((prev) => {
        const next = [...prev];

        capturedPhotoUris.forEach((uri) => {
          if (!next.includes(uri)) next.push(uri);
        });

        return next;
      });
    }, [consultationId, patientId]),
  );

  const openCameraPreview = () => {
    if (loading || pickingImage) return;

    router.push({
      pathname: "/patient/[patientId]/consultation/camera",
      params: {
        patientId,
        consultationId,
      },
    });
  };

  const addPhotoFromLibrary = async () => {
    if (pickingImage || loading) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        "Permission needed",
        "Please allow photos access to continue.",
      );
      return;
    }

    setPickingImage(true);
    try {
      // Wait for navigation interactions to settle before launching the picker.
      // This prevents Android launcher registration race conditions.
      await new Promise<void>((resolve) => {
        InteractionManager.runAfterInteractions(() => resolve());
      });

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
      });

      if (!result.canceled && result.assets?.length) {
        setPhotos((prev) => [...prev, result.assets[0].uri]);
      }
    } catch {
      Alert.alert(
        "Photo picker unavailable",
        "Please try again. If the issue persists, reopen this screen and retry.",
      );
    } finally {
      setPickingImage(false);
    }
  };

  const handleSave = async () => {
    if (!patientId) return;

    if (!remarks.trim() && photos.length === 0) {
      Alert.alert("Add details", "Please add remarks or a photo.");
      return;
    }

    setLoading(true);
    try {
      await saveConsultation(patientId, consultationId ?? null, {
        remarks,
        photoUris: photos,
      });
      router.back();
    } catch {
      Alert.alert("Save failed", "Could not save consultation.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      >
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-2xl font-bold text-slate-900">
            {consultationId ? "Edit" : "Add"} Consultation
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="p-2"
            accessibilityLabel="Cancel"
          >
            <Feather name="x" size={24} color="#0f172a" />
          </Pressable>
        </View>

        <View className="mb-4">
          <Text className="text-sm text-slate-600 mb-2">Remarks</Text>
          <TextInput
            value={remarks}
            onChangeText={setRemarks}
            placeholder="Enter consultation notes"
            placeholderTextColor="#94a3b8"
            className="bg-white rounded-xl border border-slate-200 px-3 py-3 text-base"
            multiline
            numberOfLines={4}
          />
        </View>

        <View className="mb-4">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-sm text-slate-600">Photos</Text>
            <View className="flex-row">
              <Pressable
                className={`bg-slate-900 px-3 py-2 rounded-lg mr-2 ${
                  pickingImage || loading ? "opacity-60" : ""
                }`}
                disabled={pickingImage || loading}
                onPress={addPhotoFromLibrary}
              >
                <Text className="text-white font-semibold">Upload</Text>
              </Pressable>
              <Pressable
                className={`border border-slate-300 px-3 py-2 rounded-lg ${
                  pickingImage || loading ? "opacity-60" : ""
                }`}
                disabled={pickingImage || loading}
                onPress={openCameraPreview}
              >
                <Text className="text-slate-800 font-semibold">Camera</Text>
              </Pressable>
            </View>
          </View>

          <View className="flex-row flex-wrap">
            {photos.map((uri) => (
              <View key={uri} className="mr-3 mb-3 relative">
                <Image
                  source={{ uri: photoPreviewUris[uri] ?? uri }}
                  className="h-24 w-24 rounded-lg"
                  contentFit="cover"
                />
                <Pressable
                  onPress={() =>
                    setPhotos((prev) => prev.filter((p) => p !== uri))
                  }
                  className="absolute -top-2 -right-2 bg-white rounded-full p-1 shadow"
                  accessibilityLabel="Remove photo"
                >
                  <Feather name="x" size={14} color="#0f172a" />
                </Pressable>
              </View>
            ))}
          </View>
        </View>

        <Pressable
          disabled={loading}
          onPress={handleSave}
          className={`bg-slate-900 rounded-xl py-3 items-center ${loading ? "opacity-70" : ""}`}
        >
          <Text className="text-white text-base font-semibold">Save</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
