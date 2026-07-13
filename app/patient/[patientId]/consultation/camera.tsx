import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  IMMERSIVE,
  OverlayIconButton,
  OverlayPill,
  RuleOfThirdsGrid,
} from "../../../../components/ImmersiveControls";
import { GhostOpacityBar, GhostTray } from "../../../../features/camera/GhostTray";
import { PendingTray } from "../../../../features/camera/PendingTray";
import {
  DEFAULT_PREVIEW_ASPECT,
  pickLargestSensorFormat,
} from "../../../../features/camera/sensorFormat";
import { useGhostPhotos } from "../../../../features/camera/useGhostPhotos";
import { enqueueConsultationCapture } from "../../../../services/consultationCaptureHandoff";
import { safeDeleteFile } from "../../../../services/storage/fsUtils";

const MIN_CAMERA_READY_DELAY_MS = 350;
const CAPTURE_RETRY_DELAY_MS = 220;
const CAPTURE_ATTEMPTS = 2;

const DEFAULT_GHOST_OPACITY = 0.35;
// Pinch travel is damped so a full two-finger spread doesn't slam to max zoom.
const PINCH_ZOOM_SENSITIVITY = 0.4;
// Quantize zoom before it reaches React state; a raw pinch stream would
// re-render the tree on every frame for changes the camera can't resolve.
const ZOOM_STEPS = 50;

