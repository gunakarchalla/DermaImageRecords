import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const SECTIONS: { title: string; body: string }[] = [
  {
    title: "1. License to use",
    body: "Upon purchase of a valid paid license or subscription, you are granted a personal, non-exclusive, non-transferable, revocable right to install and use DermaImageRecords for your own professional use. Continued access to the app requires a valid, active payment.",
  },
  {
    title: "2. Restrictions",
    body: "You may not copy, modify, translate, reverse engineer, decompile, or disassemble the app; and you may not distribute, sublicense, rent, lease, sell, or otherwise make it available to any third party. The source code is confidential and proprietary and may not be copied, reused, or redistributed in whole or in part.",
  },
  {
    title: "3. Ownership",
    body: "The app, its source code, design, and all related intellectual property remain the sole property of the creators. No ownership rights are transferred to you under this license.",
  },
  {
    title: "4. Termination",
    body: "This license terminates automatically if you breach any of these terms or if your payment lapses. On termination you must stop using the app.",
  },
  {
    title: "5. No warranty",
    body: 'The app is provided "as is", without warranties of any kind. It is a documentation aid and does not provide medical advice or diagnosis.',
  },
];

export default function LicenseScreen() {
  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Text className="text-lg font-bold text-slate-900">
          DermaImageRecords — Commercial License
        </Text>
        <Text className="mt-1 text-sm text-slate-500">
          Copyright © 2026 Nikhil Mehta and Gunakar Challa. All rights reserved.
        </Text>

        <Text className="mt-4 text-base leading-6 text-slate-600">
          DermaImageRecords is proprietary, commercial software. Your use of the
          app is governed by the terms below.
        </Text>

        <View className="mt-4 rounded-xl bg-white p-4 shadow-sm">
          {SECTIONS.map((section, index) => (
            <View key={section.title} className={index > 0 ? "mt-4" : ""}>
              <Text className="text-base font-semibold text-slate-900">
                {section.title}
              </Text>
              <Text className="mt-1 text-base leading-6 text-slate-600">
                {section.body}
              </Text>
            </View>
          ))}
        </View>

        <Text className="mt-4 text-xs leading-5 text-slate-400">
          Unauthorized copying, distribution, or use of this software or its
          source code is strictly prohibited.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
