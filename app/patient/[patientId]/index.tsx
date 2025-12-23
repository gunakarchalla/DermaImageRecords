import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { toRenderableImageUriAsync } from "../../../lib/imageUri";
import {
  getPatient,
  listConsultations,
  savePatient,
} from "../../../lib/storage";
import { Consultation, Gender, Patient } from "../../../types/models";

export default function PatientDetailsScreen() {
  const router = useRouter();
  const { patientId } = useLocalSearchParams<{ patientId: string }>();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | undefined>();
  const [profilePhotoDisplayUri, setProfilePhotoDisplayUri] = useState<
    string | undefined
  >();
  const [form, setForm] = useState({
    name: "",
    emrNumber: "",
    age: "",
    gender: "unspecified" as Gender,
    phone: "",
  });

  const loadData = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const [patientData, consultationsData] = await Promise.all([
        getPatient(patientId as string),
        listConsultations(patientId as string),
      ]);
      if (patientData) {
        setPatient(patientData);
        setProfilePhotoUri(patientData.profilePhotoUri);

        // Resolve stored SAF/content URIs to a render-safe cache URI.
        try {
          const displayUri = await toRenderableImageUriAsync(
            patientData.profilePhotoUri
          );
          setProfilePhotoDisplayUri(displayUri);
        } catch {
          setProfilePhotoDisplayUri(undefined);
        }

        setForm({
          name: patientData.name,
          emrNumber: patientData.emrNumber ?? "",
          age: patientData.age ? String(patientData.age) : "",
          gender: patientData.gender ?? "unspecified",
          phone: patientData.phone ?? "",
        });
      }
      setConsultations(consultationsData);
    } catch (error) {
      Alert.alert(
        "Load failed",
        `Could not load patient details. Error: ${(error as Error).message}`
      );
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const requestPhoto = async (fromCamera: boolean) => {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        "Permission needed",
        "Please allow camera/photos access to continue."
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
      const pickedUri = result.assets[0].uri;
      setProfilePhotoUri(pickedUri);

      // For previews, normalize any `content://` URIs.
      try {
        const displayUri = await toRenderableImageUriAsync(pickedUri);
        setProfilePhotoDisplayUri(displayUri);
      } catch {
        setProfilePhotoDisplayUri(pickedUri);
      }
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
      const updated = await savePatient(patientId as string, {
        name: form.name,
        emrNumber: form.emrNumber,
        age: form.age ? ageValue : undefined,
        gender: form.gender,
        phone: form.phone,
        profilePhotoUri,
      });
      setPatient(updated);
      setEditing(false);
    } catch (error) {
      Alert.alert(
        "Save failed",
        `Could not update patient. Error: ${(error as Error).message}`
      );
    }
  };

  const renderConsultation = ({ item }: { item: Consultation }) => (
    <Pressable
      onPress={() =>
        router.push(`/patient/${patientId}/consultation/${item.id}`)
      }
      className="bg-white rounded-xl p-3 mb-3 shadow-sm"
    >
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-base font-semibold text-slate-900">
          Consultation
        </Text>
        <Text className="text-xs text-slate-500">
          {new Date(item.updatedAt).toLocaleDateString()}
        </Text>
      </View>
      <Text className="text-sm text-slate-700" numberOfLines={2}>
        {item.remarks || "No remarks"}
      </Text>
      <Text className="text-xs text-slate-400 mt-2">
        Photos: {item.photoUris.length}
      </Text>
    </Pressable>
  );

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  if (!patient) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-slate-50">
        <Text className="text-base text-slate-700">Patient not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      >
        <View className="bg-white rounded-2xl p-4 shadow-sm mb-4">
          <View className="flex-row items-center mb-4">
            {profilePhotoDisplayUri ? (
              <Image
                source={{ uri: profilePhotoDisplayUri }}
                className="h-20 w-20 rounded-full"
                contentFit="cover"
              />
            ) : (
              <View className="h-20 w-20 rounded-full bg-slate-200 items-center justify-center">
                <Feather name="user" size={32} color="#475569" />
              </View>
            )}
            <View className="ml-4 flex-1">
              {editing ? (
                <TextInput
                  value={form.name}
                  onChangeText={(text) =>
                    setForm((prev) => ({ ...prev, name: text }))
                  }
                  className="text-xl font-bold text-slate-900"
                  placeholder="Patient name"
                />
              ) : (
                <Text className="text-xl font-bold text-slate-900">
                  {patient.name}
                </Text>
              )}
              <Text className="text-sm text-slate-500">
                Last updated {new Date(patient.updatedAt).toLocaleString()}
              </Text>
            </View>
            <Pressable
              onPress={() => setEditing((prev) => !prev)}
              className="p-2"
              accessibilityLabel="Edit patient"
            >
              <Feather name="edit-2" size={20} color="#0f172a" />
            </Pressable>
          </View>

          {editing ? (
            <View>
              {[
                {
                  label: "EMR Number",
                  value: form.emrNumber,
                  key: "emrNumber",
                },
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
                  <Text className="text-sm text-slate-600 mb-1">
                    {field.label}
                  </Text>
                  <TextInput
                    value={field.value}
                    onChangeText={(text) =>
                      setForm((prev) => ({ ...prev, [field.key]: text }))
                    }
                    placeholder="Optional"
                    placeholderTextColor="#94a3b8"
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"
                    keyboardType={(field as any).keyboardType ?? "default"}
                  />
                </View>
              ))}

              <View className="mb-4">
                <Text className="text-sm text-slate-600 mb-2">Gender</Text>
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
                          ? "bg-slate-900 border-slate-900"
                          : "border-slate-200"
                      }`}
                    >
                      <Text
                        className={`text-sm font-semibold ${
                          form.gender === option.value
                            ? "text-white"
                            : "text-slate-800"
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
                  className="bg-slate-900 px-3 py-2 rounded-lg mr-3"
                  onPress={() => requestPhoto(false)}
                >
                  <Text className="text-white font-semibold">Upload photo</Text>
                </Pressable>
                <Pressable
                  className="border border-slate-300 px-3 py-2 rounded-lg"
                  onPress={() => requestPhoto(true)}
                >
                  <Text className="text-slate-800 font-semibold">Camera</Text>
                </Pressable>
              </View>

              <Pressable
                className="bg-slate-900 rounded-xl py-3 items-center"
                onPress={handleSave}
              >
                <Text className="text-white font-semibold">Save</Text>
              </Pressable>
            </View>
          ) : (
            <View>
              {patient.emrNumber ? (
                <Text className="text-base text-slate-700">
                  EMR: {patient.emrNumber}
                </Text>
              ) : null}
              {patient.age ? (
                <Text className="text-base text-slate-700">
                  Age: {patient.age}
                </Text>
              ) : null}
              {patient.gender ? (
                <Text className="text-base text-slate-700">
                  Gender: {patient.gender}
                </Text>
              ) : null}
              {patient.phone ? (
                <Text className="text-base text-slate-700">
                  Phone: {patient.phone}
                </Text>
              ) : null}
            </View>
          )}
        </View>

        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-lg font-semibold text-slate-900">
            Consultations
          </Text>
          <Pressable
            onPress={() =>
              router.push(`/patient/${patientId}/consultation/add`)
            }
            className="bg-slate-900 px-3 py-2 rounded-lg flex-row items-center"
          >
            <Feather name="plus" size={16} color="white" />
            <Text className="text-white font-semibold ml-1">Add</Text>
          </Pressable>
        </View>

        {consultations.length === 0 ? (
          <View className="bg-white rounded-xl p-4 shadow-sm">
            <Text className="text-slate-600">No consultations yet.</Text>
          </View>
        ) : (
          <FlatList
            data={consultations}
            keyExtractor={(item) => item.id}
            renderItem={renderConsultation}
            scrollEnabled={false}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
