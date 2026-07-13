import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";

import { useResolvedImageUri } from "../hooks/useResolvedImageUri";
import { useThemeColors } from "../hooks/useThemeColors";
import { formatEmrNumberForDisplay } from "../services/patient/emr";
import type { Patient } from "../types/models";

type Props = {
  patient: Patient;
  onPress: (patient: Patient) => void;
  onDelete: (patient: Patient) => void;
};

// Memoized row component to minimize re-renders in large lists.
export const PatientListItem = memo(function PatientListItem({
  patient,
  onPress,
  onDelete,
}: Props) {
  const colors = useThemeColors();
  // The 56px avatar renders the 512px thumbnail when one exists; profile file names are
  // content-addressed, so no version param is needed — a new photo is a new URI.
  const displayUri = useResolvedImageUri(
    patient.profileThumbUri ?? patient.profilePhotoUri,
  );

  return (
    <Pressable
      onPress={() => onPress(patient)}
      className="flex-row items-center bg-white mb-3 rounded-xl p-4 shadow-sm dark:bg-slate-900"
    >
      {patient.profilePhotoUri && displayUri ? (
        <Image
          source={{ uri: displayUri }}
          recyclingKey={patient.id}
          cachePolicy="memory-disk"
          className="h-14 w-14 rounded-full mr-4"
          contentFit="cover"
        />
      ) : (
        <View className="h-14 w-14 rounded-full mr-4 bg-slate-200 items-center justify-center dark:bg-slate-800">
          <Feather name="user" size={26} color={colors.icon} />
        </View>
      )}

      <View className="flex-1">
        <Text className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {patient.name}
        </Text>
        <Text className="text-sm text-slate-500 dark:text-slate-400">
          EMR: {formatEmrNumberForDisplay(patient.emrNumber)}
        </Text>
        <Text className="text-xs text-slate-400 mt-1 dark:text-slate-500">
          Updated {new Date(patient.updatedAt).toLocaleString()}
        </Text>
      </View>

      <Pressable
        accessibilityLabel="Delete patient"
        onPress={() => onDelete(patient)}
        className="p-2"
      >
        <Feather name="trash-2" size={20} color={colors.danger} />
      </Pressable>
    </Pressable>
  );
});
