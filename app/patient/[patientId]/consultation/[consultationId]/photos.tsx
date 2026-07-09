import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  GestureResponderEvent,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

import { PhotoSlide } from "../../../../../components/PhotoSlide";
import { toRenderableImageUriAsync } from "../../../../../services/imageUri";
import {
  getConsultation,
  saveConsultation,
} from "../../../../../services/storage/storage";
import type { Consultation } from "../../../../../types/models";

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ResizeCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

export default function ConsultationPhotosScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const listRef = useRef<FlatList<string>>(null);
  const cropStartRectRef = useRef<CropRect | null>(null);
  const cropDragModeRef = useRef<"move" | ResizeCorner | null>(null);
  const cropDragStartRef = useRef<{ x: number; y: number } | null>(null);

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
  const [isCropping, setIsCropping] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropImageSize, setCropImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  // Renderable file:// URI the crop was measured against; manipulation must use
  // the same source so pixel coordinates map 1:1 (content:// URIs are unreliable
  // for RNImage.getSize and can decode at a downscaled size on Android).
  const [cropSourceUri, setCropSourceUri] = useState<string | null>(null);

  const photoViewerHeight = Math.max(220, height - 180);
  const cropCanvasWidth = Math.max(100, width - 24);
  const cropCanvasHeight = Math.max(100, photoViewerHeight - 24);
  const actionRowSlotWidth = 52;

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));

  const currentPhotoUri = consultation?.photoUris?.[activeIndex];

  const cropImageFrame = useMemo(() => {
    if (!cropImageSize) return null;

    const imageAspect = cropImageSize.width / cropImageSize.height;
    const canvasAspect = cropCanvasWidth / cropCanvasHeight;

    if (imageAspect > canvasAspect) {
      const frameWidth = cropCanvasWidth;
      const frameHeight = frameWidth / imageAspect;
      return {
        x: 0,
        y: (cropCanvasHeight - frameHeight) / 2,
        width: frameWidth,
        height: frameHeight,
      };
    }

    const frameHeight = cropCanvasHeight;
    const frameWidth = frameHeight * imageAspect;
    return {
      x: (cropCanvasWidth - frameWidth) / 2,
      y: 0,
      width: frameWidth,
      height: frameHeight,
    };
  }, [cropCanvasHeight, cropCanvasWidth, cropImageSize]);

  const resolveDisplayUris = useCallback(async (photoUris: string[]) => {
    const entries = await Promise.all(
      photoUris.map(async (uri) => {
        try {
          const displayUri = await toRenderableImageUriAsync(uri);
          return [uri, displayUri] as const;
        } catch {
          return [uri, undefined] as const;
        }
      }),
    );

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
    const safeIndex = Number.isFinite(parsedIndex)
      ? Math.max(
          0,
          Math.min(data.photoUris.length - 1, Math.floor(parsedIndex)),
        )
      : 0;
    setActiveIndex(safeIndex);

    setLoading(false);
  }, [consultationId, index, patientId, resolveDisplayUris]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const photoCount = consultation?.photoUris?.length ?? 0;
    if (!photoCount || isCropping) return;

    const safeIndex = Math.max(0, Math.min(photoCount - 1, activeIndex));
    if (safeIndex !== activeIndex) {
      setActiveIndex(safeIndex);
      return;
    }

    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: safeIndex, animated: false });
    });
  }, [activeIndex, consultation?.photoUris, isCropping]);

  const onMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const current = Math.round(event.nativeEvent.contentOffset.x / width);
    if (!consultation) return;
    const safe = Math.max(
      0,
      Math.min(consultation.photoUris.length - 1, current),
    );
    setActiveIndex(safe);
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

        setConsultation(updated);
        await resolveDisplayUris(updated.photoUris);

        const nextIndex = Math.max(
          0,
          Math.min(updated.photoUris.length - 1, preferredIndex),
        );
        setActiveIndex(nextIndex);
        requestAnimationFrame(() => {
          listRef.current?.scrollToIndex({ index: nextIndex, animated: false });
        });
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
    setCropImageSize(null);
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
      const normalized = await ImageManipulator.manipulateAsync(renderableUri, [], {
        compress: 1,
        format: ImageManipulator.SaveFormat.JPEG,
      });

      const imageSize = { width: normalized.width, height: normalized.height };
      setCropImageSize(imageSize);
      setCropSourceUri(normalized.uri);

      const imageAspect = imageSize.width / imageSize.height;
      const canvasAspect = cropCanvasWidth / cropCanvasHeight;

      const frame =
        imageAspect > canvasAspect
          ? {
              x: 0,
              y: (cropCanvasHeight - cropCanvasWidth / imageAspect) / 2,
              width: cropCanvasWidth,
              height: cropCanvasWidth / imageAspect,
            }
          : {
              x: (cropCanvasWidth - cropCanvasHeight * imageAspect) / 2,
              y: 0,
              width: cropCanvasHeight * imageAspect,
              height: cropCanvasHeight,
            };

      const marginX = frame.width * 0.15;
      const marginY = frame.height * 0.15;

      setCropRect({
        x: frame.x + marginX,
        y: frame.y + marginY,
        width: Math.max(56, frame.width - marginX * 2),
        height: Math.max(56, frame.height - marginY * 2),
      });
      setIsCropping(true);
    } catch {
      Alert.alert(
        "Crop unavailable",
        "Could not load this image for cropping.",
      );
    }
  }, [cropCanvasHeight, cropCanvasWidth, currentPhotoUri, displayUris]);

  const updateCropRectByMove = useCallback(
    (dx: number, dy: number) => {
      if (!cropStartRectRef.current || !cropImageFrame) return;

      const start = cropStartRectRef.current;
      const maxX = cropImageFrame.x + cropImageFrame.width - start.width;
      const maxY = cropImageFrame.y + cropImageFrame.height - start.height;

      setCropRect({
        x: clamp(start.x + dx, cropImageFrame.x, maxX),
        y: clamp(start.y + dy, cropImageFrame.y, maxY),
        width: start.width,
        height: start.height,
      });
    },
    [cropImageFrame],
  );

  const updateCropRectFromCornerDrag = useCallback(
    (corner: ResizeCorner, dx: number, dy: number) => {
      if (!cropStartRectRef.current || !cropImageFrame) return;

      const start = cropStartRectRef.current;
      const minSize = 56;
      const frameLeft = cropImageFrame.x;
      const frameTop = cropImageFrame.y;
      const frameRight = cropImageFrame.x + cropImageFrame.width;
      const frameBottom = cropImageFrame.y + cropImageFrame.height;

      let left = start.x;
      let top = start.y;
      let right = start.x + start.width;
      let bottom = start.y + start.height;

      if (corner === "topLeft") {
        left = clamp(start.x + dx, frameLeft, right - minSize);
        top = clamp(start.y + dy, frameTop, bottom - minSize);
      } else if (corner === "topRight") {
        right = clamp(start.x + start.width + dx, left + minSize, frameRight);
        top = clamp(start.y + dy, frameTop, bottom - minSize);
      } else if (corner === "bottomLeft") {
        left = clamp(start.x + dx, frameLeft, right - minSize);
        bottom = clamp(start.y + start.height + dy, top + minSize, frameBottom);
      } else {
        right = clamp(start.x + start.width + dx, left + minSize, frameRight);
        bottom = clamp(start.y + start.height + dy, top + minSize, frameBottom);
      }

      setCropRect({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      });
    },
    [cropImageFrame],
  );

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
      if (!mode || !startPoint) return;

      const dx = event.nativeEvent.pageX - startPoint.x;
      const dy = event.nativeEvent.pageY - startPoint.y;

      if (mode === "move") {
        updateCropRectByMove(dx, dy);
      } else {
        updateCropRectFromCornerDrag(mode, dx, dy);
      }
    },
    [updateCropRectByMove, updateCropRectFromCornerDrag],
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
      const scaleX = cropImageSize.width / cropImageFrame.width;
      const scaleY = cropImageSize.height / cropImageFrame.height;

      const originX = clamp(
        Math.round((cropRect.x - cropImageFrame.x) * scaleX),
        0,
        cropImageSize.width - 1,
      );
      const originY = clamp(
        Math.round((cropRect.y - cropImageFrame.y) * scaleY),
        0,
        cropImageSize.height - 1,
      );
      const cropWidth = clamp(
        Math.round(cropRect.width * scaleX),
        1,
        cropImageSize.width - originX,
      );
      const cropHeight = clamp(
        Math.round(cropRect.height * scaleY),
        1,
        cropImageSize.height - originY,
      );

      const result = await ImageManipulator.manipulateAsync(
        cropSourceUri,
        [
          {
            crop: {
              originX,
              originY,
              width: cropWidth,
              height: cropHeight,
            },
          },
        ],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
      );

      const next = consultation.photoUris.map((uri, idx) =>
        idx === activeIndex ? result.uri : uri,
      );

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

  const handleDelete = () => {
    if (isCropping) return;
    if (!consultation) return;
    const currentUri = consultation.photoUris[activeIndex];
    if (!currentUri) return;

    Alert.alert(
      "Delete photo",
      "This will remove the photo from the consultation.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            const next = consultation.photoUris.filter(
              (uri) => uri !== currentUri,
            );
            const nextIndex = Math.min(
              activeIndex,
              Math.max(0, next.length - 1),
            );
            void updateConsultationPhotos(next, nextIndex);
          },
        },
      ],
    );
  };

  const handleRotate = async () => {
    if (isCropping) return;
    if (!consultation) return;
    const currentUri = consultation.photoUris[activeIndex];
    if (!currentUri) return;

    setMutating(true);
    try {
      const result = await ImageManipulator.manipulateAsync(
        currentUri,
        [{ rotate: -90 }],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
      );

      const next = consultation.photoUris.map((uri, idx) =>
        idx === activeIndex ? result.uri : uri,
      );
      await updateConsultationPhotos(next, activeIndex);
    } catch {
      Alert.alert("Rotate failed", "We could not rotate this photo.");
      setMutating(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-black">
        <ActivityIndicator size="large" color="#e2e8f0" />
      </SafeAreaView>
    );
  }

  if (!consultation || consultation.photoUris.length === 0) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-black">
        <Text className="text-slate-200">No photos found.</Text>
        <Pressable
          className="mt-4 px-4 py-2 rounded-lg bg-slate-200"
          onPress={() => router.back()}
        >
          <Text className="text-slate-900 font-semibold">Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView className="flex-1 bg-black">
      <SafeAreaView className="flex-1 bg-black">
        <View className="flex-row items-center justify-between px-4 py-2">
          <Pressable
            onPress={() => {
              if (isCropping) {
                discardCropMode();
                return;
              }

              router.back();
            }}
            accessibilityLabel="Back"
            className="p-2"
          >
            <Feather name="arrow-left" size={22} color="#e2e8f0" />
          </Pressable>
          <Text className="text-slate-200 text-sm">
            {activeIndex + 1} / {consultation.photoUris.length}
          </Text>
          <View className="w-9" />
        </View>

        {isCropping && currentPhotoUri && cropRect && cropImageFrame ? (
          <View className="flex-1 w-full items-center">
            {/* Keep crop mode in the same viewport geometry as PhotoSlide to avoid visual jumps. */}
            <View
              style={{ width, height: photoViewerHeight }}
              className="items-center justify-center px-3"
            >
              <View
                style={{ width: cropCanvasWidth, height: cropCanvasHeight }}
                className="relative"
              >
                <Image
                  source={{
                    uri: displayUris[currentPhotoUri] ?? currentPhotoUri,
                  }}
                  style={{ width: cropCanvasWidth, height: cropCanvasHeight }}
                  contentFit="contain"
                />

                <View
                  onStartShouldSetResponder={() => true}
                  onResponderGrant={(event) => startCropDrag("move", event)}
                  onResponderMove={onCropDragMove}
                  onResponderRelease={endCropDrag}
                  onResponderTerminate={endCropDrag}
                  style={{
                    position: "absolute",
                    left: cropRect.x,
                    top: cropRect.y,
                    width: cropRect.width,
                    height: cropRect.height,
                    borderWidth: 2,
                    borderColor: "#e2e8f0",
                    backgroundColor: "rgba(255,255,255,0.06)",
                  }}
                />

                <View
                  onStartShouldSetResponder={() => true}
                  onResponderGrant={(event) => startCropDrag("topLeft", event)}
                  onResponderMove={onCropDragMove}
                  onResponderRelease={endCropDrag}
                  onResponderTerminate={endCropDrag}
                  hitSlop={12}
                  style={{
                    position: "absolute",
                    left: cropRect.x - 14,
                    top: cropRect.y - 14,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: "#e2e8f0",
                  }}
                />

                <View
                  onStartShouldSetResponder={() => true}
                  onResponderGrant={(event) => startCropDrag("topRight", event)}
                  onResponderMove={onCropDragMove}
                  onResponderRelease={endCropDrag}
                  onResponderTerminate={endCropDrag}
                  hitSlop={12}
                  style={{
                    position: "absolute",
                    left: cropRect.x + cropRect.width - 14,
                    top: cropRect.y - 14,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: "#e2e8f0",
                  }}
                />

                <View
                  onStartShouldSetResponder={() => true}
                  onResponderGrant={(event) =>
                    startCropDrag("bottomLeft", event)
                  }
                  onResponderMove={onCropDragMove}
                  onResponderRelease={endCropDrag}
                  onResponderTerminate={endCropDrag}
                  hitSlop={12}
                  style={{
                    position: "absolute",
                    left: cropRect.x - 14,
                    top: cropRect.y + cropRect.height - 14,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: "#e2e8f0",
                  }}
                />

                <View
                  onStartShouldSetResponder={() => true}
                  onResponderGrant={(event) =>
                    startCropDrag("bottomRight", event)
                  }
                  onResponderMove={onCropDragMove}
                  onResponderRelease={endCropDrag}
                  onResponderTerminate={endCropDrag}
                  hitSlop={12}
                  style={{
                    position: "absolute",
                    left: cropRect.x + cropRect.width - 14,
                    top: cropRect.y + cropRect.height - 14,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: "#e2e8f0",
                  }}
                />
              </View>
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            style={{ flex: 1 }}
            data={consultation.photoUris}
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
                listRef.current?.scrollToIndex({
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
                height={photoViewerHeight}
                isActive={itemIndex === activeIndex}
              />
            )}
          />
        )}

        <View className="bg-black/70 py-3 px-6">
          {isCropping ? (
            <View className="flex-row items-center justify-between">
              <Pressable
                disabled={mutating}
                onPress={discardCropMode}
                accessibilityLabel="Discard crop"
                style={{ minWidth: actionRowSlotWidth + 28 }}
                className="items-center justify-center px-4 py-3 rounded-lg border border-slate-400"
              >
                <Text className="text-slate-200 font-semibold">Discard</Text>
              </Pressable>

              <View style={{ width: actionRowSlotWidth }} />

              <Pressable
                disabled={mutating}
                onPress={() => {
                  void saveCrop();
                }}
                accessibilityLabel="Save crop"
                style={{ minWidth: actionRowSlotWidth + 28 }}
                className="items-center justify-center px-4 py-3 rounded-lg bg-slate-200"
              >
                <Text className="text-slate-900 font-semibold">Save</Text>
              </Pressable>
            </View>
          ) : (
            <View className="flex-row items-center justify-between">
              <Pressable
                disabled={mutating}
                onPress={() => {
                  void beginCropMode();
                }}
                accessibilityLabel="Crop photo"
                className="p-3"
              >
                <Feather
                  name="crop"
                  size={24}
                  color={mutating ? "#94a3b8" : "#e2e8f0"}
                />
              </Pressable>

              <Pressable
                disabled={mutating}
                onPress={handleRotate}
                accessibilityLabel="Rotate photo anticlockwise"
                className="p-3"
              >
                <Feather
                  name="rotate-ccw"
                  size={24}
                  color={mutating ? "#94a3b8" : "#e2e8f0"}
                />
              </Pressable>

              <Pressable
                disabled={mutating}
                onPress={handleDelete}
                accessibilityLabel="Delete photo"
                className="p-3"
              >
                <Feather
                  name="trash-2"
                  size={24}
                  color={mutating ? "#94a3b8" : "#f87171"}
                />
              </Pressable>
            </View>
          )}

          {mutating ? (
            <View className="flex-row items-center justify-center mt-3">
              <ActivityIndicator size="small" color="#e2e8f0" />
              <Text className="text-slate-100 ml-2">Working...</Text>
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}
