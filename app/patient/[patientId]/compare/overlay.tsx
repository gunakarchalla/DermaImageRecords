import Slider from "@react-native-community/slider";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { formatConsultationDate } from "../../../../components/ConsultationPicker";
import { toRenderableImageUriAsync } from "../../../../services/imageUri";
import { getConsultation } from "../../../../services/storage/storage";

type BlendMode = "fade" | "wipe";

type OverlayPhoto = {
  uri: string;
  createdAt: string;
};

const DIVIDER_WIDTH = 2;

const resolvePhotoAsync = async (
  patientId: string,
  consultationId: string,
  photoIndex: number,
): Promise<OverlayPhoto | null> => {
  const consultation = await getConsultation(patientId, consultationId);
  const persistedUri = consultation?.photoUris?.[photoIndex];
  if (!consultation || !persistedUri) return null;

  try {
    return {
      uri: (await toRenderableImageUriAsync(persistedUri)) ?? persistedUri,
      createdAt: consultation.createdAt,
    };
  } catch {
    return { uri: persistedUri, createdAt: consultation.createdAt };
  }
};

const parseIndex = (raw?: string) => {
  const parsed = Number(raw ?? "0");
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
};

export default function CompareOverlayScreen() {
  const { patientId, topId, topIndex, bottomId, bottomIndex } =
    useLocalSearchParams<{
      patientId: string;
      topId: string;
      topIndex?: string;
      bottomId: string;
      bottomIndex?: string;
    }>();

  const [top, setTop] = useState<OverlayPhoto | null>(null);
  const [bottom, setBottom] = useState<OverlayPhoto | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<BlendMode>("fade");
  const [canvas, setCanvas] = useState({ width: 0, height: 0 });

  // 0 = only the top photo, 1 = only the bottom photo. Driven straight from the
  // slider into a shared value so dragging never re-renders the images.
  const progress = useSharedValue(0.5);

  useEffect(() => {
    if (!patientId || !topId || !bottomId) return;
    let cancelled = false;

    void (async () => {
      try {
        const [topPhoto, bottomPhoto] = await Promise.all([
          resolvePhotoAsync(patientId, topId, parseIndex(topIndex)),
          resolvePhotoAsync(patientId, bottomId, parseIndex(bottomIndex)),
        ]);
        if (cancelled) return;
        setTop(topPhoto);
        setBottom(bottomPhoto);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [patientId, topId, topIndex, bottomId, bottomIndex]);

  const onCanvasLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCanvas((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  // Wipe keeps the top photo on the left and reveals the bottom photo inward from
  // the right edge, so the divider sits at (1 - progress) of the canvas width:
  // progress 0 leaves the divider at the far right (top only), progress 1 pushes
  // it to the far left (bottom only).
  const wipeStyle = useAnimatedStyle(() => ({
    width: progress.value * canvas.width,
  }));

  const dividerStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: Math.min(
          (1 - progress.value) * canvas.width,
          Math.max(0, canvas.width - DIVIDER_WIDTH),
        ),
      },
    ],
  }));

  const canvasFill = {
    position: "absolute" as const,
    left: 0,
    top: 0,
    width: canvas.width,
    height: canvas.height,
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-black">
        <Stack.Screen options={{ title: "Overlay" }} />
        <ActivityIndicator size="large" color="#e2e8f0" />
      </SafeAreaView>
    );
  }

  if (!top || !bottom) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center px-8 bg-black">
        <Stack.Screen options={{ title: "Overlay" }} />
        <Text className="text-center text-slate-200">
          Could not load both photos to overlay.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-black">
      <Stack.Screen options={{ title: "Overlay" }} />

      <View className="flex-row items-center justify-center py-3">
        {(
          [
            { value: "fade", label: "Fade" },
            { value: "wipe", label: "Wipe" },
          ] as { value: BlendMode; label: string }[]
        ).map((option) => (
          <Pressable
            key={option.value}
            onPress={() => setMode(option.value)}
            accessibilityLabel={`${option.label} blend mode`}
            className={`px-5 py-2 mx-1 rounded-full border ${
              mode === option.value
                ? "bg-slate-200 border-slate-200"
                : "border-slate-700"
            }`}
          >
            <Text
              className={`text-sm font-semibold ${
                mode === option.value ? "text-slate-900" : "text-slate-300"
              }`}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View onLayout={onCanvasLayout} className="flex-1 overflow-hidden">
        {canvas.width > 0 && canvas.height > 0 ? (
          <>
            <Image
              source={{ uri: top.uri }}
              style={canvasFill}
              contentFit="contain"
            />

            {mode === "fade" ? (
              <Animated.View style={[canvasFill, fadeStyle]}>
                <Image
                  source={{ uri: bottom.uri }}
                  style={{ width: canvas.width, height: canvas.height }}
                  contentFit="contain"
                />
              </Animated.View>
            ) : (
              <>
                <Animated.View
                  style={[
                    {
                      position: "absolute",
                      right: 0,
                      top: 0,
                      height: canvas.height,
                      overflow: "hidden",
                    },
                    wipeStyle,
                  ]}
                >
                  {/* Right-anchored at full canvas width, so the visible slice lines up
                      with the same region of the top photo instead of sliding with the clip. */}
                  <Image
                    source={{ uri: bottom.uri }}
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 0,
                      width: canvas.width,
                      height: canvas.height,
                    }}
                    contentFit="contain"
                  />
                </Animated.View>

                <Animated.View
                  pointerEvents="none"
                  style={[
                    {
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: DIVIDER_WIDTH,
                      backgroundColor: "#e2e8f0",
                    },
                    dividerStyle,
                  ]}
                />
              </>
            )}
          </>
        ) : null}
      </View>

      <View className="px-5 pt-2 pb-4 bg-black/70">
        <Slider
          style={{ width: "100%", height: 40 }}
          minimumValue={0}
          maximumValue={1}
          value={0.5}
          onValueChange={(value) => {
            progress.value = value;
          }}
          minimumTrackTintColor="#e2e8f0"
          maximumTrackTintColor="#334155"
          thumbTintColor="#e2e8f0"
        />

        <View className="flex-row items-center justify-between">
          <Text className="text-xs text-slate-400">
            Top · {formatConsultationDate(top.createdAt)}
          </Text>
          <Text className="text-xs text-slate-400">
            Bottom · {formatConsultationDate(bottom.createdAt)}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
