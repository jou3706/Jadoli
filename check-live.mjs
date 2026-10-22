import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync("D:/jadoli/.env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshSession: false },
});

for (const fn of ["exec_sql", "execute_sql", "run_sql", "sql", "query", "exec", "pg_cron"]) {
  const { error } = await sb.rpc(fn, { sql: "select 1", query: "select 1" });
  console.log(`${fn}: ${error ? error.code + " " + error.message : "EXISTS"}`);
}

// What the database actually exposes, as far as the API can see.
const { data } = await sb.rpc("get_secret", { p_name: "x" });
console.log("---");
console.log("schemas:", await sb.schema("pg_catalog").from("tables").select("*").limit(0).then((r) => (r.error ? r.error.code : "visible")));
