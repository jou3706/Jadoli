"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DB_NAME, getBackend } from "./store";
import { getSupabase } from "./supabase-client";

export type Session = {
  email: string;
  fullName: string;
  id: string;
};

type AuthState = {
  session: Session | null;
  isLoading: boolean;
  authError: { type: "auth_required" | "user_not_registered" | string } | null;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Hands the browser to Google and back. Supabase only: OAuth needs a hosted
   * project to hold the Google client id/secret.
   */
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  requestReset: (email: string) => Promise<string>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  /** Local mode is a demo gate; Supabase mode is a real account system. */
  mode: "local" | "supabase";
};

const ACCOUNTS_KEY = "jadoli_accounts";
const SESSION_KEY = "jadoli_session";
const RESETS_KEY = "jadoli_resets";

type StoredAccount = Session & { hash: string; created: number };

const AuthContext = createContext<AuthState | null>(null);

async function hashPassword(pw: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    // Non-secure fallback; only reachable in environments without WebCrypto.
    let h = 0;
    for (let i = 0; i < pw.length; i++) h = (h * 31 + pw.charCodeAt(i)) | 0;
    return `fb$${h}`;
  }
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const mode: "local" | "supabase" = DB_NAME();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [authError] = useState<AuthState["authError"]>(null);

  /* Supabase owns the account; mirror its session into the app. */
  useEffect(() => {
    if (mode !== "supabase") return;
    const sb = getSupabase();
    if (!sb) return;
    let alive = true;
    const apply = (user: {
      id: string;
      email?: string | null;
      user_metadata?: Record<string, unknown>;
    } | null) => {
      if (!alive) return;
      const b = getBackend();
      if (!user) {
        b.attachSession?.(null);
        b.attachUser?.(null);
        setSession(null);
        return;
      }
      void sb.auth.getSession().then(({ data }) => {
        if (!alive) return;
        b.attachSession?.(data.session?.access_token ?? null);
        b.attachUser?.(user.id);
        setSession({
          id: user.id,
          email: user.email ?? "",
          fullName:
            (user.user_metadata?.full_name as string | undefined) ??
            (user.email ?? "").split("@")[0],
        });
      });
    };
    void sb.auth
      .getUser()
      .then(({ data }) => apply(data.user))
      .finally(() => {
        if (alive) setLoading(false);
      });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) =>
      apply(s?.user ?? null),
    );
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [mode]);

  useEffect(() => {
    if (mode === "supabase") return;
    const stored = readJson<Session | null>(SESSION_KEY, null);
    if (stored) {
      // A session only counts if its account still exists (local mode).
      const accounts = readJson<StoredAccount[]>(ACCOUNTS_KEY, []);
      if (accounts.some((a) => a.email === stored.email)) {
        setSession(stored);
      } else {
        writeJson(SESSION_KEY, null);
      }
    }
    setLoading(false);
  }, [mode]);

  const signUp = useCallback(
    async (email: string, password: string, fullName: string) => {
      if (mode === "supabase") {
        const sb = getSupabase();
        if (!sb) throw new Error("Supabase is not configured");
        const { data, error } = await sb.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (error) throw new Error(error.message);
        if (!data.session) {
          throw new Error("Check your email to confirm the account");
        }
        return;
      }
      const accounts = readJson<StoredAccount[]>(ACCOUNTS_KEY, []);
      const key = email.trim().toLowerCase();
      if (accounts.some((a) => a.email === key)) {
        throw new Error("An account with this email already exists");
      }
      const account: StoredAccount = {
        id: `u_${Date.now()}`,
        email: key,
        fullName: fullName.trim() || key.split("@")[0],
        hash: await hashPassword(password),
        created: Date.now(),
      };
      writeJson(ACCOUNTS_KEY, [...accounts, account]);
      const s: Session = {
        id: account.id,
        email: account.email,
        fullName: account.fullName,
      };
      writeJson(SESSION_KEY, s);
      setSession(s);
    },
    [mode],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (mode === "supabase") {
        const sb = getSupabase();
        if (!sb) throw new Error("Supabase is not configured");
        const { error } = await sb.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) throw new Error(error.message);
        return;
      }
      const accounts = readJson<StoredAccount[]>(ACCOUNTS_KEY, []);
      const key = email.trim().toLowerCase();
      const account = accounts.find((a) => a.email === key);
      if (!account) throw new Error("No account found for this email");
      if (account.hash !== (await hashPassword(password))) {
        throw new Error("Incorrect password");
      }
      const s: Session = {
        id: account.id,
        email: account.email,
        fullName: account.fullName,
      };
      writeJson(SESSION_KEY, s);
      setSession(s);
    },
    [mode],
  );

  const signInWithGoogle = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) {
      throw new Error(
        "Google sign-in needs a Supabase project: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
      );
    }
    // Supabase redirects the whole page, so nothing follows this call.
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    if (mode === "supabase") {
      await getSupabase()?.auth.signOut();
      return;
    }
    writeJson(SESSION_KEY, null);
    setSession(null);
  }, [mode]);

  const requestReset = useCallback(
    async (email: string) => {
      if (mode === "supabase") {
        const sb = getSupabase();
        if (!sb) throw new Error("Supabase is not configured");
        const origin =
          typeof window === "undefined" ? "" : window.location.origin;
        const { error } = await sb.auth.resetPasswordForEmail(
          email.trim().toLowerCase(),
          { redirectTo: `${origin}/reset-password` },
        );
        if (error) throw new Error(error.message);
        return "";
      }
      const accounts = readJson<StoredAccount[]>(ACCOUNTS_KEY, []);
      const key = email.trim().toLowerCase();
      const account = accounts.find((a) => a.email === key);
      if (!account) throw new Error("No account found for this email");
      // The token carries the account id so the reset form knows who it is for.
      const token = `${account.id}.${crypto.randomUUID()}`;
      const resets = readJson<Record<string, number>>(RESETS_KEY, {});
      resets[token] = Date.now() + 30 * 60 * 1000;
      writeJson(RESETS_KEY, resets);
      return token;
    },
    [mode],
  );

  const resetPassword = useCallback(
    async (token: string, newPassword: string) => {
      if (mode === "supabase") {
        const sb = getSupabase();
        if (!sb) throw new Error("Supabase is not configured");
        // The recovery link lands here with a session already established.
        const { error } = await sb.auth.updateUser({ password: newPassword });
        if (error) throw new Error(error.message);
        return;
      }
      const resets = readJson<Record<string, number>>(RESETS_KEY, {});
      const exp = resets[token];
      if (!exp || exp < Date.now()) {
        throw new Error("This password reset link is invalid or has expired");
      }
      const [accountId] = token.split(".");
      const accounts = readJson<StoredAccount[]>(ACCOUNTS_KEY, []);
      const target = accounts.find((a) => a.id === accountId);
      if (!target) {
        throw new Error("This password reset link is invalid");
      }
      const nextHash = await hashPassword(newPassword);
      writeJson(
        ACCOUNTS_KEY,
        accounts.map((a) =>
          a.id === accountId ? { ...a, hash: nextHash } : a,
        ),
      );
      delete resets[token];
      writeJson(RESETS_KEY, resets);
    },
    [mode],
  );

  const value = useMemo<AuthState>(
    () => ({
      session,
      isLoading,
      authError,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      requestReset,
      resetPassword,
      mode,
    }),
    [session, isLoading, authError, signUp, signIn, signInWithGoogle, signOut, requestReset, resetPassword, mode],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
