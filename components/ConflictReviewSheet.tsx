import { useColorScheme } from "nativewind";
import { useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";

import type { ArchivePlanEntry, ImportDecision } from "../services/backup/backupService";
import { formatEmrNumberForDisplay } from "../services/patient/emr";

// Active/inactive styling is applied via inline `style`, not by toggling Tailwind classes —
// dynamically adding/removing a shadow or interaction class on a css-interop component after its
// first render trips its "View → Pressable" upgrade path and crashes serializing props. See the
// note in app/(drawer)/backup-sync.tsx. Only the non-changing `text-*` classes stay on className
// so global font scaling still applies.

type ConflictReviewSheetProps = {
  /** Same-EMR/different-name collisions to review. Always non-empty when this renders. */
  mismatches: ArchivePlanEntry[];
  /** Resolve with per-EMR decisions to apply, or null to cancel the whole import. */
  onResolve: (decisions: Record<string, ImportDecision> | null) => void;
};

const OPTIONS: { value: ImportDecision; label: string }[] = [
  { value: "merge", label: "Merge" },
  { value: "addAsNew", label: "Add as new" },
];

/**
 * Review screen for the one collision worth surfacing: an incoming patient shares an EMR with a
 * local one but the names clearly differ. Each row defaults to Merge (fold together) and can be
 * flipped to "Add as new" (give the incoming record a fresh EMR and keep both). Every other
 * collision merges silently and never reaches here.
 */
export function ConflictReviewSheet({ mismatches, onResolve }: ConflictReviewSheetProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const [decisions, setDecisions] = useState<Record<string, ImportDecision>>({});

  const decisionFor = (emr: string): ImportDecision => decisions[emr] ?? "merge";
  const setDecision = (emr: string, value: ImportDecision) =>
    setDecisions((prev) => ({ ...prev, [emr]: value }));

  const trackBg = isDark ? "#1e293b" : "#f1f5f9"; // slate-800 / slate-100
  const activeBg = isDark ? "#475569" : "#ffffff"; // slate-600 / white
  const activeText = isDark ? "#f1f5f9" : "#0f172a"; // slate-100 / slate-900
  const inactiveText = isDark ? "#94a3b8" : "#64748b"; // slate-400 / slate-500

  const renderItem = ({ item }: { item: ArchivePlanEntry }) => {
    const current = decisionFor(item.emrNumber);
    return (
      <View className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <Text className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          EMR {formatEmrNumberForDisplay(item.emrNumber)}
        </Text>
        <View className="mt-1 flex-row">
          <Text className="w-20 text-sm text-slate-400 dark:text-slate-500">On device</Text>
          <Text className="flex-1 text-sm text-slate-900 dark:text-slate-100">
            {item.localName || "—"}
          </Text>
        </View>
        <View className="mt-0.5 flex-row">
          <Text className="w-20 text-sm text-slate-400 dark:text-slate-500">In backup</Text>
          <Text className="flex-1 text-sm text-slate-900 dark:text-slate-100">
            {item.incomingName || "—"}
          </Text>
        </View>

        <View
          style={{
            flexDirection: "row",
            borderRadius: 8,
            padding: 4,
            backgroundColor: trackBg,
            marginTop: 10,
          }}
        >
          {OPTIONS.map((option) => {
            const active = option.value === current;
            return (
              <Pressable
                key={option.value}
                onPress={() => setDecision(item.emrNumber, option.value)}
                style={{
                  flex: 1,
                  alignItems: "center",
                  borderRadius: 6,
                  paddingVertical: 8,
                  backgroundColor: active ? activeBg : "transparent",
                }}
              >
                <Text
                  className="text-sm font-semibold"
                  style={{ color: active ? activeText : inactiveText }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onResolve(null)}>
      <View className="flex-1 justify-end bg-black/50">
        <View style={{ maxHeight: "80%" }} className="rounded-t-2xl bg-white pt-4 dark:bg-slate-900">
          <Text className="px-4 text-base font-semibold text-slate-900 dark:text-slate-100">
            Same EMR, different name
          </Text>
          <Text className="mt-1 px-4 text-sm text-slate-500 dark:text-slate-400">
            {mismatches.length === 1
              ? "A patient in the backup shares an EMR with a different name here. Merge them, or add the incoming record under a new EMR."
              : `${mismatches.length} patients in the backup share an EMR with a different name here. Choose per record.`}
          </Text>

          <FlatList
            data={mismatches}
            keyExtractor={(item) => item.emrNumber}
            renderItem={renderItem}
            className="mt-2"
          />

          <View className="flex-row px-4 py-4">
            <Pressable
              onPress={() => onResolve(null)}
              className="mr-3 h-12 flex-1 items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700"
            >
              <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onResolve(decisions)}
              className="h-12 flex-1 items-center justify-center rounded-lg bg-slate-900 dark:bg-slate-100"
            >
              <Text className="text-base font-semibold text-white dark:text-slate-900">Apply</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
