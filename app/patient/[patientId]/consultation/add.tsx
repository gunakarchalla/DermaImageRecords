import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getConsultation, saveConsultation } from "../../../../lib/storage";

export default function AddConsultationScreen() {
  const router = useRouter();
  const { patientId, consultationId } = useLocalSearchParams<{
    patientId: string;
    consultationId?: string;
  }>();

  const [remarks, setRemarks] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

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

  const addPhoto = async (fromCamera: boolean) => {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        "Permission needed",
        "Please allow camera/photos access to continue."
      );
      return;
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 1,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 1,
        });

    if (!result.canceled && result.assets?.length) {
      setPhotos((prev) => [...prev, result.assets[0].uri]);
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
    } catch (error) {
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
                className="bg-slate-900 px-3 py-2 rounded-lg mr-2"
                onPress={() => addPhoto(false)}
              >
                <Text className="text-white font-semibold">Upload</Text>
              </Pressable>
              <Pressable
                className="border border-slate-300 px-3 py-2 rounded-lg"
                onPress={() => addPhoto(true)}
              >
                <Text className="text-slate-800 font-semibold">Camera</Text>
              </Pressable>
            </View>
          </View>

          <View className="flex-row flex-wrap">
            {photos.map((uri) => (
              <View key={uri} className="mr-3 mb-3 relative">
                <Image
                  source={{ uri }}
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
