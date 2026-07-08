import {
    GoogleSignin,
    isErrorWithCode,
    isSuccessResponse,
    statusCodes,
} from "@react-native-google-signin/google-signin";

import { supabase } from "./supabaseClient";
import { googleWebClientId } from "./authConfig";

// Configure once at module load. webClientId is required so signIn() returns an
// idToken; Supabase's signInWithIdToken validates that token against the same
// Google web client registered in the Supabase Google provider.
GoogleSignin.configure({
    webClientId: googleWebClientId,
});

/** Thrown when the user dismisses the Google account picker — callers ignore it. */
export class SignInCancelledError extends Error {
    constructor() {
        super("Sign-in was cancelled.");
        this.name = "SignInCancelledError";
    }
}

/**
 * Runs the native Google Sign-In flow and exchanges the resulting ID token for a
 * Supabase session. On success, supabase.auth.onAuthStateChange fires and the
 * AuthProvider updates — this function doesn't need to return the session.
 */
export async function signInWithGoogleAsync(): Promise<void> {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    let idToken: string | null | undefined;
    try {
        const response = await GoogleSignin.signIn();
        if (!isSuccessResponse(response)) {
            // Cancelled (no exception path on some versions).
            throw new SignInCancelledError();
        }
        idToken = response.data.idToken;
    } catch (error) {
        if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) {
            throw new SignInCancelledError();
        }
        throw error;
    }

    if (!idToken) {
        throw new Error("Google did not return an ID token. Check the web client ID.");
    }

    const { error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: idToken,
    });
    if (error) throw error;
}

/** Signs out of both Google and Supabase. Google sign-out is best-effort. */
export async function signOutAsync(): Promise<void> {
    try {
        await GoogleSignin.signOut();
    } catch {
        // A failed Google sign-out shouldn't block clearing the Supabase session.
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
}
