import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  IMMERSIVE,
  OverlayIconButton,
  OverlayPill,
  type FeatherName,
} from "../../../../../components/ImmersiveControls";
import { PhotoSlide } from "../../../../../components/PhotoSlide";
import {
  CROP_CANVAS_PADDING,
  clamp,
  computeImageFrame,
  cropRectToImagePixels,
  fitCropRect,
  moveCropRect,
  resizeCropRect,
  type CropRect,
  type ResizeCorner,
  type Size,
} from "../../../../../features/photos/cropGeometry";
import { CropOverlay } from "../../../../../features/photos/CropOverlay";
import { CropToolbar } from "../../../../../features/photos/CropToolbar";
import { Filmstrip } from "../../../../../features/photos/Filmstrip";
import { mapWithConcurrency } from "../../../../../services/async";
import { toRenderableImageUriAsync } from "../../../../../services/imageUri";
import {
  getConsultation,
  saveConsultation,
} from "../../../../../services/storage/storage";
import type { Consultation } from "../../../../../types/models";

/** Labelled icon action in the viewer's bottom bar. */
function ActionButton({
  icon,
  label,
  onPress,
  disabled,
  tone = "default",
}: {
  icon: FeatherName;
  label: string;
  onPress: () => void;
  disabled: boolean;
  tone?: "default" | "danger";
}) {
  const color = disabled
    ? IMMERSIVE.iconMuted
    : tone === "danger"
      ? IMMERSIVE.danger
      : IMMERSIVE.icon;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-1 items-center py-1"
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Feather name={icon} size={22} color={color} />
      <Text className="mt-1 text-xs font-medium" style={{ color }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function ConsultationPhotosScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const pagerRef = useRef<FlatList<string>>(null);
  const stripRef = useRef<FlatList<string>>(null);
  const cropStartRectRef = useRef<CropRect | null>(null);
  const cropDragModeRef = useRef<"move" | ResizeCorner | null>(null);
  const cropDragStartRef = useRef<{ x: number; y: number } | null>(null);
  // Distinguishes a page change the user swiped to from one we need to scroll to.
  const scrollSourceRef = useRef<"user" | "code">("code");
  const photoCountRef = useRef(0);

  const { patientId, consultationId, index } = useLocalSearchParams<{
    patientId: string;
    consultationId: string;
    index?: string;
  }>();

  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [displayUris, setDisplayUris] = useState<
    Record<string, string | undefined>
  >({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);

  const [isCropping, setIsCropping] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropAspect, setCropAspect] = useState<number | null>(null);
  const [cropImageSize, setCropImageSize] = useState<Size | null>(null);
  const [cropCanvas, setCropCanvas] = useState<Size | null>(null);
  // Renderable file:// URI the crop was measured against; manipulation must use
  // the same source so pixel coordinates map 1:1 (content:// URIs are unreliable
  // for RNImage.getSize and can decode at a downscaled size on Android).
  const [cropSourceUri, setCropSourceUri] = useState<string | null>(null);

  // Chrome heights are measured rather than hardcoded, so the crop canvas always
  // lands exactly between the two bars whatever they contain.
  const [topBarHeight, setTopBarHeight] = useState(0);
  const [bottomBarHeight, setBottomBarHeight] = useState(0);

  const photoUris = useMemo(
    () => consultation?.photoUris ?? [],
    [consultation?.photoUris],
  );
  const currentPhotoUri = photoUris[activeIndex];

  const showChrome = isCropping || chromeVisible;
  const chromeOpacity = useSharedValue(1);
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chromeOpacity.value }));

  useEffect(() => {
    chromeOpacity.value = withTiming(showChrome ? 1 : 0, { duration: 180 });
  }, [chromeOpacity, showChrome]);

  const cropImageFrame = useMemo(
    () =>
      cropCanvas && cropImageSize
        ? computeImageFrame(cropCanvas, cropImageSize)
        : null,
    [cropCanvas, cropImageSize],
  );

  // Re-seeds the rect when the canvas settles (the crop bar is taller than the
  // viewer bar, so the frame changes once on entry) and when the ratio changes.
  useEffect(() => {
    if (!isCropping || !cropImageFrame) return;
    setCropRect(fitCropRect(cropImageFrame, cropAspect));
  }, [cropAspect, cropImageFrame, isCropping]);

  // Imperative (not useResolvedPhotoUris): crop/rotate rewrite a photo behind the same URI,
  // and this re-resolve picks up the new content fingerprint immediately after an edit.
  const resolveDisplayUris = useCallback(async (uris: string[]) => {
    const entries = await mapWithConcurrency(uris, 4, async (uri) => {
      try {
        return [uri, await toRenderableImageUriAsync(uri)] as const;
      } catch {
        return [uri, undefined] as const;
      }
    });

    setDisplayUris(Object.fromEntries(entries));
  }, []);

  const load = useCallback(async () => {
    if (!patientId || !consultationId) return;

    setLoading(true);
    const data = await getConsultation(patientId, consultationId);
    setConsultation(data);

    if (!data || data.photoUris.length === 0) {
      setDisplayUris({});
      setLoading(false);
      return;
    }

    await resolveDisplayUris(data.photoUris);

    const parsedIndex = Number(index ?? "0");
    setActiveIndex(
      Number.isFinite(parsedIndex)
        ? clamp(Math.floor(parsedIndex), 0, data.photoUris.length - 1)
        : 0,
    );

    setLoading(false);
  }, [consultationId, index, patientId, resolveDisplayUris]);

  useEffect(() => {
    void load();
  }, [load]);

  // The scroll below lands a frame later, by which time a delete may have shrunk
  // the list again. Both lists read the live count instead of trusting the index.
  useEffect(() => {
    photoCountRef.current = photoUris.length;
  }, [photoUris.length]);

  const scrollToIndex = useCallback((next: number) => {
    scrollSourceRef.current = "code";
    requestAnimationFrame(() => {
      if (next >= photoCountRef.current) return;
      pagerRef.current?.scrollToIndex({ index: next, animated: false });
    });
  }, []);

  // Keep the filmstrip's active thumbnail in view, and re-sync the pager when the
  // index moved for a reason other than the user swiping (delete, filmstrip tap).
  useEffect(() => {
    if (!photoUris.length || isCropping) return;

    // A shrinking list can leave `activeIndex` past the end for one render.
    // Correct it and let the next pass do the scrolling.
    const safeIndex = clamp(activeIndex, 0, photoUris.length - 1);
    if (safeIndex !== activeIndex) {
      setActiveIndex(safeIndex);
      return;
    }

    stripRef.current?.scrollToIndex({
      index: safeIndex,
      animated: true,
      viewPosition: 0.5,
    });

    if (scrollSourceRef.current === "user") {
      scrollSourceRef.current = "code";
      return;
    }

    scrollToIndex(safeIndex);
  }, [activeIndex, isCropping, photoUris.length, scrollToIndex]);

  const onMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!photoUris.length) return;
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    scrollSourceRef.current = "user";
    setActiveIndex(clamp(next, 0, photoUris.length - 1));
  };

  const updateConsultationPhotos = useCallback(
    async (nextPhotoUris: string[], preferredIndex: number) => {
      if (!consultation || !patientId) return;

      setMutating(true);
      try {
        const updated = await saveConsultation(patientId, consultation.id, {
          remarks: consultation.remarks,
          photoUris: nextPhotoUris,
        });

        if (updated.photoUris.length === 0) {
          router.back();
          return;
        }

        // Both setters must land in the same commit. If the list shrinks before
        // the index follows, the sync effect below sees an index past the end.
        setActiveIndex(clamp(preferredIndex, 0, updated.photoUris.length - 1));
        setConsultation(updated);

        await resolveDisplayUris(updated.photoUris);
      } catch {
        Alert.alert("Update failed", "Could not update the photo.");
      } finally {
        setMutating(false);
      }
    },
    [consultation, patientId, resolveDisplayUris, router],
  );

  const discardCropMode = useCallback(() => {
    setIsCropping(false);
    setCropRect(null);
    setCropAspect(null);
    setCropImageSize(null);
    setCropCanvas(null);
    setCropSourceUri(null);
  }, []);

  const beginCropMode = useCallback(async () => {
    if (!currentPhotoUri) return;

    try {
      const renderableUri =
        displayUris[currentPhotoUri] ??
        (await toRenderableImageUriAsync(currentPhotoUri)) ??
        currentPhotoUri;

      // Normalize EXIF orientation up front by running a no-op ImageManipulator pass.
      // Freshly captured photos carry an EXIF orientation flag: expo-image and
      // ImageManipulator apply it (showing the oriented image), but RNImage.getSize
      // reports the raw un-oriented pixel dimensions. That mismatch made the very
      // first crop map to the wrong region. The normalized output has identity
      // orientation, and its reported width/height are the authoritative oriented
      // pixel dimensions — so measuring and cropping against it always agree.
      const normalized = await ImageManipulator.manipulateAsync(
        renderableUri,
        [],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
      );

      setCropImageSize({ width: normalized.width, height: normalized.height });
      setCropSourceUri(normalized.uri);
      setCropAspect(null);
      setIsCropping(true);
    } catch {
      Alert.alert("Crop unavailable", "Could not load this image for cropping.");
    }
  }, [currentPhotoUri, displayUris]);

  const onCropCanvasLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
    setCropCanvas((prev) =>
      prev?.width === nextWidth && prev?.height === nextHeight
        ? prev
        : { width: nextWidth, height: nextHeight },
    );
  }, []);

  const startCropDrag = useCallback(
    (mode: "move" | ResizeCorner, event: GestureResponderEvent) => {
      if (!cropRect) return;
      cropDragModeRef.current = mode;
      cropStartRectRef.current = { ...cropRect };
      cropDragStartRef.current = {
        x: event.nativeEvent.pageX,
        y: event.nativeEvent.pageY,
      };
    },
    [cropRect],
  );

  const onCropDragMove = useCallback(
    (event: GestureResponderEvent) => {
      const mode = cropDragModeRef.current;
      const startPoint = cropDragStartRef.current;
      const start = cropStartRectRef.current;
      if (!mode || !startPoint || !start || !cropImageFrame) return;

      const dx = event.nativeEvent.pageX - startPoint.x;
      const dy = event.nativeEvent.pageY - startPoint.y;

      setCropRect(
        mode === "move"
          ? moveCropRect(start, cropImageFrame, dx, dy)
          : resizeCropRect(start, cropImageFrame, cropAspect, mode, dx, dy),
      );
    },
    [cropAspect, cropImageFrame],
  );

  const endCropDrag = useCallback(() => {
    cropDragModeRef.current = null;
    cropDragStartRef.current = null;
  }, []);

  const saveCrop = useCallback(async () => {
    if (
      !consultation ||
      !currentPhotoUri ||
      !cropRect ||
      !cropImageFrame ||
      !cropImageSize ||
      !cropSourceUri
    ) {
      return;
    }

    setMutating(true);
    try {
      const pixels = cropRectToImagePixels(cropRect, cropImageFrame, cropImageSize);

      const result = await ImageManipulator.manipulateAsync(
        cropSourceUri,
        [{ crop: pixels }],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
      );

      const next = consultation.photoUris.map((uri, idx) =>
        idx === activeIndex ? result.uri : uri,
      );

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await updateConsultationPhotos(next, activeIndex);
      discardCropMode();
    } catch {
      Alert.alert("Crop failed", "We could not crop this photo.");
      setMutating(false);
    }
  }, [
    activeIndex,
    consultation,
    cropImageFrame,
    cropImageSize,
    cropRect,
    cropSourceUri,
    currentPhotoUri,
    discardCropMode,
    updateConsultationPhotos,
  ]);

  const handleRotate = async () => {
    if (isCropping || !consultation || !currentPhotoUri) return;

    setMutating(true);
    try {
      // Rotate the renderable copy: ImageManipulator can't read the persisted
      // SAF content:// URI on Android.
      const sourceUri =
        displayUris[currentPhotoUri] ??
        (await toRenderableImageUriAsync(currentPhotoUri)) ??
        currentPhotoUri;

      const result = await ImageManipulator.manipulateAsync(
        sourceUri,
        [{ rotate: -90 }],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
      );

      const next = consultation.photoUris.map((uri, idx) =>
        idx === activeIndex ? result.uri : uri,
      );
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await updateConsultationPhotos(next, activeIndex);
    } catch {
      Alert.alert("Rotate failed", "We could not rotate this photo.");
      setMutating(false);
    }
  };

  const handleDelete = () => {
    if (isCropping || !consultation || !currentPhotoUri) return;

    Alert.alert(
      "Delete photo",
      "This will remove the photo from the consultation.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Warning,
            );
            const next = consultation.photoUris.filter(
              (uri) => uri !== currentPhotoUri,
            );
            void updateConsultationPhotos(
              next,
              Math.min(activeIndex, Math.max(0, next.length - 1)),
            );
          },
        },
      ],
    );
  };

  const screenOptions = (
    <Stack.Screen
      options={{ headerShown: false, gestureEnabled: false, animation: "fade" }}
    />
  );

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-black">
        {screenOptions}
        <ActivityIndicator size="large" color={IMMERSIVE.icon} />
      </View>
    );
  }

  if (photoUris.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-8 bg-black">
        {screenOptions}
        <View
          className="h-16 w-16 items-center justify-center rounded-full"
          style={{ backgroundColor: IMMERSIVE.control }}
        >
          <Feather name="image" size={26} color={IMMERSIVE.icon} />
        </View>
        <Text className="mt-5 text-lg font-semibold text-slate-100">
          No photos
        </Text>
        <Text className="mt-2 text-center text-sm" style={{ color: IMMERSIVE.label }}>
          This consultation has no photos to show.
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          className="mt-6 rounded-xl px-6 py-3"
          style={{ backgroundColor: IMMERSIVE.active }}
        >
          <Text
            className="text-base font-semibold"
            style={{ color: IMMERSIVE.onActive }}
          >
            Back
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      {screenOptions}

      {isCropping ? (
        <CropOverlay
          displayUri={
            currentPhotoUri
              ? (displayUris[currentPhotoUri] ?? currentPhotoUri)
              : ""
          }
          cropRect={cropRect}
          top={topBarHeight + CROP_CANVAS_PADDING}
          bottom={bottomBarHeight + CROP_CANVAS_PADDING}
          padding={CROP_CANVAS_PADDING}
          onLayout={onCropCanvasLayout}
          onDragStart={startCropDrag}
          onDragMove={onCropDragMove}
          onDragEnd={endCropDrag}
        />
      ) : (
        <FlatList
          ref={pagerRef}
          style={StyleSheet.absoluteFill}
          data={photoUris}
          horizontal
          pagingEnabled
          scrollEnabled={!mutating}
          keyExtractor={(item) => item}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumEnd}
          onScrollToIndexFailed={(info) => {
            // Defensive fallback for rapid list mutations (e.g., delete while paging).
            const safeIndex = Math.max(
              0,
              Math.min(info.index, info.highestMeasuredFrameIndex),
            );
            requestAnimationFrame(() => {
              pagerRef.current?.scrollToIndex({
                index: safeIndex,
                animated: false,
              });
            });
          }}
          getItemLayout={(_, listIndex) => ({
            length: width,
            offset: width * listIndex,
            index: listIndex,
          })}
          renderItem={({ item, index: itemIndex }) => (
            <PhotoSlide
              sourceUri={displayUris[item] ?? item}
              width={width}
              height={height}
              isActive={itemIndex === activeIndex}
              onTap={() => setChromeVisible((prev) => !prev)}
            />
          )}
        />
      )}

      {/* Top chrome */}
      <Animated.View
        pointerEvents={showChrome ? "box-none" : "none"}
        onLayout={(event) => setTopBarHeight(event.nativeEvent.layout.height)}
        className="absolute left-0 right-0 top-0 flex-row items-center px-4"
        style={[{ paddingTop: insets.top + 8, paddingBottom: 8 }, chromeStyle]}
      >
        <OverlayIconButton
          icon={isCropping ? "x" : "arrow-left"}
          accessibilityLabel={isCropping ? "Discard crop" : "Back"}
          onPress={() => (isCropping ? discardCropMode() : router.back())}
        />

        <View className="flex-1 items-center">
          <OverlayPill>
            <Text className="text-xs font-semibold" style={{ color: IMMERSIVE.icon }}>
              {isCropping
                ? "Crop"
                : `${activeIndex + 1} of ${photoUris.length}`}
            </Text>
          </OverlayPill>
        </View>

        {/* Balances the back button so the pill stays centred. */}
        <View style={{ width: 44 }} />
      </Animated.View>

      {/* Bottom chrome */}
      <Animated.View
        pointerEvents={showChrome ? "box-none" : "none"}
        onLayout={(event) => setBottomBarHeight(event.nativeEvent.layout.height)}
        className="absolute bottom-0 left-0 right-0"
        style={chromeStyle}
      >
        <View
          className="mx-3 overflow-hidden rounded-3xl"
          style={{
            marginBottom: insets.bottom + 8,
            backgroundColor: IMMERSIVE.scrim,
          }}
        >
          {isCropping ? (
            <CropToolbar
              aspect={cropAspect}
              onAspectChange={setCropAspect}
              onReset={() => {
                if (!cropImageFrame) return;
                setCropRect(fitCropRect(cropImageFrame, cropAspect));
              }}
              resetDisabled={!cropImageFrame}
              onDiscard={discardCropMode}
              onSave={() => void saveCrop()}
              saveDisabled={!cropRect}
              disabled={mutating}
            />
          ) : (
            <>
              {photoUris.length > 1 ? (
                <Filmstrip
                  listRef={stripRef}
                  photoUris={photoUris}
                  displayUris={displayUris}
                  activeIndex={activeIndex}
                  onSelect={setActiveIndex}
                  disabled={mutating}
                />
              ) : null}

              <View className="flex-row items-center px-2 pb-3 pt-3">
                <ActionButton
                  icon="crop"
                  label="Crop"
                  disabled={mutating}
                  onPress={() => void beginCropMode()}
                />
                <ActionButton
                  icon="rotate-ccw"
                  label="Rotate"
                  disabled={mutating}
                  onPress={() => void handleRotate()}
                />
                <ActionButton
                  icon="trash-2"
                  label="Delete"
                  tone="danger"
                  disabled={mutating}
                  onPress={handleDelete}
                />
              </View>
            </>
          )}
        </View>
      </Animated.View>

      {mutating ? (
        <View
          pointerEvents="auto"
          className="absolute inset-0 items-center justify-center"
          style={{ backgroundColor: "rgba(2,6,23,0.6)" }}
        >
          <ActivityIndicator size="large" color={IMMERSIVE.icon} />
          <Text className="mt-3 text-sm font-medium text-slate-100">
            Saving…
          </Text>
        </View>
      ) : null}
    </View>
  );
}
