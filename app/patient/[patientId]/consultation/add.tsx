import { Feather } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { toRenderableImageUriAsync } from "../../../../services/imageUri";
import { consultationIndexService } from "../../../../services/indexing/consultationIndexService";
import {
  getConsultation,
  saveConsultation,
} from "../../../../services/storage";

export default function AddConsultationScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView | null>(null);
  const { patientId, consultationId } = useLocalSearchParams<{
    patientId: string;
    consultationId?: string;
  }>();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [remarks, setRemarks] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoPreviewUris, setPhotoPreviewUris] = useState<
    Record<string, string | undefined>
  >({});
  const [loading, setLoading] = useState(false);
  const [pickingImage, setPickingImage] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [capturingPhoto, setCapturingPhoto] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraReadyAt, setCameraReadyAt] = useState<number | null>(null);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [showFilterPicker, setShowFilterPicker] = useState(false);
  const [selectedFilterUri, setSelectedFilterUri] = useState<string | null>(
    null,
  );
  const [filterOpacity, setFilterOpacity] = useState(0.3);
  const [patientFilterUris, setPatientFilterUris] = useState<string[]>([]);
  const [patientFilterPreviewUris, setPatientFilterPreviewUris] = useState<
    Record<string, string | undefined>
  >({});
  const [loadingPatientFilters, setLoadingPatientFilters] = useState(false);
  const CAMERA_CONTROLS_BOTTOM = 24;
  const FILTER_TRAY_BOTTOM = 112;
  const MIN_CAMERA_READY_DELAY_MS = 350;
  const CAPTURE_RETRY_DELAY_MS = 220;
  const OVERLAY_LAYER_Z_INDEX = 1;
  const CAMERA_CONTROLS_Z_INDEX = 20;
  const FILTER_UI_Z_INDEX = 30;

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

  useEffect(() => {
    // Convert filter-strip source URIs to image-renderable URIs for camera previews.
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        patientFilterUris.map(async (uri) => {
          try {
            const previewUri = await toRenderableImageUriAsync(uri);
            return [uri, previewUri] as const;
          } catch {
            return [uri, undefined] as const;
          }
        }),
      );

      if (cancelled) return;
      setPatientFilterPreviewUris(Object.fromEntries(entries));
    })();

    return () => {
      cancelled = true;
    };
  }, [patientFilterUris]);

  const loadPatientFilterPhotos = useCallback(async () => {
    if (!patientId || loadingPatientFilters) return;

    setLoadingPatientFilters(true);
    try {
      const filterUris = new Set<string>();
      let cursor: { updatedAt: string; id: string } | undefined;

      do {
        const { items, nextCursor } =
          await consultationIndexService.queryConsultationsPageAsync({
            patientId,
            limit: 50,
            cursor,
          });

        const consultations = await Promise.all(
          items.map((item) => getConsultation(patientId, item.id)),
        );

        consultations.forEach((consultation) => {
          consultation?.photoUris.forEach((uri) => filterUris.add(uri));
        });

        cursor = nextCursor;
      } while (cursor);

      setPatientFilterUris(Array.from(filterUris));
    } catch {
      Alert.alert(
        "Filter photos unavailable",
        "Could not load previous consultation photos for filters.",
      );
    } finally {
      setLoadingPatientFilters(false);
    }
  }, [loadingPatientFilters, patientId]);

  const openCameraPreview = async () => {
    if (loading || pickingImage || capturingPhoto) return;

    let granted = cameraPermission?.granted ?? false;
    if (!granted) {
      const permissionResponse = await requestCameraPermission();
      granted = permissionResponse.granted;
    }

    if (!granted) {
      Alert.alert(
        "Permission needed",
        "Please allow camera access to continue.",
      );
      return;
    }

    setShowFilterPicker(false);
    setSelectedFilterUri(null);
    setFilterOpacity(0.3);
    setTorchEnabled(false);
    setCameraReady(false);
    setCameraReadyAt(null);
    setCameraVisible(true);

    if (patientFilterUris.length === 0) {
      void loadPatientFilterPhotos();
    }
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

  const captureCameraPhoto = async () => {
    if (!cameraRef.current || capturingPhoto) return;

    if (!cameraReady) {
      Alert.alert("Camera not ready", "Please wait a moment and try again.");
      return;
    }

    setCapturingPhoto(true);
    try {
      // Give CameraView a brief stabilization window after it reports ready.
      if (cameraReadyAt) {
        const elapsedSinceReady = Date.now() - cameraReadyAt;
        if (elapsedSinceReady < MIN_CAMERA_READY_DELAY_MS) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, MIN_CAMERA_READY_DELAY_MS - elapsedSinceReady),
          );
        }
      }

      // Some Android devices fail with one capture pipeline but succeed with the other.
      // Keep capture in-view by trying both modes before surfacing an error.
      const captureAttempts = [
        { skipProcessing: true as const, quality: 1 as const },
        { skipProcessing: false as const, quality: 0.9 as const },
      ];

      let lastErrorMessage = "unknown";

      for (let i = 0; i < captureAttempts.length; i += 1) {
        if (!cameraRef.current) break;

        try {
          const result = await cameraRef.current.takePictureAsync(
            captureAttempts[i],
          );

          if (result?.uri) {
            setPhotos((prev) => [...prev, result.uri]);
            setCameraVisible(false);
            setShowFilterPicker(false);
            setTorchEnabled(false);
            setCameraReady(false);
            setCameraReadyAt(null);
            return;
          }

          lastErrorMessage = "Empty image result";
        } catch (error) {
          lastErrorMessage =
            error instanceof Error ? error.message : "Unknown capture error";
        }

        if (i < captureAttempts.length - 1) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, CAPTURE_RETRY_DELAY_MS),
          );
        }
      }

      Alert.alert(
        "Capture failed",
        `Could not capture a photo in camera preview. ${lastErrorMessage}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      Alert.alert("Capture failed", `Could not capture a photo. ${message}`);
    } finally {
      setCapturingPhoto(false);
    }
  };

  const closeCameraPreview = () => {
    setCameraVisible(false);
    setShowFilterPicker(false);
    setTorchEnabled(false);
    setCameraReady(false);
    setCameraReadyAt(null);
  };

  const handleCameraMountError = (event: { message: string }) => {
    setCameraReady(false);
    setCameraReadyAt(null);
    Alert.alert(
      "Camera unavailable",
      `Could not start the camera preview. ${event.message}`,
    );
  };

  const handleCameraReady = () => {
    setCameraReady(true);
    setCameraReadyAt(Date.now());
  };

  const isCaptureDisabled = capturingPhoto || !cameraReady;

  const captureButtonOpacity = isCaptureDisabled ? 0.6 : 1;

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
                  pickingImage || loading || capturingPhoto ? "opacity-60" : ""
                }`}
                disabled={pickingImage || loading || capturingPhoto}
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

      <Modal
        visible={cameraVisible}
        animationType="slide"
        onRequestClose={closeCameraPreview}
      >
        <SafeAreaView className="flex-1 bg-black">
          <View className="flex-1">
            {cameraPermission?.granted ? (
              <CameraView
                ref={(ref) => {
                  cameraRef.current = ref;
                }}
                style={{ flex: 1 }}
                facing="back"
                enableTorch={torchEnabled}
                onCameraReady={handleCameraReady}
                onMountError={handleCameraMountError}
              >
                {selectedFilterUri ? (
                  <View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      zIndex: OVERLAY_LAYER_Z_INDEX,
                    }}
                  >
                    <Image
                      source={{
                        uri:
                          patientFilterPreviewUris[selectedFilterUri] ??
                          selectedFilterUri,
                      }}
                      style={{
                        flex: 1,
                        opacity: filterOpacity,
                      }}
                      contentFit="cover"
                    />
                  </View>
                ) : null}

                <Pressable
                  className="absolute top-4 left-4 bg-black/45 rounded-full p-3"
                  style={{ zIndex: CAMERA_CONTROLS_Z_INDEX, elevation: 10 }}
                  onPress={() => setTorchEnabled((prev) => !prev)}
                  accessibilityLabel={
                    torchEnabled ? "Disable flash" : "Enable flash"
                  }
                >
                  <Feather
                    name={torchEnabled ? "zap" : "zap-off"}
                    size={20}
                    color={torchEnabled ? "#facc15" : "#ffffff"}
                  />
                </Pressable>

                <Pressable
                  className="absolute top-4 right-4 bg-black/45 rounded-full p-3"
                  style={{ zIndex: CAMERA_CONTROLS_Z_INDEX, elevation: 10 }}
                  onPress={closeCameraPreview}
                  accessibilityLabel="Close camera"
                >
                  <Feather name="x" size={20} color="#ffffff" />
                </Pressable>

                <Pressable
                  className="absolute left-4 bg-black/45 rounded-full p-3"
                  style={{
                    bottom: CAMERA_CONTROLS_BOTTOM,
                    zIndex: CAMERA_CONTROLS_Z_INDEX,
                    elevation: 10,
                  }}
                  onPress={() => setShowFilterPicker((prev) => !prev)}
                  accessibilityLabel="Toggle filter previews"
                >
                  <Feather
                    name="sliders"
                    size={20}
                    color={showFilterPicker ? "#38bdf8" : "#ffffff"}
                  />
                </Pressable>

                <Pressable
                  className="absolute self-center rounded-full border-4 border-white bg-white/20"
                  style={{
                    bottom: CAMERA_CONTROLS_BOTTOM,
                    width: 72,
                    height: 72,
                    opacity: captureButtonOpacity,
                    zIndex: CAMERA_CONTROLS_Z_INDEX,
                    elevation: 10,
                  }}
                  onPress={captureCameraPhoto}
                  disabled={isCaptureDisabled}
                  accessibilityLabel="Capture photo"
                >
                  {capturingPhoto ? (
                    <View className="flex-1 items-center justify-center">
                      <ActivityIndicator color="#ffffff" />
                    </View>
                  ) : null}
                </Pressable>

                {showFilterPicker ? (
                  <View
                    className="absolute left-0 right-0 pb-4 pt-3 bg-black/65"
                    style={{
                      bottom: FILTER_TRAY_BOTTOM,
                      zIndex: FILTER_UI_Z_INDEX,
                      elevation: 12,
                    }}
                  >
                    <Text className="text-white px-4 text-sm font-semibold mb-2">
                      Consultation filters
                    </Text>
                    {loadingPatientFilters ? (
                      <View className="px-4 py-4">
                        <ActivityIndicator color="#ffffff" />
                      </View>
                    ) : patientFilterUris.length > 0 ? (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ paddingHorizontal: 16 }}
                      >
                        {patientFilterUris.map((uri) => {
                          const isSelected = selectedFilterUri === uri;

                          return (
                            <Pressable
                              key={uri}
                              onPress={() => {
                                setSelectedFilterUri(uri);
                                setFilterOpacity(0.3);
                              }}
                              className={`mr-3 rounded-xl border-2 ${
                                isSelected
                                  ? "border-cyan-400"
                                  : "border-transparent"
                              }`}
                            >
                              <Image
                                source={{
                                  uri: patientFilterPreviewUris[uri] ?? uri,
                                }}
                                className="h-20 w-20 rounded-lg"
                                contentFit="cover"
                              />

                              {isSelected ? (
                                <Pressable
                                  onPress={() => setSelectedFilterUri(null)}
                                  className="absolute -top-2 -right-2 bg-white rounded-full p-1"
                                  accessibilityLabel="Remove filter"
                                >
                                  <Feather name="x" size={12} color="#0f172a" />
                                </Pressable>
                              ) : null}
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    ) : (
                      <Text className="text-slate-300 text-sm px-4 py-3">
                        No consultation photos available for this patient.
                      </Text>
                    )}

                    {selectedFilterUri ? (
                      <View className="px-4 mt-3">
                        <Text className="text-slate-200 text-xs mb-1">
                          Filter transparency ({Math.round(filterOpacity * 100)}
                          %)
                        </Text>
                        <Slider
                          minimumValue={0}
                          maximumValue={1}
                          value={filterOpacity}
                          step={0.01}
                          onValueChange={setFilterOpacity}
                          minimumTrackTintColor="#38bdf8"
                          maximumTrackTintColor="#94a3b8"
                          thumbTintColor="#e2e8f0"
                        />
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {!showFilterPicker && selectedFilterUri ? (
                  <View
                    className="absolute left-4 right-4 rounded-xl bg-black/60 p-3"
                    style={{
                      bottom: 108,
                      zIndex: FILTER_UI_Z_INDEX,
                      elevation: 12,
                    }}
                  >
                    <Text className="text-slate-200 text-xs mb-1">
                      Filter transparency ({Math.round(filterOpacity * 100)}%)
                    </Text>
                    <Slider
                      minimumValue={0}
                      maximumValue={1}
                      value={filterOpacity}
                      step={0.01}
                      onValueChange={setFilterOpacity}
                      minimumTrackTintColor="#38bdf8"
                      maximumTrackTintColor="#94a3b8"
                      thumbTintColor="#e2e8f0"
                    />
                  </View>
                ) : null}
              </CameraView>
            ) : (
              <View className="flex-1 items-center justify-center px-6">
                <Text className="text-white text-center text-base">
                  Camera permission is required to take photos.
                </Text>
              </View>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
