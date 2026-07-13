import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FlashList } from "@shopify/flash-list";
import { useColorScheme } from "nativewind";

import { useDatasetFocusRefresh } from "../../../hooks/useDatasetFocusRefresh";
import { useResolvedImageUri } from "../../../hooks/useResolvedImageUri";
import { useThemeColors } from "../../../hooks/useThemeColors";
import type { ConsultationCursor } from "../../../services/db/dermaDb";
import { consultationIndexService } from "../../../services/indexing/consultationIndexService";
import { formatEmrNumberForDisplay } from "../../../services/patient/emr";
import {
  deleteConsultation,
  getPatient,
  updatePatientAsync,
} from "../../../services/storage/storage";
import { ConsultationIndexRow, Gender, Patient } from "../../../types/models";

const CONSULTATIONS_PAGE_SIZE = 25;

// Memoized row so FlashList recycling doesn't re-render untouched consultations.
const ConsultationListItem = memo(function ConsultationListItem({
  item,
  onOpen,
  onDelete,
  dangerColor,
}: {
  item: ConsultationIndexRow;
  onOpen: (item: ConsultationIndexRow) => void;
  onDelete: (item: ConsultationIndexRow) => void;
  dangerColor: string;
}) {
  return (
    <Pressable
      onPress={() => onOpen(item)}
      className="bg-white rounded-xl p-3 mb-3 shadow-sm dark:bg-slate-900"
    >
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Consultation #{item.number}
        </Text>
        <View className="flex-row items-center">
          <Text className="text-xs text-slate-500 dark:text-slate-400">
            {new Date(item.updatedAt).toLocaleDateString()}
          </Text>
          <Pressable
            accessibilityLabel="Delete consultation"
            onPress={() => onDelete(item)}
            className="ml-3 p-2"
          >
            <Feather name="trash-2" size={18} color={dangerColor} />
          </Pressable>
        </View>
      </View>
      <Text className="text-sm text-slate-700 dark:text-slate-200" numberOfLines={2}>
        {item.remarks || "No remarks"}
      </Text>
      <Text className="text-xs text-slate-400 mt-2 dark:text-slate-500">
        Photos: {item.photoCount}
      </Text>
    </Pressable>
  );
});

