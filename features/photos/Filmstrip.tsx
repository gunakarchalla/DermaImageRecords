import { Image } from "expo-image";
import type { RefObject } from "react";
import { FlatList, Pressable } from "react-native";

import { IMMERSIVE } from "../../components/ImmersiveControls";

export const THUMB_SIZE = 56;

type Props = {
  listRef: RefObject<FlatList<string> | null>;
  photoUris: string[];
  displayUris: Record<string, string | undefined>;
  activeIndex: number;
  onSelect: (index: number) => void;
  disabled: boolean;
};

/** Horizontal thumbnail strip under the photo pager. */
export function Filmstrip({
  listRef,
  photoUris,
  displayUris,
  activeIndex,
  onSelect,
  disabled,
}: Props) {
  return (
    <FlatList
      ref={listRef}
      data={photoUris}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyExtractor={(item) => item}
      className="pt-3"
      contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}
      getItemLayout={(_, listIndex) => ({
        length: THUMB_SIZE + 8,
        offset: (THUMB_SIZE + 8) * listIndex,
        index: listIndex,
      })}
      onScrollToIndexFailed={() => {}}
      renderItem={({ item, index: itemIndex }) => {
        const selected = itemIndex === activeIndex;
        return (
          <Pressable
            onPress={() => onSelect(itemIndex)}
            disabled={disabled}
            accessibilityLabel={`Show photo ${itemIndex + 1}`}
            accessibilityState={{ selected }}
            className="overflow-hidden rounded-xl"
            style={{
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              borderWidth: 2,
              borderColor: selected ? IMMERSIVE.active : "transparent",
              opacity: selected ? 1 : 0.55,
            }}
          >
            <Image
              source={{ uri: displayUris[item] ?? item }}
              recyclingKey={item}
              cachePolicy="memory-disk"
              style={{ flex: 1 }}
              contentFit="cover"
            />
          </Pressable>
        );
      }}
    />
  );
}
