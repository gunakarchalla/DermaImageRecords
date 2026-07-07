import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import { Image } from "expo-image";
import type { ComponentProps } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type FeatherName = ComponentProps<typeof Feather>["name"];

const FEATURES: { icon: FeatherName; text: string }[] = [
  { icon: "camera", text: "Capture clinical images during consultations" },
  { icon: "folder", text: "Organize photos by patient and consultation" },
  {
    icon: "layers",
    text: "Compare images across visits to track progression",
  },
  { icon: "smartphone", text: "All records stay on your device" },
];

export default function AboutScreen() {
  const version = Constants.expoConfig?.version ?? "1.0.0";

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <View className="items-center">
          <Image
            source={require("../../../assets/images/icon.png")}
            className="h-20 w-20 rounded-2xl"
            contentFit="cover"
          />
          <Text className="mt-3 text-2xl font-bold text-slate-900">
            DermaImageRecords
          </Text>
          <Text className="mt-1 text-sm text-slate-500">Version {version}</Text>
        </View>

        <Text className="mt-6 text-base font-semibold text-slate-900">
          A clinical imaging companion for dermatologists.
        </Text>

        <Text className="mt-3 text-base leading-6 text-slate-600">
          DermaImageRecords helps dermatologists capture, organize, and revisit
          clinical images from patient consultations.
        </Text>
        <Text className="mt-3 text-base leading-6 text-slate-600">
          During a consultation you can photograph skin findings directly in the
          app and keep them grouped under the right patient and visit — building
          a structured visual record that grows over time.
        </Text>
        <Text className="mt-3 text-base leading-6 text-slate-600">
          Because skin conditions evolve, the app makes it easy to compare images
          across consultations, so you can track how a condition changes between
          visits and assess the response to treatment.
        </Text>

        <View className="mt-6 rounded-xl bg-white p-4 shadow-sm">
          {FEATURES.map((feature, index) => (
            <View
              key={feature.text}
              className={`flex-row items-center ${index > 0 ? "mt-4" : ""}`}
            >
              <View className="h-9 w-9 items-center justify-center rounded-full bg-slate-100">
                <Feather name={feature.icon} size={18} color="#0f172a" />
              </View>
              <Text className="ml-3 flex-1 text-base text-slate-700">
                {feature.text}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
