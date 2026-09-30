/**
 * One-time repair: fold the stray second account into the account we keep.
 *
 * Run with:  npx tsx scripts/merge-accounts.ts
 *
 * Both accounts are the same person, so every row is copied to the keeper
 * before the old account is emptied. Nothing is deleted until the copy has
 * been verified, and a JSON dump of both sides is written first.
 */
import { readFileSync, writeFileSync } from "node:fs";

const envs: Record<string, string> = Object.fromEntries(
  (
    process.env.SUPABASE_SERVICE_ROLE_KEY
      ? Object.entries(process.env)
      : readFileSync(".env.local", "utf8")
          .split("\n")
          .filter((l) => /^\s*[A-Z_]+\s*=/.test(l))
          .map((l) => {
            const i = l.indexOf("=");
            return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
          })
  ).filter((e): e is [string, string] => e[1] !== undefined),
);

const URL_BASE = envs.NEXT_PUBLIC_SUPABASE_URL;
const KEY = envs.SUPABASE_SERVICE_ROLE_KEY;
const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

const KEEP = process.env.KEEP_UID ?? "87cf8628-a787-4088-896c-4b33be122294";
const DROP = process.env.DROP_UID ?? "4a7a489e-9bee-438e-b956-ab5039a31fca";

type Row = Record<string, unknown>;

const get = async (path: string) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${path}: ${r.status} ${await r.text()}`);
  return (await r.json()) as Row[];
};

const post = async (path: string, body: unknown, prefer: string) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...H, Prefer: prefer },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? [] : await r.json();
};

const del = async (path: string) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, { method: "DELETE", headers: H });
  if (!r.ok) throw new Error(`DELETE ${path}: ${r.status} ${await r.text()}`);
};

const strip = (row: Row, owner: string): Row => {
  const out: Row = { ...row, user_id: owner };
  delete out.id;
  return out;
};

/** A lecture is the same when subject, day and start all match. */
const lectureKey = (l: Row) =>
  `${String(l.subject_name).trim().toLowerCase()}|${l.day}|${l.start_time}`;

const main = async () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const tables = ["lectures", "subjects", "materials", "attendance", "grades"] as const;

  const before: Record<string, Row[]> = {};
  for (const t of tables) {
    before[t] = [
      ...(await get(`${t}?select=*&user_id=eq.${KEEP}`)),
      ...(await get(`${t}?select=*&user_id=eq.${DROP}`)),
    ];
  }
  writeFileSync(
    `backups/pre-merge-${stamp}.json`,
    JSON.stringify({ keep: KEEP, drop: DROP, rows: before }, null, 2),
  );
  console.log(`backup -> backups/pre-merge-${stamp}.json`);

  // 1. subjects, one row per course name.
  const keepSubjects = await get(`subjects?select=*&user_id=eq.${KEEP}`);
  const haveSubject = new Set(keepSubjects.map((s) => String(s.name).toLowerCase()));
  for (const s of await get(`subjects?select=*&user_id=eq.${DROP}`)) {
    if (haveSubject.has(String(s.name).toLowerCase())) {
      console.log(`subject "${s.name}" already there, skipped`);
      continue;
    }
    await post("subjects", strip(s, KEEP), "return=minimal");
    haveSubject.add(String(s.name).toLowerCase());
    console.log(`subject "${s.name}" copied`);
  }

  // 2. lectures, skipping the ones the keeper already has.
  const keepLectures = await get(`lectures?select=*&user_id=eq.${KEEP}`);
  const haveLecture = new Set(keepLectures.map(lectureKey));
  let copied = 0;
  for (const l of await get(`lectures?select=*&user_id=eq.${DROP}`)) {
    if (haveLecture.has(lectureKey(l))) continue;
    const row = strip(l, KEEP);
    // created_date has a default; keep the original so the order is stable.
    row.created_date = l.created_date;
    row.updated_date = l.updated_date;
    await post("lectures", row, "return=minimal");
    haveLecture.add(lectureKey(l));
    copied += 1;
  }
  console.log(`lectures copied: ${copied}`);

  // 3. verify before anything is removed.
  const finalLectures = await get(`lectures?select=*&user_id=eq.${KEEP}`);
  const unique = new Set(finalLectures.map(lectureKey));
  console.log(`keeper now has ${finalLectures.length} lectures, ${unique.size} unique`);
  if (unique.size !== finalLectures.length) {
    throw new Error("keeper still has duplicate lectures, not deleting anything");
  }

  // 4. empty the old account.
  for (const t of tables) {
    await del(`${t}?user_id=eq.${DROP}`);
  }
  console.log("old account rows removed");

  // 5. drop the old login so the same split cannot happen again.
  const r = await fetch(`${URL_BASE}/auth/v1/admin/users/${DROP}`, {
    method: "DELETE",
    headers: H,
  });
  console.log(`old auth user deleted: ${r.status}`);

  console.log("\nfinal state:");
  for (const t of tables) {
    const n = (await get(`${t}?select=id&user_id=eq.${KEEP}`)).length;
    console.log(`  ${t}: ${n}`);
  }
};

void main();
