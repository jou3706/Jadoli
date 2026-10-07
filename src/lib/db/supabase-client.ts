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
      storageKey: "jadwali_sb_session",
    },
  });
  return client;
}

/**
 * The signed-in student's token, for a server route to read their own stored
 * files with. Empty when the app runs local-first, which is also when there is
 * no bucket and therefore no uploaded file to read.
 */
export async function authHeader(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) return {};
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
