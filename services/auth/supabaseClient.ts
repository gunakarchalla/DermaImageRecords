// URL polyfill must be imported before supabase-js touches the URL global on RN.
import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState } from "react-native";

import { supabaseAnonKey, supabaseUrl } from "./authConfig";

// Single Supabase client for the app. The session is persisted in AsyncStorage
// so it survives restarts and is readable offline — getSession() resolves from
// local storage without a network round-trip, which is what lets the login gate
// keep working with no signal (see AuthProvider).
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        // We use native Google Sign-In (ID token), not a web redirect, so there
        // is never an OAuth code in a URL to detect.
        detectSessionInUrl: false,
    },
});

// Per Supabase's React Native guidance: only refresh tokens while the app is in
// the foreground. Registered once at module load.
AppState.addEventListener("change", (state) => {
    if (state === "active") {
        void supabase.auth.startAutoRefresh();
    } else {
        void supabase.auth.stopAutoRefresh();
    }
});
