import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let tried = false;

/**
 * Browser Supabase client, or `null` when the app runs local-first.
 * Safe to call during render: the URL and anon key are public by design.
 */
export function getSupabase(): SupabaseClient | null {
  if (tried) return client;
  tried = true;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "jadoli_sb_session",
    },
  });
  return client;
}
