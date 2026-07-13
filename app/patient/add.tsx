import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { GenderPicker } from "../../components/ui/GenderPicker";
import { useResolvedImageUri } from "../../hooks/useResolvedImageUri";
import { useThemeColors } from "../../hooks/useThemeColors";
import {
  canonicalizeEmrNumber,
  emrDisplayMaxLength,
  EmrNumberTakenError,
  formatEmrNumberForDisplay,
  generateEmrNumberAsync,
  stripEmrDisplaySpacing,
  validateEmrNumber,
} from "../../services/patient/emr";
import { createPatientAsync } from "../../services/storage/storage";
import { Gender } from "../../types/models";

export default function AddPatientScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const [name, setName] = useState("");
  // Held unspaced, exactly as it will be canonicalized. The field below only *shows* it grouped.
  const [emrNumber, setEmrNumber] = useState("");
  const [emrError, setEmrError] = useState<string | null>(null);
  const [generatingEmr, setGeneratingEmr] = useState(false);
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<Gender>("unspecified");
  const [phone, setPhone] = useState("");
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | undefined>();
  const profilePhotoDisplayUri = useResolvedImageUri(profilePhotoUri);
  const [saving, setSaving] = useState(false);

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

  const handleGenerateEmr = async () => {
    setGeneratingEmr(true);
    try {
      setEmrNumber(await generateEmrNumberAsync());
      setEmrError(null);
    } catch (error) {
      Alert.alert("Couldn't generate a number", (error as Error).message);
    } finally {
      setGeneratingEmr(false);
    }
  };

  const handleSave = async () => {
    // The EMR becomes this patient's identity and can't be changed afterwards, so it is
    // validated before anything else and reported inline rather than in an alert.
    const canonicalEmr = canonicalizeEmrNumber(emrNumber);
    const emrProblem = validateEmrNumber(canonicalEmr);
    if (emrProblem) {
      setEmrError(emrProblem);
      return;
    }

    if (!name.trim()) {
      Alert.alert("Missing name", "Please enter a patient name.");
      return;
    }

    const ageNumber = Number(age);
    const ageValue = Number.isFinite(ageNumber) ? ageNumber : undefined;

    setSaving(true);
    try {
      const patient = await createPatientAsync({
        emrNumber: canonicalEmr,
        name,
        age: age ? ageValue : undefined,
        gender,
        phone,
        profilePhotoUri,
      });

      router.replace(`/patient/${patient.id}`);
    } catch (error) {
      if (error instanceof EmrNumberTakenError) {
        setEmrError(error.message);
        return;
      }
      Alert.alert(
        "Save failed",
        `Could not save patient. Please try again. Error: ${(error as Error).message}`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100">Add Patient</Text>
        <Pressable
          onPress={() => router.back()}
          className="p-2"
          accessibilityLabel="Cancel"
        >
          <Feather name="x" size={24} color={colors.iconStrong} />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        <Text className="text-sm text-slate-600 mb-2 dark:text-slate-400">Profile photo</Text>
        <View className="flex-row items-center mb-4">
          {profilePhotoDisplayUri ? (
            <Image
              source={{ uri: profilePhotoDisplayUri }}
              className="h-20 w-20 rounded-full"
              contentFit="cover"
            />
          ) : (
            <View className="h-20 w-20 rounded-full bg-slate-200 items-center justify-center dark:bg-slate-800">
              <Feather name="user" size={28} color={colors.icon} />
            </View>
          )}
          <View className="ml-4 flex-row">
            <Pressable
              className="bg-slate-900 px-3 py-2 rounded-lg mr-3 dark:bg-slate-100"
              onPress={() => requestPhoto(false)}
            >
              <Text className="text-white font-semibold dark:text-slate-900">Upload</Text>
            </Pressable>
            <Pressable
              className="border border-slate-300 px-3 py-2 rounded-lg dark:border-slate-700"
              onPress={() => requestPhoto(true)}
            >
              <Text className="text-slate-800 font-semibold dark:text-slate-200">Camera</Text>
            </Pressable>
          </View>
        </View>

        {/* The EMR identifies the patient everywhere (folder, route, index) and is fixed once
            saved, so it leads the form. Border/error colours are inline `style` rather than
            toggled classes — see the note in app/(drawer)/backup-sync.tsx. */}
        <View className="mb-4">
          <Text className="text-sm text-slate-600 mb-1 dark:text-slate-400">
            EMR Number
          </Text>
          <View
            className="flex-row items-center bg-white rounded-xl border dark:bg-slate-900"
            style={{ borderColor: emrError ? colors.danger : colors.border }}
          >
            <TextInput
              value={formatEmrNumberForDisplay(emrNumber)}
              onChangeText={(text) => {
                // Drop the grouping spaces the field inserted; keep every other character so a
                // stray one still reaches `validateEmrNumber` and is explained to the user.
                setEmrNumber(stripEmrDisplaySpacing(text));
                if (emrError) setEmrError(null);
              }}
              placeholder="Required"
              placeholderTextColor={colors.placeholder}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={emrDisplayMaxLength}
              className="flex-1 px-3 py-2 text-base text-slate-900 dark:text-slate-100"
            />
            <Pressable
              onPress={() => void handleGenerateEmr()}
              disabled={generatingEmr}
              accessibilityLabel="Generate an EMR number"
              className="px-3 py-2"
            >
              {generatingEmr ? (
                <ActivityIndicator size="small" color={colors.icon} />
              ) : (
                <Feather name="refresh-cw" size={18} color={colors.iconStrong} />
              )}
            </Pressable>
          </View>
          <Text
            className="text-xs mt-1"
            style={{ color: emrError ? colors.danger : colors.placeholder }}
          >
            {emrError ??
              "Letters and numbers only. Identifies the patient — it can't be changed later."}
          </Text>
        </View>

        {[
          {
            label: "Name",
            value: name,
            onChange: setName,
            placeholder: "Patient name",
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
            <Text className="text-sm text-slate-600 mb-1 dark:text-slate-400">{field.label}</Text>
            <TextInput
              value={field.value}
              onChangeText={field.onChange}
              placeholder={field.placeholder}
              placeholderTextColor={colors.placeholder}
              className="bg-white rounded-xl border border-slate-200 px-3 py-2 text-base text-slate-900 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              keyboardType={(field as any).keyboardType ?? "default"}
            />
          </View>
        ))}

        <View className="mb-6">
          <Text className="text-sm text-slate-600 mb-2 dark:text-slate-400">Gender</Text>
          <GenderPicker value={gender} onChange={setGender} />
        </View>

        <Pressable
          disabled={saving}
          onPress={handleSave}
          className={`bg-slate-900 rounded-xl py-3 items-center dark:bg-slate-100 ${saving ? "opacity-70" : ""}`}
        >
          <Text className="text-white text-base font-semibold dark:text-slate-900">Next</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
