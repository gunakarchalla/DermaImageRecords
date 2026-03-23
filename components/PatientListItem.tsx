import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { memo, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { toRenderableImageUriAsync } from "../services/imageUri";
import type { Patient } from "../types/models";

type Props = {
  patient: Patient;
  onPress: (patient: Patient) => void;
  onDelete: (patient: Patient) => void;
};

const withCacheBuster = (uri: string, cacheKey: string) => {
  const separator = uri.includes("?") ? "&" : "?";
  return `${uri}${separator}v=${encodeURIComponent(cacheKey)}`;
};

// Memoized row component to minimize re-renders in large lists.
export const PatientListItem = memo(function PatientListItem({
  patient,
  onPress,
  onDelete,
}: Props) {
  const [displayUri, setDisplayUri] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const uri = await toRenderableImageUriAsync(patient.profilePhotoUri);
        if (!cancelled) {
          setDisplayUri(
            uri ? withCacheBuster(uri, patient.updatedAt) : undefined,
          );
        }
      } catch {
        if (!cancelled) setDisplayUri(undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [patient.id, patient.profilePhotoUri, patient.updatedAt]);

  return (
    <Pressable
      onPress={() => onPress(patient)}
      className="flex-row items-center bg-white mb-3 rounded-xl p-4 shadow-sm"
    >
      {patient.profilePhotoUri && displayUri ? (
        <Image
          source={{ uri: displayUri }}
          className="h-14 w-14 rounded-full mr-4"
          contentFit="cover"
        />
      ) : (
        <View className="h-14 w-14 rounded-full mr-4 bg-slate-200 items-center justify-center">
          <Feather name="user" size={26} color="#475569" />
        </View>
      )}

      <View className="flex-1">
        <Text className="text-lg font-semibold text-slate-900">
          {patient.name}
        </Text>
        {patient.emrNumber ? (
          <Text className="text-sm text-slate-500">
            EMR: {patient.emrNumber}
          </Text>
        ) : null}
        <Text className="text-xs text-slate-400 mt-1">
          Updated {new Date(patient.updatedAt).toLocaleString()}
        </Text>
      </View>

      <Pressable
        accessibilityLabel="Delete patient"
        onPress={() => onDelete(patient)}
        className="p-2"
      >
        <Feather name="trash-2" size={20} color="#e11d48" />
      </Pressable>
    </Pressable>
  );
});
