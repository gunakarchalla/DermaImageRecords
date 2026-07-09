import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";

import { useThemeColors } from "../hooks/useThemeColors";
import type { ConsultationIndexRow } from "../types/models";

// `createdAt` is the visit date; `updatedAt` moves whenever remarks or photos are
// edited, so it can't identify a visit when comparing across time.
export const formatConsultationDate = (createdAt: string) =>
  new Date(createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

type ConsultationPickerProps = {
  label: string;
  consultations: ConsultationIndexRow[];
  selectedId?: string;
  onSelect: (consultationId: string) => void;
};

export function ConsultationPicker({
  label,
  consultations,
  selectedId,
  onSelect,
}: ConsultationPickerProps) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);

  const selected = consultations.find((item) => item.id === selectedId);

  return (
    <View>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityLabel={`Choose ${label} consultation`}
        className="flex-row items-center justify-between bg-white border border-slate-200 rounded-xl px-3 py-2 dark:bg-slate-900 dark:border-slate-700"
      >
        <View className="flex-1 mr-2">
          <Text className="text-xs text-slate-400 dark:text-slate-500">
            {label}
          </Text>
          <Text
            numberOfLines={1}
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            {selected
              ? `${formatConsultationDate(selected.createdAt)} · ${selected.photoCount} photo${selected.photoCount === 1 ? "" : "s"}`
              : "Select a consultation"}
          </Text>
        </View>
        <Feather name="chevron-down" size={18} color={colors.icon} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => setOpen(false)}
        >
          {/* Swallow taps inside the sheet so they don't dismiss it. */}
          <Pressable
            onPress={() => {}}
            style={{ maxHeight: "70%" }}
            className="bg-white rounded-t-2xl pt-4 pb-6 dark:bg-slate-900"
          >
            <Text className="px-4 pb-3 text-base font-semibold text-slate-900 dark:text-slate-100">
              {label}
            </Text>

            <FlatList
              data={consultations}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const isSelected = item.id === selectedId;
                return (
                  <Pressable
                    onPress={() => {
                      onSelect(item.id);
                      setOpen(false);
                    }}
                    className={`flex-row items-center px-4 py-3 ${
                      isSelected ? "bg-slate-100 dark:bg-slate-800" : ""
                    }`}
                  >
                    <View className="flex-1 mr-3">
                      <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {formatConsultationDate(item.createdAt)}
                      </Text>
                      <Text
                        numberOfLines={1}
                        className="text-xs text-slate-500 dark:text-slate-400"
                      >
                        {item.photoCount} photo
                        {item.photoCount === 1 ? "" : "s"} ·{" "}
                        {item.remarks || "No remarks"}
                      </Text>
                    </View>
                    {isSelected ? (
                      <Feather name="check" size={18} color={colors.iconStrong} />
                    ) : null}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                  No consultations yet.
                </Text>
              }
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
