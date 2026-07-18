import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useColorScheme } from "nativewind";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native";

import { Section } from "../../components/ui/Section";
import { useDatasetFocusRefresh } from "../../hooks/useDatasetFocusRefresh";
import { useResolvedImageUri } from "../../hooks/useResolvedImageUri";
import { useThemeColors } from "../../hooks/useThemeColors";
import {
  readClinicProfileAsync,
  saveClinicProfileAsync,
} from "../../services/clinic/clinicStore";

/**
 * The clinic letterhead editor on the Account screen. The profile lives in the dataset
 * (clinic.json + logo), so it syncs to other devices and appears on PDF reports.
 */
export function ClinicProfileSection() {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  const [form, setForm] = useState({
    name: "",
    address: "",
    phone: "",
    email: "",
    doctorName: "",
    department: "",
  });
  const [logoUri, setLogoUri] = useState<string | undefined>();
  const [pickedLogoUri, setPickedLogoUri] = useState<string | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const logoDisplayUri = useResolvedImageUri(pickedLogoUri ?? logoUri);

  const load = useCallback(async () => {
    try {
      const profile = await readClinicProfileAsync();
      setForm({
        name: profile?.name ?? "",
        address: profile?.address ?? "",
        phone: profile?.phone ?? "",
        email: profile?.email ?? "",
        doctorName: profile?.doctorName ?? "",
        department: profile?.department ?? "",
      });
      setLogoUri(profile?.logoUri);
      setPickedLogoUri(undefined);
    } catch {
      // A missing/corrupt profile just means an empty form.
    } finally {
      setLoaded(true);
    }
  }, []);

  useDatasetFocusRefresh(load);

  const pickLogo = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Please allow photos access to pick a logo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images" as ImagePicker.MediaType,
      quality: 1,
    });
    if (!result.canceled && result.assets?.length) {
      setPickedLogoUri(result.assets[0].uri);
    }
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const saved = await saveClinicProfileAsync({
        ...form,
        logoSourceUri: pickedLogoUri,
      });
      setLogoUri(saved.logoUri);
      setPickedLogoUri(undefined);
      Alert.alert("Saved", "Your clinic details will appear on PDF reports.");
    } catch (error) {
      Alert.alert("Save failed", (error as Error).message);
    } finally {
      setSaving(false);
    }
  }, [form, pickedLogoUri]);

  const fields: { key: keyof typeof form; label: string; placeholder: string; keyboardType?: "phone-pad" | "email-address" }[] = [
    { key: "name", label: "Clinic / hospital name", placeholder: "e.g. Skin & Care Clinic" },
    { key: "address", label: "Address", placeholder: "Street, city" },
    { key: "phone", label: "Phone", placeholder: "Contact number", keyboardType: "phone-pad" },
    { key: "email", label: "Email", placeholder: "clinic@example.com", keyboardType: "email-address" },
    { key: "doctorName", label: "Doctor name", placeholder: "e.g. Dr. A. Sharma" },
    { key: "department", label: "Department", placeholder: "e.g. Dermatology" },
  ];

  return (
    <Section
      icon="briefcase"
      title="Clinic profile"
      subtitle="Shown as the letterhead on shared PDF reports. Synced with your other devices."
    >
      {!loaded ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : (
        <View>
          <View className="mb-4 flex-row items-center">
            {logoDisplayUri ? (
              <Image
                source={{ uri: logoDisplayUri }}
                style={{ width: 56, height: 56, borderRadius: 8 }}
                contentFit="contain"
              />
            ) : (
              <View className="h-14 w-14 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                <Feather name="image" size={22} color={colors.icon} />
              </View>
            )}
            <Pressable
              onPress={() => void pickLogo()}
              className="ml-4 rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700"
            >
              <Text className="font-semibold text-slate-800 dark:text-slate-200">
                {logoUri || pickedLogoUri ? "Change logo" : "Add logo"}
              </Text>
            </Pressable>
          </View>

          {fields.map((field) => (
            <View key={field.key} className="mb-3">
              <Text className="mb-1 text-sm text-slate-600 dark:text-slate-400">{field.label}</Text>
              <TextInput
                value={form[field.key]}
                onChangeText={(text) => setForm((prev) => ({ ...prev, [field.key]: text }))}
                placeholder={field.placeholder}
                placeholderTextColor={colors.placeholder}
                keyboardType={field.keyboardType ?? "default"}
                autoCapitalize={field.key === "email" ? "none" : "sentences"}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </View>
          ))}

          <Pressable
            onPress={() => void save()}
            disabled={saving}
            className={`mt-1 h-11 items-center justify-center rounded-xl bg-slate-900 dark:bg-slate-100 ${
              saving ? "opacity-60" : ""
            }`}
          >
            {saving ? (
              <ActivityIndicator size="small" color={isDark ? "#0f172a" : "#ffffff"} />
            ) : (
              <Text className="font-semibold text-white dark:text-slate-900">Save clinic details</Text>
            )}
          </Pressable>
        </View>
      )}
    </Section>
  );
}
