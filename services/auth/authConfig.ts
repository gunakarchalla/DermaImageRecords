import Constants from "expo-constants";

// Auth config lives in app.json `extra` (client-safe values only: the Supabase
// URL, the *publishable/anon* key, and Google OAuth client IDs). The Supabase
// secret / service_role key must NEVER be shipped in the client — it bypasses
// Row-Level Security. Read via expo-constants, mirroring the version lookup in
// app/(drawer)/info/about.tsx.

type AuthExtra = {
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    googleWebClientId?: string;
    googleAndroidClientId?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as AuthExtra;

function required(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(
            `Missing "${name}" in app.json > expo.extra. Auth cannot be initialized.`,
        );
    }
    return value;
}

export const supabaseUrl = required(extra.supabaseUrl, "supabaseUrl");
export const supabaseAnonKey = required(extra.supabaseAnonKey, "supabaseAnonKey");
// webClientId is what @react-native-google-signin uses to mint the ID token that
// Supabase validates in signInWithIdToken. The Android client ID is matched by
// Google Play services via package name + SHA-1, so it isn't passed in code —
// kept here only for reference/visibility.
export const googleWebClientId = required(extra.googleWebClientId, "googleWebClientId");
