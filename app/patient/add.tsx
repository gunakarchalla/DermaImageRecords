import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { toRenderableImageUriAsync } from "../../services/imageUri";
import { savePatient } from "../../services/storage/storage";
import { Gender } from "../../types/models";

export default function AddPatientScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [emrNumber, setEmrNumber] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<Gender>("unspecified");
  const [phone, setPhone] = useState("");
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | undefined>();
  const [profilePhotoDisplayUri, setProfilePhotoDisplayUri] = useState<
    string | undefined
  >();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const displayUri = await toRenderableImageUriAsync(profilePhotoUri);
        if (!cancelled) setProfilePhotoDisplayUri(displayUri);
      } catch {
        if (!cancelled) setProfilePhotoDisplayUri(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profilePhotoUri]);

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
      setProfilePhotoUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Missing name", "Please enter a patient name.");
      return;
    }

    const ageNumber = Number(age);
    const ageValue = Number.isFinite(ageNumber) ? ageNumber : undefined;

    setSaving(true);
    try {
      const patient = await savePatient(null, {
        name,
        emrNumber,
        age: age ? ageValue : undefined,
        gender,
        phone,
        profilePhotoUri,
      });

      router.replace(`/patient/${patient.id}`);
    } catch (error) {
      Alert.alert(
        "Save failed",
        `Could not save patient. Please try again. Error: ${(error as Error).message}`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-slate-900">Add Patient</Text>
        <Pressable
          onPress={() => router.back()}
          className="p-2"
          accessibilityLabel="Cancel"
        >
          <Feather name="x" size={24} color="#0f172a" />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        <Text className="text-sm text-slate-600 mb-2">Profile photo</Text>
        <View className="flex-row items-center mb-4">
          {profilePhotoDisplayUri ? (
            <Image
              source={{ uri: profilePhotoDisplayUri }}
              className="h-20 w-20 rounded-full"
              contentFit="cover"
            />
          ) : (
            <View className="h-20 w-20 rounded-full bg-slate-200 items-center justify-center">
              <Feather name="user" size={28} color="#475569" />
            </View>
          )}
          <View className="ml-4 flex-row">
            <Pressable
              className="bg-slate-900 px-3 py-2 rounded-lg mr-3"
              onPress={() => requestPhoto(false)}
            >
              <Text className="text-white font-semibold">Upload</Text>
            </Pressable>
            <Pressable
              className="border border-slate-300 px-3 py-2 rounded-lg"
              onPress={() => requestPhoto(true)}
            >
              <Text className="text-slate-800 font-semibold">Camera</Text>
            </Pressable>
          </View>
        </View>

        {[
          {
            label: "Name",
            value: name,
            onChange: setName,
            placeholder: "Patient name",
          },
          {
            label: "EMR Number",
            value: emrNumber,
            onChange: setEmrNumber,
            placeholder: "Optional",
          },
          {
            label: "Age",
            value: age,
            onChange: setAge,
            placeholder: "Years",
            keyboardType: "number-pad" as const,
          },
          {
            label: "Phone",
            value: phone,
            onChange: setPhone,
            placeholder: "Contact number",
            keyboardType: "phone-pad" as const,
          },
        ].map((field) => (
          <View key={field.label} className="mb-4">
            <Text className="text-sm text-slate-600 mb-1">{field.label}</Text>
            <TextInput
              value={field.value}
              onChangeText={field.onChange}
              placeholder={field.placeholder}
              placeholderTextColor="#94a3b8"
              className="bg-white rounded-xl border border-slate-200 px-3 py-2 text-base"
              keyboardType={(field as any).keyboardType ?? "default"}
            />
          </View>
        ))}

        <View className="mb-6">
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
                onPress={() => setGender(option.value)}
                className={`px-4 py-2 mr-2 mb-2 rounded-full border ${
                  gender === option.value
                    ? "bg-slate-900 border-slate-900"
                    : "border-slate-200"
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${gender === option.value ? "text-white" : "text-slate-800"}`}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable
          disabled={saving}
          onPress={handleSave}
          className={`bg-slate-900 rounded-xl py-3 items-center ${saving ? "opacity-70" : ""}`}
        >
          <Text className="text-white text-base font-semibold">Next</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
