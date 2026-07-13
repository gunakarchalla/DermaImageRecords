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

import {
  DictationButton,
  DictationStatus,
} from "../../../../components/DictationButton";
import { IdFieldWithGenerate } from "../../../../components/ui/IdFieldWithGenerate";
import { CONSULTATION } from "../../../../constants/consultation";
import { useDictation } from "../../../../hooks/useDictation";
import { useResolvedPhotoUris } from "../../../../hooks/useResolvedImageUri";
import { useThemeColors } from "../../../../hooks/useThemeColors";
import {
  canonicalizeCid,
  CidTakenError,
  generateCidAsync,
  validateCid,
} from "../../../../services/consultation/cid";
import { consumeConsultationCaptureQueue } from "../../../../services/consultationCaptureHandoff";
import { appendTranscript } from "../../../../services/dictation/correctTranscript";
import {
  getConsultation,
  saveConsultation,
} from "../../../../services/storage";

export default function AddConsultationScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { patientId, consultationId } = useLocalSearchParams<{
    patientId: string;
    consultationId?: string;
  }>();

  const [remarks, setRemarks] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  // Render-safe previews for SAF/content:// URIs; `photos` stays the persisted source-of-truth.
  const photoPreviewUris = useResolvedPhotoUris(photos);
  const [loading, setLoading] = useState(false);
  const [pickingImage, setPickingImage] = useState(false);

  // The CID is chosen (or generated) only when creating; it is immutable afterwards.
  const isEditing = Boolean(consultationId);
  const [cid, setCid] = useState("");
  const [cidError, setCidError] = useState<string | null>(null);
  const [generatingCid, setGeneratingCid] = useState(false);

  const handleGenerateCid = async () => {
    if (!patientId) return;
    setGeneratingCid(true);
    try {
      setCid(await generateCidAsync(patientId));
      setCidError(null);
    } catch (error) {
      Alert.alert("Couldn't generate an ID", (error as Error).message);
    } finally {
      setGeneratingCid(false);
    }
  };

  // Dictated speech is appended, never substituted, so it composes with whatever
  // the clinician has already typed.
  const dictation = useDictation({
    onSegment: useCallback((segment: string) => {
      setRemarks((previous) => appendTranscript(previous, segment));
    }, []),
  });

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

    // Anything still being spoken has not landed in `remarks` yet.
    if (dictation.isListening) dictation.stop();

    if (!remarks.trim() && photos.length === 0) {
      Alert.alert("Add details", "Please add remarks or a photo.");
      return;
    }

    // An empty CID means "number automatically"; a typed one is validated inline.
    const canonicalCid = canonicalizeCid(cid);
    if (!isEditing && canonicalCid) {
      const problem = validateCid(canonicalCid);
      if (problem) {
        setCidError(problem);
        return;
      }
    }

    setLoading(true);
    try {
      await saveConsultation(patientId, consultationId ?? null, {
        remarks,
        photoUris: photos,
        cid: !isEditing && canonicalCid ? canonicalCid : undefined,
      });
      router.back();
    } catch (error) {
      if (error instanceof CidTakenError) {
        setCidError(error.message);
        return;
      }
      Alert.alert("Save failed", "Could not save consultation.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      >
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {consultationId ? "Edit" : "Add"} Consultation
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="p-2"
            accessibilityLabel="Cancel"
          >
            <Feather name="x" size={24} color={colors.iconStrong} />
          </Pressable>
        </View>

        {isEditing ? (
          <View className="mb-4">
            <Text className="text-sm text-slate-600 mb-1 dark:text-slate-400">
              Consultation ID
            </Text>
            <View className="flex-row items-center justify-between bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 dark:bg-slate-800 dark:border-slate-700">
              <Text className="text-slate-500 dark:text-slate-400">{consultationId}</Text>
              <Feather name="lock" size={14} color={colors.iconMuted} />
            </View>
            <Text className="text-xs text-slate-400 mt-1 dark:text-slate-500">
              A consultation ID can&apos;t be changed once it is created.
            </Text>
          </View>
        ) : (
          <IdFieldWithGenerate
            label="Consultation ID"
            value={cid}
            onChangeText={(text) => {
              setCid(text);
              if (cidError) setCidError(null);
            }}
            error={cidError}
            onGenerate={() => void handleGenerateCid()}
            generating={generatingCid}
            maxLength={CONSULTATION.maxLength}
            placeholder="Optional — numbered automatically"
            helper="Leave empty to number this visit automatically (001, 002, …)."
            generateAccessibilityLabel="Generate a consultation ID"
          />
        )}

        <View className="mb-4">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-sm text-slate-600 dark:text-slate-400">Remarks</Text>
            <DictationButton
              isListening={dictation.isListening}
              onPress={dictation.toggle}
              disabled={loading}
            />
          </View>
          <TextInput
            value={remarks}
            onChangeText={setRemarks}
            placeholder="Enter consultation notes"
            placeholderTextColor={colors.placeholder}
            className="bg-white rounded-xl border border-slate-200 px-3 py-3 text-base text-slate-900 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
            multiline
            numberOfLines={4}
          />
          <DictationStatus
            isListening={dictation.isListening}
            interim={dictation.interim}
            error={dictation.error}
          />
        </View>

        <View className="mb-4">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-sm text-slate-600 dark:text-slate-400">Photos</Text>
            <View className="flex-row">
              <Pressable
                className={`bg-slate-900 px-3 py-2 rounded-lg mr-2 dark:bg-slate-100 ${
                  pickingImage || loading ? "opacity-60" : ""
                }`}
                disabled={pickingImage || loading}
                onPress={addPhotoFromLibrary}
              >
                <Text className="text-white font-semibold dark:text-slate-900">Upload</Text>
              </Pressable>
              <Pressable
                className={`border border-slate-300 px-3 py-2 rounded-lg dark:border-slate-700 ${
                  pickingImage || loading ? "opacity-60" : ""
                }`}
                disabled={pickingImage || loading}
                onPress={openCameraPreview}
              >
                <Text className="text-slate-800 font-semibold dark:text-slate-200">Camera</Text>
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
                  className="absolute -top-2 -right-2 bg-white rounded-full p-1 shadow dark:bg-slate-200"
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
          className={`bg-slate-900 rounded-xl py-3 items-center dark:bg-slate-100 ${loading ? "opacity-70" : ""}`}
        >
          <Text className="text-white text-base font-semibold dark:text-slate-900">Save</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
