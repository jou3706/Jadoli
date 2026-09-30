import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export type Lang = "ar" | "en";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** "08:30" -> 510 */
export function toMinutes(time: string): number {
  const [h, m] = String(time ?? "")
    .split(":")
    .map(Number);
  return (h || 0) * 60 + (m || 0);
}

let _lang: Lang = "ar";
export const setFormatLang = (l: Lang) => {
  _lang = l;
};
/** 510 -> "08" */
export const pad = (n: number) => pad2(n);

export function formatTime(time: string): string {
  if (!time) return "";
  const [rawH, rawM] = time.split(":").map(Number);
  const h = rawH || 0;
  const m = rawM || 0;
  if (_lang === "en") return `${h % 12 || 12}:${pad2(m)} ${h >= 12 ? "PM" : "AM"}`;
  return `${h % 12 || 12}:${pad2(m)} ${h >= 12 ? "م" : "ص"}`;
}

export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export const startOfWeek = (d: Date = nowCairo()): Date => {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() - ((t.getDay() + 1) % 7));
  return t;
};

export const weekStartKey = (d: Date = nowCairo()) => isoDate(startOfWeek(d));

export const dayDate = (day: number, base: Date = nowCairo()): Date => {
  const d = startOfWeek(base);
  d.setDate(d.getDate() + ((day + 1) % 7));
  return d;
};

export function nowCairo(): Date {
  return new Date(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Cairo",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date()),
  );
}

export function haversineMeters(
  a: [number, number],
  b: [number, number],
): number {
  const R = 6371e3;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export const formatDistance = (m: number) =>
  m < 1000 ? `${Math.round(m / 10) * 10} م` : `${(m / 1000).toFixed(1)} كم`;

export const walkMinutes = (m: number) => Math.max(1, Math.round(m / 80));

export function countdown(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (_lang === "en") {
    return d > 0 ? `${d}d ${h}h` : `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  }
  return d > 0 ? `${d} يوم و ${h} ساعة` : `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}
