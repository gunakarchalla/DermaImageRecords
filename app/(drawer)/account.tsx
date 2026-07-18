import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ClinicProfileSection } from "../../features/clinic/ClinicProfileSection";
import { useThemeColors } from "../../hooks/useThemeColors";
import { useAuth } from "../../services/auth/AuthProvider";

export default function AccountScreen() {
  const colors = useThemeColors();
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const meta = user?.user_metadata ?? {};
  const displayName = (meta.full_name as string) ?? (meta.name as string) ?? "Signed in";
  const email = user?.email ?? "";
  const avatarUrl = (meta.avatar_url as string) ?? (meta.picture as string) ?? undefined;

  const onSignOut = useCallback(() => {
    Alert.alert("Sign out?", "You'll need to sign in again to access your records.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          try {
            await signOut();
            // The root guard swaps to the sign-in screen once the session clears.
          } catch (error) {
            Alert.alert("Sign-out failed", (error as Error).message);
            setSigningOut(false);
          }
        },
      },
    ]);
  }, [signOut]);

  return (
    <SafeAreaView
      edges={["bottom", "left", "right"]}
      className="flex-1 bg-slate-50 dark:bg-slate-950"
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <View className="mb-5 items-center rounded-xl bg-white p-6 shadow-sm dark:bg-slate-900">
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={{ width: 72, height: 72, borderRadius: 36 }}
              contentFit="cover"
            />
          ) : (
            <View className="h-[72px] w-[72px] items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
              <Feather name="user" size={32} color={colors.icon} />
            </View>
          )}
          <Text className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
            {displayName}
          </Text>
          {email ? (
            <Text className="mt-1 text-sm text-slate-500 dark:text-slate-400">{email}</Text>
          ) : null}
        </View>

        <ClinicProfileSection />

        <Pressable
          onPress={onSignOut}
          disabled={signingOut}
          className={`h-12 flex-row items-center justify-center rounded-lg bg-rose-600 dark:bg-rose-500 ${
            signingOut ? "opacity-50" : ""
          }`}
        >
          {signingOut ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Feather name="log-out" size={18} color="#ffffff" />
              <Text className="ml-2 text-base font-semibold text-white">Sign out</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
