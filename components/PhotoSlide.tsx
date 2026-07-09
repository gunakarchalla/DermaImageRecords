import { Image } from "expo-image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const DOUBLE_TAP_SCALE = 2.5;

export type PhotoSlideProps = {
  sourceUri: string;
  width: number;
  height: number;
  isActive: boolean;
  /** Called on a single tap that isn't part of a double tap. Used to toggle viewer chrome. */
  onTap?: () => void;
};

/**
 * A single pinch-to-zoom / pan photo page, sized to fill one page of a horizontal
 * paging FlatList. Shared by the fullscreen consultation photo viewer and the
 * compare screen's two rows.
 */
export function PhotoSlide({
  sourceUri,
  width,
  height,
  isActive,
  onTap,
}: PhotoSlideProps) {
  const [canPan, setCanPan] = useState(false);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);

  useEffect(() => {
    if (!isActive) {
      // Reset transforms when this slide is no longer active so swiping back starts fresh.
      scale.value = 1;
      savedScale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      panStartX.value = 0;
      panStartY.value = 0;
      setCanPan(false);
    }
  }, [
    isActive,
    panStartX,
    panStartY,
    savedScale,
    scale,
    translateX,
    translateY,
  ]);

  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .enabled(isActive)
        .onStart(() => {
          savedScale.value = scale.value;
        })
        .onUpdate((event) => {
          const next = Math.min(Math.max(savedScale.value * event.scale, 1), 4);
          scale.value = next;

          // Enable single-finger panning only after meaningful zoom.
          // This keeps horizontal swipe-to-next-image working at normal scale.
          runOnJS(setCanPan)(next > 1.02);
        })
        .onEnd(() => {
          if (scale.value <= 1) {
            scale.value = 1;
            translateX.value = 0;
            translateY.value = 0;
            runOnJS(setCanPan)(false);
          }
        }),
    [isActive, savedScale, scale, translateX, translateY],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(isActive && canPan)
        .onStart(() => {
          panStartX.value = translateX.value;
          panStartY.value = translateY.value;
        })
        .onUpdate((event) => {
          if (scale.value <= 1) {
            translateX.value = 0;
            translateY.value = 0;
            return;
          }

          translateX.value = panStartX.value + event.translationX;
          translateY.value = panStartY.value + event.translationY;
        })
        .onEnd(() => {
          if (scale.value <= 1) {
            translateX.value = 0;
            translateY.value = 0;
          }
        }),
    [canPan, isActive, panStartX, panStartY, scale, translateX, translateY],
  );

  const handleTap = useCallback(() => {
    onTap?.();
  }, [onTap]);

  const doubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .enabled(isActive)
        .onEnd(() => {
          const zoomedIn = scale.value > 1.02;
          const next = zoomedIn ? 1 : DOUBLE_TAP_SCALE;

          scale.value = withTiming(next, { duration: 180 });
          savedScale.value = next;

          if (zoomedIn) {
            translateX.value = withTiming(0, { duration: 180 });
            translateY.value = withTiming(0, { duration: 180 });
          }

          runOnJS(setCanPan)(!zoomedIn);
        }),
    [isActive, savedScale, scale, translateX, translateY],
  );

  const singleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .enabled(isActive)
        .onEnd(() => {
          runOnJS(handleTap)();
        }),
    [handleTap, isActive],
  );

  const composedGesture = useMemo(
    () =>
      Gesture.Simultaneous(
        pinchGesture,
        panGesture,
        // Exclusive so a double tap never also fires the single-tap handler.
        Gesture.Exclusive(doubleTapGesture, singleTapGesture),
      ),
    [doubleTapGesture, panGesture, pinchGesture, singleTapGesture],
  );

  return (
    <GestureDetector gesture={composedGesture}>
      <View
        style={{ width, height }}
        className="items-center justify-center px-3"
      >
        <Animated.View
          style={animatedImageStyle}
          className="h-full w-full items-center justify-center"
        >
          <Image
            source={{ uri: sourceUri }}
            style={{ width: width - 24, height: height - 24 }}
            contentFit="contain"
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