export default function PatientDetailsScreen() {
  const router = useRouter();
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  const [patient, setPatient] = useState<Patient | null>(null);
  const [consultations, setConsultations] = useState<ConsultationIndexRow[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [editing, setEditing] = useState(false);
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | undefined>();

  // A revision-triggered reload must not clobber a form the user is mid-edit in.
  const editingRef = useRef(editing);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  // Render-safe preview: a freshly picked photo is file:// (passes through); the persisted
  // SAF URI resolves via the fingerprinted cache, so `updatedAt` re-checks are metadata-only.
  const profilePhotoDisplayUri = useResolvedImageUri(
    profilePhotoUri,
    patient?.updatedAt,
  );

  const cursorRef = useRef<ConsultationCursor | undefined>(undefined);
  // No `emrNumber` here by design: the EMR is this patient's identity and is immutable.
  const [form, setForm] = useState({
    name: "",
    age: "",
    gender: "unspecified" as Gender,
    phone: "",
  });

  const loadData = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const patientData = await getPatient(patientId as string);
      if (patientData) {
        setPatient(patientData);

        // Skip form/photo state while the user is editing: a consultation delete (which
        // bumps the dataset revision) must not wipe their in-progress changes.
        if (!editingRef.current) {
          setProfilePhotoUri(patientData.profilePhotoUri);
          setForm({
            name: patientData.name,
            age: patientData.age ? String(patientData.age) : "",
            gender: patientData.gender ?? "unspecified",
            phone: patientData.phone ?? "",
          });
        }
      }

      // Load first page of consultations from the SQLite index.
      if (patientId) {
        cursorRef.current = undefined;
        const { items, nextCursor } =
          await consultationIndexService.queryConsultationsPageAsync({
            patientId: patientId as string,
            limit: CONSULTATIONS_PAGE_SIZE,
          });
        setConsultations(items);
        cursorRef.current = nextCursor;
        setHasMore(Boolean(nextCursor));
      }
    } catch (error) {
      Alert.alert(
        "Load failed",
        `Could not load patient details. Error: ${(error as Error).message}`,
      );
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  const loadMoreConsultations = useCallback(async () => {
    if (!patientId || loading || loadingMore || !hasMore) return;
    const cursor = cursorRef.current;
    if (!cursor) return;

    setLoadingMore(true);
    try {
      const { items, nextCursor } =
        await consultationIndexService.queryConsultationsPageAsync({
          patientId: patientId as string,
          limit: CONSULTATIONS_PAGE_SIZE,
          cursor,
        });
      setConsultations((prev) => [...prev, ...items]);
      cursorRef.current = nextCursor;
      setHasMore(Boolean(nextCursor));
    } catch {
      // Best-effort paging.
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loading, loadingMore, patientId]);

  const confirmDeleteConsultation = useCallback(
    (consultation: ConsultationIndexRow) => {
      if (!patientId) return;

      Alert.alert(
        "Delete consultation",
        "Delete this consultation? This cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                // The delete bumps the dataset revision, which reloads this screen.
                await deleteConsultation(patientId as string, consultation.id);
              } catch (error) {
                Alert.alert(
                  "Delete failed",
                  `Could not delete this consultation. Error: ${(error as Error).message}`,
                );
              }
            },
          },
        ],
      );
    },
    [patientId],
  );

  // Load on first focus; reload only when the dataset changed (saves, deletes, imports).
  useDatasetFocusRefresh(loadData);

  const requestPhoto = async (fromCamera: boolean) => {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        "Permission needed",
        "Please allow camera/photos access to continue.",
      );
      return;
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: "images" as ImagePicker.MediaType,
          quality: 1,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: "images" as ImagePicker.MediaType,
          quality: 1,
        });

    if (!result.canceled && result.assets?.length) {
      // The preview hook resolves the picked URI (usually file://) automatically.
      setProfilePhotoUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!patientId) return;
    if (!form.name.trim()) {
      Alert.alert("Missing name", "Please enter a patient name.");
      return;
    }

    const ageNumber = Number(form.age);
    const ageValue = Number.isFinite(ageNumber) ? ageNumber : undefined;

    try {
      const updated = await updatePatientAsync(patientId as string, {
        name: form.name,
        age: form.age ? ageValue : undefined,
        gender: form.gender,
        phone: form.phone,
        profilePhotoUri,
      });
      setPatient(updated);
      // Keep form state aligned with the persisted profile URI after save; the preview
      // hook re-resolves it (new `updatedAt` version → fresh fingerprint if it changed).
      setProfilePhotoUri(updated.profilePhotoUri);
      setEditing(false);
    } catch (error) {
      Alert.alert(
        "Save failed",
        `Could not update patient. Error: ${(error as Error).message}`,
      );
    }
  };

  const openConsultation = useCallback(
    (item: ConsultationIndexRow) => {
      router.push(`/patient/${patientId}/consultation/${item.id}`);
    },
    [patientId, router],
  );

  const renderConsultation = useCallback(
    ({ item }: { item: ConsultationIndexRow }) => (
      <ConsultationListItem
        item={item}
        onOpen={openConsultation}
        onDelete={confirmDeleteConsultation}
        dangerColor={colors.danger}
      />
    ),
    [openConsultation, confirmDeleteConsultation, colors.danger],
  );

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (!patient) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Text className="text-base text-slate-700 dark:text-slate-200">Patient not found.</Text>
      </SafeAreaView>
    );
  }

  const header = (
    <View>
      <View className="bg-white rounded-2xl p-4 shadow-sm mb-4 dark:bg-slate-900">
        <View className="flex-row items-center mb-4">
          {profilePhotoDisplayUri ? (
            <Image
              source={{ uri: profilePhotoDisplayUri }}
              className="h-20 w-20 rounded-full"
              contentFit="cover"
            />
          ) : (
            <View className="h-20 w-20 rounded-full bg-slate-200 items-center justify-center dark:bg-slate-800">
              <Feather name="user" size={32} color={colors.icon} />
            </View>
          )}
          <View className="ml-4 flex-1">
            {editing ? (
              <TextInput
                value={form.name}
                onChangeText={(text) =>
                  setForm((prev) => ({ ...prev, name: text }))
                }
                className="text-xl font-bold text-slate-900 dark:text-slate-100"
                placeholder="Patient name"
                placeholderTextColor={colors.placeholder}
              />
            ) : (
              <Text className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {patient.name}
              </Text>
            )}
            <Text className="text-sm text-slate-500 dark:text-slate-400">
              Last updated {new Date(patient.updatedAt).toLocaleString()}
            </Text>
          </View>
          <Pressable
            onPress={() => setEditing((prev) => !prev)}
            className="p-2"
            accessibilityLabel="Edit patient"
          >
            <Feather name="edit-2" size={20} color={colors.iconStrong} />
          </Pressable>
        </View>

        {editing ? (
          <View>
            {/* The EMR identifies this patient's folder, index row, and every consultation,
                so it is shown but never editable. */}
            <View className="mb-3">
              <Text className="text-sm text-slate-600 mb-1 dark:text-slate-400">
                EMR Number
              </Text>
              <View className="flex-row items-center justify-between bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 dark:bg-slate-800 dark:border-slate-700">
                <Text className="text-slate-500 dark:text-slate-400">
                  {formatEmrNumberForDisplay(patient.emrNumber)}
                </Text>
                <Feather name="lock" size={14} color={colors.iconMuted} />
              </View>
              <Text className="text-xs text-slate-400 mt-1 dark:text-slate-500">
                An EMR number can&apos;t be changed once the patient is created.
              </Text>
            </View>

            {[
              {
                label: "Age",
                value: form.age,
                key: "age",
                keyboardType: "number-pad" as const,
              },
              {
                label: "Phone",
                value: form.phone,
                key: "phone",
                keyboardType: "phone-pad" as const,
              },
            ].map((field) => (
              <View key={field.key} className="mb-3">
                <Text className="text-sm text-slate-600 mb-1 dark:text-slate-400">
                  {field.label}
                </Text>
                <TextInput
                  value={field.value}
                  onChangeText={(text) =>
                    setForm((prev) => ({ ...prev, [field.key]: text }))
                  }
                  placeholder="Optional"
                  placeholderTextColor={colors.placeholder}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
                  keyboardType={(field as any).keyboardType ?? "default"}
                />
              </View>
            ))}

            <View className="mb-4">
              <Text className="text-sm text-slate-600 mb-2 dark:text-slate-400">Gender</Text>
              <View className="flex-row flex-wrap">
                {(
                  [
                    { label: "Unspecified", value: "unspecified" },
                    { label: "Male", value: "male" },
                    { label: "Female", value: "female" },
                    { label: "Other", value: "other" },
                  ] as { label: string; value: Gender }[]
                ).map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() =>
                      setForm((prev) => ({ ...prev, gender: option.value }))
                    }
                    className={`px-4 py-2 mr-2 mb-2 rounded-full border ${
                      form.gender === option.value
                        ? "bg-slate-900 border-slate-900 dark:bg-slate-100 dark:border-slate-100"
                        : "border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    <Text
                      className={`text-sm font-semibold ${
                        form.gender === option.value
                          ? "text-white dark:text-slate-900"
                          : "text-slate-800 dark:text-slate-200"
                      }`}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View className="flex-row mb-4">
              <Pressable
                className="bg-slate-900 px-3 py-2 rounded-lg mr-3 dark:bg-slate-100"
                onPress={() => requestPhoto(false)}
              >
                <Text className="text-white font-semibold dark:text-slate-900">Upload photo</Text>
              </Pressable>
              <Pressable
                className="border border-slate-300 px-3 py-2 rounded-lg dark:border-slate-700"
                onPress={() => requestPhoto(true)}
              >
                <Text className="text-slate-800 font-semibold dark:text-slate-200">Camera</Text>
              </Pressable>
            </View>

            <Pressable
              className="bg-slate-900 rounded-xl py-3 items-center dark:bg-slate-100"
              onPress={handleSave}
            >
              <Text className="text-white font-semibold dark:text-slate-900">Save</Text>
            </Pressable>
          </View>
        ) : (
          <View>
            <Text className="text-base text-slate-700 dark:text-slate-200">
              EMR: {formatEmrNumberForDisplay(patient.emrNumber)}
            </Text>
            {patient.age ? (
              <Text className="text-base text-slate-700 dark:text-slate-200">
                Age: {patient.age}
              </Text>
            ) : null}
            {patient.gender ? (
              <Text className="text-base text-slate-700 dark:text-slate-200">
                Gender: {patient.gender}
              </Text>
            ) : null}
            {patient.phone ? (
              <Text className="text-base text-slate-700 dark:text-slate-200">
                Phone: {patient.phone}
              </Text>
            ) : null}
          </View>
        )}
      </View>

      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Consultations
        </Text>
        <View className="flex-row items-center">
          <Pressable
            onPress={() => router.push(`/patient/${patientId}/compare`)}
            disabled={consultations.length === 0}
            style={{ opacity: consultations.length === 0 ? 0.4 : 1 }}
            accessibilityLabel="Compare consultations"
            className="border border-slate-300 px-3 py-2 rounded-lg flex-row items-center mr-2 dark:border-slate-700"
          >
            <Feather name="columns" size={16} color={colors.iconStrong} />
            <Text className="text-slate-800 font-semibold ml-1 dark:text-slate-200">
              Compare
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push(`/patient/${patientId}/consultation/add`)}
            className="bg-slate-900 px-3 py-2 rounded-lg flex-row items-center dark:bg-slate-100"
          >
            <Feather name="plus" size={16} color={isDark ? "#0f172a" : "white"} />
            <Text className="text-white font-semibold ml-1 dark:text-slate-900">Add</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
      <FlashList
        data={consultations}
        keyExtractor={(item) => item.id}
        renderItem={renderConsultation}
        contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View className="bg-white rounded-xl p-4 shadow-sm dark:bg-slate-900">
            <Text className="text-slate-600 dark:text-slate-300">No consultations yet.</Text>
          </View>
        }
        onEndReached={loadMoreConsultations}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? (
            <View className="py-6">
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
