import { Image } from "expo-image";
import {
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";

import { IMMERSIVE, RuleOfThirdsGrid } from "../../components/ImmersiveControls";
import type { CropRect, ResizeCorner } from "./cropGeometry";

const HANDLE_SIZE = 44;
const DIM = "rgba(2,6,23,0.6)";

/** Corner bracket + invisible 44pt touch target, centred on the crop corner. */
function CropHandle({
  corner,
  rect,
  onGrant,
  onMove,
  onRelease,
}: {
  corner: ResizeCorner;
  rect: CropRect;
  onGrant: (corner: ResizeCorner, event: GestureResponderEvent) => void;
  onMove: (event: GestureResponderEvent) => void;
  onRelease: () => void;
}) {
  const isLeft = corner === "topLeft" || corner === "bottomLeft";
  const isTop = corner === "topLeft" || corner === "topRight";

  const cornerX = isLeft ? rect.x : rect.x + rect.width;
  const cornerY = isTop ? rect.y : rect.y + rect.height;

  const bracket = {
    backgroundColor: IMMERSIVE.hairline,
    position: "absolute" as const,
    borderRadius: 2,
    ...(isLeft ? { left: HANDLE_SIZE / 2 - 3 } : { right: HANDLE_SIZE / 2 - 3 }),
    ...(isTop ? { top: HANDLE_SIZE / 2 - 3 } : { bottom: HANDLE_SIZE / 2 - 3 }),
  };

  return (
    <View
      onStartShouldSetResponder={() => true}
      onResponderGrant={(event) => onGrant(corner, event)}
      onResponderMove={onMove}
      onResponderRelease={onRelease}
      onResponderTerminate={onRelease}
      hitSlop={10}
      accessibilityLabel={`Resize crop from ${corner}`}
      style={{
        position: "absolute",
        left: cornerX - HANDLE_SIZE / 2,
        top: cornerY - HANDLE_SIZE / 2,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
      }}
    >
      <View pointerEvents="none" style={{ ...bracket, width: 22, height: 3 }} />
      <View pointerEvents="none" style={{ ...bracket, width: 3, height: 22 }} />
    </View>
  );
}

type Props = {
  /** Render-safe URI of the photo being cropped. */
  displayUri: string;
  cropRect: CropRect | null;
  /** Absolute-positioned bounds are the caller's concern (chrome-height dependent). */
  top: number;
  bottom: number;
  padding: number;
  onLayout: (event: LayoutChangeEvent) => void;
  onDragStart: (mode: "move" | ResizeCorner, event: GestureResponderEvent) => void;
  onDragMove: (event: GestureResponderEvent) => void;
  onDragEnd: () => void;
};

/**
 * The crop canvas: the photo, a dimmed surround, the movable/resizable crop
 * rectangle with rule-of-thirds grid, and the four corner handles. All geometry
 * decisions live in the caller (via cropGeometry); this renders and forwards drags.
 */
export function CropOverlay({
  displayUri,
  cropRect,
  top,
  bottom,
  padding,
  onLayout,
  onDragStart,
  onDragMove,
  onDragEnd,
}: Props) {
  return (
    <View
      onLayout={onLayout}
      style={{ position: "absolute", top, bottom, left: padding, right: padding }}
    >
      <Image
        source={{ uri: displayUri }}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
      />

      {cropRect ? (
        <>
          {/* Dim everything outside the crop rectangle. */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: cropRect.y,
              backgroundColor: DIM,
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: cropRect.y + cropRect.height,
              bottom: 0,
              backgroundColor: DIM,
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              top: cropRect.y,
              width: cropRect.x,
              height: cropRect.height,
              backgroundColor: DIM,
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: cropRect.x + cropRect.width,
              right: 0,
              top: cropRect.y,
              height: cropRect.height,
              backgroundColor: DIM,
            }}
          />

          <View
            onStartShouldSetResponder={() => true}
            onResponderGrant={(event) => onDragStart("move", event)}
            onResponderMove={onDragMove}
            onResponderRelease={onDragEnd}
            onResponderTerminate={onDragEnd}
            accessibilityLabel="Move crop area"
            style={{
              position: "absolute",
              left: cropRect.x,
              top: cropRect.y,
              width: cropRect.width,
              height: cropRect.height,
              borderWidth: 1,
              borderColor: "rgba(226,232,240,0.7)",
            }}
          >
            <RuleOfThirdsGrid inset />
          </View>

          {(["topLeft", "topRight", "bottomLeft", "bottomRight"] as ResizeCorner[]).map(
            (corner) => (
              <CropHandle
                key={corner}
                corner={corner}
                rect={cropRect}
                onGrant={onDragStart}
                onMove={onDragMove}
                onRelease={onDragEnd}
              />
            ),
          )}
        </>
      ) : null}
    </View>
  );
}