export default function ConsultationCameraScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView | null>(null);
  const { patientId, consultationId } = useLocalSearchParams<{
    patientId: string;
    consultationId?: string;
  }>();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [capturing, setCapturing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraReadyAt, setCameraReadyAt] = useState<number | null>(null);
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [zoom, setZoom] = useState(0);

  // Sensor geometry. `sensorResolved` gates capture so we never shoot through a
  // preview whose aspect ratio hasn't been reconciled with the picture size yet.
  const [pictureSize, setPictureSize] = useState<string | undefined>();
  const [previewAspect, setPreviewAspect] = useState(DEFAULT_PREVIEW_ASPECT);
  const [sensorResolved, setSensorResolved] = useState(Platform.OS !== "android");

  // The area between the two chrome bars that the preview is centred inside.
  const [stage, setStage] = useState({ width: 0, height: 0 });

  // Photos captured in this session. They are handed to the add-consultation
  // screen in one batch on exit, so the camera stays open for multi-shot work.
  const [pending, setPending] = useState<string[]>([]);

  const [ghostTrayOpen, setGhostTrayOpen] = useState(false);
  const [ghostUri, setGhostUri] = useState<string | null>(null);
  const [ghostOpacity, setGhostOpacity] = useState(DEFAULT_GHOST_OPACITY);
  const { ghostUris, ghostPreviews, loadingGhosts, ghostsFailed } =
    useGhostPhotos(patientId);

  const shutterScale = useSharedValue(1);
  const flashOpacity = useSharedValue(0);
  const zoomShared = useSharedValue(0);
  const pinchStartZoom = useSharedValue(0);
  const zoomRef = useRef(0);

  const shutterStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shutterScale.value }],
  }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));

  useEffect(() => {
    if (patientId) return;
    Alert.alert("Missing patient", "Could not open the camera without a patient.", [
      { text: "OK", onPress: () => router.back() },
    ]);
  }, [patientId, router]);

  // Ask once on mount; if it's refused the screen falls through to a designed
  // permission state rather than bouncing the user straight back out.
  useEffect(() => {
    if (!cameraPermission || cameraPermission.granted) return;
    if (!cameraPermission.canAskAgain) return;
    void requestCameraPermission();
    // Intentionally runs only when permission is first resolved as "not granted";
    // re-requesting on every render would spam the system dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraPermission?.granted]);

  const resolveSensorFormat = useCallback(async () => {
    try {
      const sizes = (await cameraRef.current?.getAvailablePictureSizesAsync()) ?? [];
      const format = pickLargestSensorFormat(sizes);

      if (format) {
        setPictureSize(format.pictureSize);
        setPreviewAspect(format.previewAspect);
      }
    } catch {
      // Fall back to the 4:3 default; `ratio` still forces the preview to FIT.
    } finally {
      setSensorResolved(true);
    }
  }, []);

  useEffect(() => {
    if (!cameraReady || sensorResolved || Platform.OS !== "android") return;
    void resolveSensorFormat();
  }, [cameraReady, resolveSensorFormat, sensorResolved]);

  const flushAndClose = useCallback(() => {
    if (patientId) {
      pending.forEach((uri) =>
        enqueueConsultationCapture(patientId, uri, consultationId),
      );
    }
    router.back();
  }, [consultationId, patientId, pending, router]);

  const handleClose = useCallback(() => {
    if (pending.length === 0) {
      router.back();
      return;
    }

    Alert.alert(
      "Keep captured photos?",
      `You have ${pending.length} unsaved photo${pending.length === 1 ? "" : "s"}.`,
      [
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            // Captures are cache temps; discarded ones should not wait for the sweep.
            pending.forEach((uri) => void safeDeleteFile(uri));
            router.back();
          },
        },
        { text: "Keep", onPress: flushAndClose },
      ],
    );
  }, [flushAndClose, pending, router]);

  // Swipe-back and the hardware back button would pop the screen without handing
  // the captures over, so both are routed through `handleClose`.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          handleClose();
          return true;
        },
      );
      return () => subscription.remove();
    }, [handleClose]),
  );

  const applyZoom = useCallback((next: number) => {
    const quantized = Math.round(next * ZOOM_STEPS) / ZOOM_STEPS;
    if (quantized === zoomRef.current) return;
    zoomRef.current = quantized;
    setZoom(quantized);
  }, []);

  const resetZoom = useCallback(() => {
    zoomShared.value = 0;
    applyZoom(0);
  }, [applyZoom, zoomShared]);

  const cameraGesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onStart(() => {
        pinchStartZoom.value = zoomShared.value;
      })
      .onUpdate((event) => {
        const next = Math.max(
          0,
          Math.min(
            1,
            pinchStartZoom.value + (event.scale - 1) * PINCH_ZOOM_SENSITIVITY,
          ),
        );
        zoomShared.value = next;
        runOnJS(applyZoom)(next);
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        runOnJS(resetZoom)();
      });

    return Gesture.Simultaneous(pinch, doubleTap);
  }, [applyZoom, pinchStartZoom, resetZoom, zoomShared]);

  const triggerShutterFlash = useCallback(() => {
    flashOpacity.value = 0.9;
    flashOpacity.value = withTiming(0, { duration: 220 });
  }, [flashOpacity]);

  const capturePhoto = async () => {
    if (!cameraRef.current || capturing || !cameraReady || !sensorResolved) return;

    setCapturing(true);
    triggerShutterFlash();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

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

      // Never pass `skipProcessing`. It suppresses the native pass that rotates the
      // photo to the device orientation and scales it to match the preview, which
      // is precisely the reconciliation this screen depends on. The retry below
      // covers the transient failures the old dual-pipeline hack was papering over.
      let lastErrorMessage = "unknown";

      for (let attempt = 0; attempt < CAPTURE_ATTEMPTS; attempt += 1) {
        if (!cameraRef.current) break;

        try {
          const result = await cameraRef.current.takePictureAsync({ quality: 1 });

          if (result?.uri) {
            const uri = result.uri;
            setPending((prev) => [...prev, uri]);
            return;
          }

          lastErrorMessage = "Empty image result";
        } catch (error) {
          lastErrorMessage =
            error instanceof Error ? error.message : "Unknown capture error";
        }

        if (attempt < CAPTURE_ATTEMPTS - 1) {
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
      setCapturing(false);
    }
  };

  const handleCameraReady = () => {
    setCameraReady(true);
    setCameraReadyAt(Date.now());
  };

  const handleCameraMountError = (event: { message: string }) => {
    setCameraReady(false);
    setCameraReadyAt(null);
    Alert.alert(
      "Camera unavailable",
      `Could not start the camera preview. ${event.message}`,
    );
  };

  const toggleFacing = () => {
    setFacing((prev) => (prev === "back" ? "front" : "back"));
    setTorchEnabled(false);
    resetZoom();

    // The front sensor has its own picture sizes, so re-derive the geometry.
    setCameraReady(false);
    setCameraReadyAt(null);
    setPictureSize(undefined);
    setSensorResolved(Platform.OS !== "android");
  };

  const removePending = (uri: string) => {
    setPending((prev) => prev.filter((item) => item !== uri));
    void safeDeleteFile(uri);
  };

  const onStageLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setStage((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  // Largest box with the sensor's aspect ratio that fits the stage. Deriving both
  // dimensions here (rather than `aspectRatio` + `width: "100%"`) means the tray
  // can grow without ever overflowing or squashing the frame.
  const previewWidth = Math.min(stage.width, stage.height * previewAspect);
  const previewHeight = previewWidth / previewAspect;
  const stageMeasured = previewWidth > 0 && previewHeight > 0;

  const screenOptions = (
    <Stack.Screen
      options={{ headerShown: false, gestureEnabled: false, animation: "fade" }}
    />
  );

  if (!cameraPermission) {
    return (
      <View className="flex-1 items-center justify-center bg-black">
        {screenOptions}
        <ActivityIndicator size="large" color={IMMERSIVE.icon} />
      </View>
    );
  }

  if (!cameraPermission.granted) {
    return (
      <View className="flex-1 items-center justify-center px-8 bg-black">
        {screenOptions}
        <View
          className="h-16 w-16 items-center justify-center rounded-full"
          style={{ backgroundColor: IMMERSIVE.control }}
        >
          <Feather name="camera-off" size={26} color={IMMERSIVE.icon} />
        </View>
        <Text className="mt-5 text-lg font-semibold text-slate-100">
          Camera access needed
        </Text>
        <Text
          className="mt-2 text-center text-sm leading-5"
          style={{ color: IMMERSIVE.label }}
        >
          Allow camera access to photograph this consultation. Photos stay on
          this device.
        </Text>

        <Pressable
          onPress={() => void requestCameraPermission()}
          disabled={!cameraPermission.canAskAgain}
          accessibilityLabel="Allow camera access"
          className="mt-6 w-full items-center rounded-xl py-3"
          style={{
            backgroundColor: IMMERSIVE.active,
            opacity: cameraPermission.canAskAgain ? 1 : 0.45,
          }}
        >
          <Text
            className="text-base font-semibold"
            style={{ color: IMMERSIVE.onActive }}
          >
            Allow camera
          </Text>
        </Pressable>

        {!cameraPermission.canAskAgain ? (
          <Text
            className="mt-3 text-center text-xs"
            style={{ color: IMMERSIVE.iconMuted }}
          >
            Camera access was denied. Enable it in system settings.
          </Text>
        ) : null}

        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          className="mt-3 w-full items-center rounded-xl py-3"
          style={{ borderWidth: 1, borderColor: IMMERSIVE.controlBorder }}
        >
          <Text className="text-base font-semibold text-slate-200">
            Go back
          </Text>
        </Pressable>
      </View>
    );
  }

  const ghostPreviewUri = ghostUri
    ? (ghostPreviews[ghostUri] ?? ghostUri)
    : null;
  const captureDisabled = capturing || !cameraReady || !sensorResolved;

  return (
    <View className="flex-1 bg-black">
      {screenOptions}

      {/* Top bar. Solid, so it never covers a pixel of the frame. */}
      <View
        className="flex-row items-center justify-between px-4 pb-3"
        style={{ paddingTop: insets.top + 8 }}
      >
        <OverlayIconButton
          icon="x"
          accessibilityLabel="Close camera"
          onPress={handleClose}
        />

        <View className="flex-row items-center" style={{ gap: 10 }}>
          {facing === "back" ? (
            <OverlayIconButton
              icon={torchEnabled ? "zap" : "zap-off"}
              accessibilityLabel={torchEnabled ? "Turn off light" : "Turn on light"}
              active={torchEnabled}
              onPress={() => setTorchEnabled((prev) => !prev)}
            />
          ) : null}

          <OverlayIconButton
            icon="grid"
            accessibilityLabel="Toggle framing grid"
            active={showGrid}
            onPress={() => setShowGrid((prev) => !prev)}
          />

          <OverlayIconButton
            icon="layers"
            accessibilityLabel="Align to a previous photo"
            active={ghostTrayOpen || Boolean(ghostUri)}
            onPress={() => setGhostTrayOpen((prev) => !prev)}
          />
        </View>
      </View>

      {/* Stage: the preview is centred here at the sensor's own aspect ratio.
          Everything drawn over the feed is a child of the preview box, so the
          grid and the ghost map onto the frame that actually gets saved. */}
      <View className="flex-1 items-center justify-center" onLayout={onStageLayout}>
        {stageMeasured ? (
          <GestureDetector gesture={cameraGesture}>
            <View
              className="overflow-hidden"
              style={{ width: previewWidth, height: previewHeight }}
            >
              <CameraView
                ref={(ref) => {
                  cameraRef.current = ref;
                }}
                style={StyleSheet.absoluteFill}
                facing={facing}
                zoom={zoom}
                enableTorch={torchEnabled}
                animateShutter={false}
                pictureSize={pictureSize}
                // Android-only, and ignored once `pictureSize` lands. It is the
                // fallback that forces the preview to FIT if the size query fails.
                ratio="4:3"
                onCameraReady={handleCameraReady}
                onMountError={handleCameraMountError}
              />

              {ghostPreviewUri ? (
                <Image
                  pointerEvents="none"
                  source={{ uri: ghostPreviewUri }}
                  style={[StyleSheet.absoluteFill, { opacity: ghostOpacity }]}
                  // `contain`, not `cover`: a ghost that was cropped to a different
                  // shape must letterbox rather than silently crop, or it would
                  // misrepresent the framing it is there to help reproduce.
                  contentFit="contain"
                />
              ) : null}

              {showGrid ? <RuleOfThirdsGrid /> : null}

              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: "#ffffff" },
                  flashStyle,
                ]}
              />

              {captureDisabled && !capturing ? (
                <View
                  pointerEvents="none"
                  className="absolute inset-0 items-center justify-center"
                >
                  <OverlayPill>
                    <Text
                      className="text-xs font-medium"
                      style={{ color: IMMERSIVE.icon }}
                    >
                      Starting camera…
                    </Text>
                  </OverlayPill>
                </View>
              ) : null}
            </View>
          </GestureDetector>
        ) : null}
      </View>

      {/* Bottom bar */}
      <View>
        {zoom > 0 ? (
          <View className="items-center pb-3">
            <Pressable onPress={resetZoom} accessibilityLabel="Reset zoom" hitSlop={8}>
              <OverlayPill>
                <Text
                  className="text-xs font-semibold"
                  style={{ color: IMMERSIVE.icon }}
                >
                  Zoom {Math.round(zoom * 100)}%
                </Text>
              </OverlayPill>
            </Pressable>
          </View>
        ) : null}

        {ghostTrayOpen ? (
          <GhostTray
            ghostUris={ghostUris}
            ghostPreviews={ghostPreviews}
            loading={loadingGhosts}
            failed={ghostsFailed}
            selectedUri={ghostUri}
            opacity={ghostOpacity}
            onSelect={(uri) => {
              setGhostUri(uri);
              if (uri) setGhostOpacity(DEFAULT_GHOST_OPACITY);
            }}
            onOpacityChange={setGhostOpacity}
            onClose={() => setGhostTrayOpen(false)}
          />
        ) : ghostUri ? (
          <GhostOpacityBar value={ghostOpacity} onChange={setGhostOpacity} />
        ) : null}

        {pending.length > 0 ? (
          <PendingTray uris={pending} onRemove={removePending} />
        ) : null}

        <View
          className="flex-row items-center px-4 pt-3"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <View className="flex-1 items-start">
            {pending.length > 0 ? (
              <Pressable
                onPress={flushAndClose}
                accessibilityLabel={`Done, add ${pending.length} photos`}
                className="flex-row items-center rounded-full px-4 py-2.5"
                style={{ backgroundColor: IMMERSIVE.active }}
              >
                <Feather name="check" size={16} color={IMMERSIVE.onActive} />
                <Text
                  className="ml-1.5 text-sm font-semibold"
                  style={{ color: IMMERSIVE.onActive }}
                >
                  Done · {pending.length}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Pressable
            onPress={capturePhoto}
            onPressIn={() => {
              shutterScale.value = withSpring(0.9, { damping: 14 });
            }}
            onPressOut={() => {
              shutterScale.value = withSpring(1, { damping: 14 });
            }}
            disabled={captureDisabled}
            accessibilityLabel="Capture photo"
            hitSlop={8}
          >
            <Animated.View
              className="items-center justify-center rounded-full"
              style={[
                {
                  width: 76,
                  height: 76,
                  borderWidth: 3,
                  borderColor: IMMERSIVE.icon,
                  opacity: captureDisabled ? 0.5 : 1,
                },
                shutterStyle,
              ]}
            >
              <View
                className="items-center justify-center rounded-full"
                style={{ width: 60, height: 60, backgroundColor: IMMERSIVE.icon }}
              >
                {capturing ? <ActivityIndicator color={IMMERSIVE.onActive} /> : null}
              </View>
            </Animated.View>
          </Pressable>

          <View className="flex-1 items-end">
            <OverlayIconButton
              icon="refresh-cw"
              accessibilityLabel={
                facing === "back"
                  ? "Switch to front camera"
                  : "Switch to back camera"
              }
              onPress={toggleFacing}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
