import { Feather } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { enqueueConsultationCapture } from "../../../../services/consultationCaptureHandoff";
import { toRenderableImageUriAsync } from "../../../../services/imageUri";
import { consultationIndexService } from "../../../../services/indexing/consultationIndexService";
import { getConsultation } from "../../../../services/storage";

const CAMERA_CONTROLS_BOTTOM = 24;
const FILTER_TRAY_BOTTOM = 112;
const MIN_CAMERA_READY_DELAY_MS = 350;
const CAPTURE_RETRY_DELAY_MS = 220;
const OVERLAY_LAYER_Z_INDEX = 1;
const CAMERA_CONTROLS_Z_INDEX = 20;
const FILTER_UI_Z_INDEX = 30;

export default function ConsultationCameraScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView | null>(null);
  const { patientId, consultationId } = useLocalSearchParams<{
    patientId: string;
    consultationId?: string;
  }>();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [capturingPhoto, setCapturingPhoto] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraReadyAt, setCameraReadyAt] = useState<number | null>(null);
  const [cameraFacing, setCameraFacing] = useState<"back" | "front">("back");
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

  useEffect(() => {
    if (!patientId) {
      Alert.alert(
        "Missing patient",
        "Could not open camera without a patient.",
        [{ text: "OK", onPress: () => router.back() }],
      );
      return;
    }

    let cancelled = false;
    void (async () => {
      const granted = cameraPermission?.granted ?? false;
      if (granted || cancelled) return;

      const permissionResponse = await requestCameraPermission();
      if (!permissionResponse.granted && !cancelled) {
        Alert.alert(
          "Permission needed",
          "Please allow camera access to continue.",
          [{ text: "OK", onPress: () => router.back() }],
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cameraPermission?.granted, patientId, requestCameraPermission, router]);

  useEffect(() => {
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

  useEffect(() => {
    if (patientFilterUris.length > 0) return;
    void loadPatientFilterPhotos();
  }, [loadPatientFilterPhotos, patientFilterUris.length]);

  const closeCameraPreview = () => {
    router.back();
  };

  const handleCaptureSuccess = (uri: string) => {
    if (!patientId) return;

    enqueueConsultationCapture(patientId, uri, consultationId);
    router.back();
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
            handleCaptureSuccess(result.uri);
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

  const toggleCameraFacing = () => {
    setCameraFacing((previousFacing) =>
      previousFacing === "back" ? "front" : "back",
    );
    setTorchEnabled(false);
  };

  const isCaptureDisabled = capturingPhoto || !cameraReady;
  const captureButtonOpacity = isCaptureDisabled ? 0.6 : 1;

  if (!cameraPermission?.granted) {
    return (
      <SafeAreaView className="flex-1 bg-black">
        <View className="flex-1 items-center justify-center px-6">
          <ActivityIndicator color="#ffffff" />
          <Text className="text-white text-center text-base mt-4">
            Camera permission is required to take photos.
          </Text>
          <Pressable
            className="mt-5 border border-white/40 rounded-lg px-4 py-2"
            onPress={closeCameraPreview}
            accessibilityLabel="Close camera"
          >
            <Text className="text-white font-semibold">Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-black">
      <View className="flex-1">
        <CameraView
          ref={(ref) => {
            cameraRef.current = ref;
          }}
          style={{ flex: 1 }}
          facing={cameraFacing}
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
            accessibilityLabel={torchEnabled ? "Disable flash" : "Enable flash"}
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

          <Pressable
            className="absolute right-4 bg-black/45 rounded-full p-3"
            style={{
              bottom: CAMERA_CONTROLS_BOTTOM,
              zIndex: CAMERA_CONTROLS_Z_INDEX,
              elevation: 10,
            }}
            onPress={toggleCameraFacing}
            accessibilityLabel={
              cameraFacing === "back"
                ? "Switch to front camera"
                : "Switch to back camera"
            }
          >
            <Feather name="refresh-cw" size={20} color="#ffffff" />
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
                          isSelected ? "border-cyan-400" : "border-transparent"
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
      </View>
    </SafeAreaView>
  );
}
