import type { Session, User } from "@supabase/supabase-js";
import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";

import { signInWithGoogleAsync, signOutAsync } from "./googleSignIn";
import { supabase } from "./supabaseClient";

type AuthContextValue = {
    /** False once the persisted session has been restored (gate the UI on this). */
    loading: boolean;
    session: Session | null;
    user: User | null;
    isSignedIn: boolean;
    signInWithGoogle: () => Promise<void>;
    signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        // getSession() reads from AsyncStorage — resolves offline, no network.
        void supabase.auth.getSession().then(({ data }) => {
            if (cancelled) return;
            setSession(data.session);
            setLoading(false);
        });

        const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            setSession(nextSession);
        });

        return () => {
            cancelled = true;
            sub.subscription.unsubscribe();
        };
    }, []);

    const value = useMemo<AuthContextValue>(
        () => ({
            loading,
            session,
            user: session?.user ?? null,
            isSignedIn: !!session,
            signInWithGoogle: signInWithGoogleAsync,
            signOut: signOutAsync,
        }),
        [loading, session],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error("useAuth must be used within an AuthProvider.");
    }
    return ctx;
};
