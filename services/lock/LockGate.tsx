import { Feather } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";

import { useThemeColors } from "../../hooks/useThemeColors";
import { useSettings } from "../preferences/SettingsProvider";

/** Returning within this window doesn't re-lock (quick app switches, share sheets). */
const RELOCK_AFTER_BACKGROUND_MS = 30_000;

/**
 * Biometric/device-credential gate over the whole app. When the "App lock" preference
 * is on, an opaque overlay covers everything on cold start and on returning from the
 * background after a grace period; unlocking runs the system biometric prompt (with
 * device PIN/pattern fallback). Purely a shield — no navigation state is touched.
 */
export function LockGate({ children }: { children: ReactNode }) {
    const colors = useThemeColors();
    const { ready, appLock } = useSettings();

    // Start locked; the effect below immediately unlocks when the preference is off.
    const [locked, setLocked] = useState(true);
    const [authenticating, setAuthenticating] = useState(false);
    const backgroundedAtRef = useRef<number | null>(null);

    const unlock = useCallback(async () => {
        if (authenticating) return;
        setAuthenticating(true);
        try {
            const result = await LocalAuthentication.authenticateAsync({
                promptMessage: "Unlock DermaImageRecords",
                cancelLabel: "Cancel",
            });
            if (result.success) setLocked(false);
        } catch {
            // Stay locked; the user can retry.
        } finally {
            setAuthenticating(false);
        }
    }, [authenticating]);

    // Resolve the cold-start state once preferences load, and prompt right away.
    useEffect(() => {
        if (!ready) return;
        if (!appLock) {
            setLocked(false);
            return;
        }
        setLocked(true);
        void unlock();
        // Run once when preferences become ready (or the preference flips).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, appLock]);

    // Re-lock after a real absence, not a quick app switch.
    useEffect(() => {
        if (!appLock) return;
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "background") {
                backgroundedAtRef.current = Date.now();
            } else if (state === "active" && backgroundedAtRef.current) {
                const away = Date.now() - backgroundedAtRef.current;
                backgroundedAtRef.current = null;
                if (away >= RELOCK_AFTER_BACKGROUND_MS) {
                    setLocked(true);
                    void unlock();
                }
            }
        });
        return () => subscription.remove();
    }, [appLock, unlock]);

    return (
        <View style={StyleSheet.absoluteFill}>
            {children}
            {locked ? (
                <View
                    style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
                    className="items-center justify-center px-8"
                >
                    <View className="h-16 w-16 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800">
                        <Feather name="lock" size={26} color={colors.iconStrong} />
                    </View>
                    <Text className="mt-5 text-lg font-semibold text-slate-900 dark:text-slate-100">
                        DermaImageRecords is locked
                    </Text>
                    <Text className="mt-1 text-center text-sm text-slate-500 dark:text-slate-400">
                        Unlock with your fingerprint, face, or device PIN.
                    </Text>
                    <Pressable
                        onPress={() => void unlock()}
                        disabled={authenticating}
                        accessibilityLabel="Unlock"
                        className="mt-6 h-12 w-full items-center justify-center rounded-xl bg-slate-900 dark:bg-slate-100"
                        style={{ opacity: authenticating ? 0.6 : 1 }}
                    >
                        <Text className="text-base font-semibold text-white dark:text-slate-900">
                            Unlock
                        </Text>
                    </Pressable>
                </View>
            ) : null}
        </View>
    );
}

/**
 * Whether the device can enforce an app lock at all (some security must be enrolled —
 * otherwise the overlay would either lock the user out or wave everyone through).
 */
export const canUseAppLockAsync = async (): Promise<boolean> => {
    try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        const securityLevel = await LocalAuthentication.getEnrolledLevelAsync();
        return (hasHardware && enrolled) || securityLevel !== LocalAuthentication.SecurityLevel.NONE;
    } catch {
        return false;
    }
};
