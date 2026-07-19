import { Linking, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const CONTACT_EMAIL = "challa@gunakar.dev";

const SECTIONS: { title: string; body: string }[] = [
  {
    title: "Information you provide",
    body: "When you set up and use DermaImageRecords, we may collect basic details about you, such as your name, the hospital or clinic you work at, your age, and similar profile information.",
  },
  {
    title: "Analytics & diagnostics (optional)",
    body: "If you choose to share it, we may collect analytical and diagnostic data — such as crash reports and usage statistics — to help us fix bugs and improve the app. This is optional and only collected with your consent.",
  },
  {
    title: "Patient & consultation data stays with you",
    body: "All patient records, consultation notes, and clinical images you create are stored locally on your phone. This data never reaches us, and the creators of DermaImageRecords have no access to it.",
  },
  {
    title: "Sync uses your own Google Drive",
    body: "If you turn on sync, your records are mirrored to a DermaImageRecords folder in your own Google Drive account — never to our servers, because we don't have any. The app can only see files it created itself (Google's most limited Drive permission). Deleted records go to your Drive trash, where Google keeps them for about 30 days.",
  },
  {
    title: "If you revoke the app's Drive access",
    body: "Removing DermaImageRecords from your Google account's connected apps permanently cuts its access to the files it previously uploaded — even if you reconnect later. Your data is safe in Drive and on your devices; after reconnecting, the next sync uploads a fresh copy from any device that still holds the records.",
  },
  {
    title: "How we use information",
    body: "We use the details you provide to operate the app, and we use any diagnostic data you share solely to maintain and improve it. We do not sell your data.",
  },
];

export default function PrivacyPolicyScreen() {
  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Text className="text-sm text-slate-500 dark:text-slate-400">Last updated: 19 July 2026</Text>

        <Text className="mt-3 text-base leading-6 text-slate-600 dark:text-slate-300">
          Your privacy — and your patients&apos; privacy — matters to us. This
          policy explains what we collect and, just as importantly, what we
          don&apos;t.
        </Text>

        <View className="mt-4 rounded-xl bg-white p-4 shadow-sm dark:bg-slate-900">
          {SECTIONS.map((section, index) => (
            <View key={section.title} className={index > 0 ? "mt-4" : ""}>
              <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {section.title}
              </Text>
              <Text className="mt-1 text-base leading-6 text-slate-600 dark:text-slate-300">
                {section.body}
              </Text>
            </View>
          ))}
        </View>

        <Text className="mt-4 text-base leading-6 text-slate-600 dark:text-slate-300">
          Questions about this policy? Email{" "}
          <Text
            className="font-semibold text-[#0A66C2]"
            onPress={() =>
              Linking.openURL(
                `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
                  "Privacy question",
                )}`,
              )
            }
          >
            {CONTACT_EMAIL}
          </Text>
          .
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
