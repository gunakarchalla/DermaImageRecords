import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../services/auth/AuthProvider";
import { SignInCancelledError } from "../../services/auth/googleSignIn";
import { useSettings } from "../../services/preferences/SettingsProvider";

export default function SignInScreen() {
  const { signInWithGoogle } = useAuth();
  const { theme } = useSettings();
  const isDark = theme === "dark";
  // Button is dark in light mode / light in dark mode, so its content inverts.
  const buttonContentColor = isDark ? "#0f172a" : "#ffffff";
  const [signingIn, setSigningIn] = useState(false);

  const onSignIn = useCallback(async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
      // On success, AuthProvider flips isSignedIn and the root guard swaps in
      // the app — no manual navigation needed here.
    } catch (error) {
      if (error instanceof SignInCancelledError) return; // user backed out
      Alert.alert("Sign-in failed", (error as Error).message);
    } finally {
      setSigningIn(false);
    }
  }, [signInWithGoogle]);

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
      <View className="flex-1 items-center justify-center px-8">
        <Image
          source={require("../../assets/images/icon.png")}
          style={{ width: 96, height: 96, borderRadius: 20 }}
          contentFit="contain"
        />
        <Text className="mt-6 text-2xl font-bold text-slate-900 dark:text-slate-100">
          DermaImageRecords
        </Text>
        <Text className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
          Sign in to access your patient records. Data is stored on this device
          and synced only to your own Google Drive if you enable it.
        </Text>

        <Pressable
          onPress={onSignIn}
          disabled={signingIn}
          className={`mt-10 h-12 w-full flex-row items-center justify-center rounded-lg bg-slate-900 dark:bg-slate-100 ${
            signingIn ? "opacity-50" : ""
          }`}
        >
          {signingIn ? (
            <ActivityIndicator size="small" color={buttonContentColor} />
          ) : (
            <>
              <Feather name="log-in" size={18} color={buttonContentColor} />
              <Text className="ml-2 text-base font-semibold text-white dark:text-slate-900">
                Continue with Google
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
