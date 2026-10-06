export type Lang = "ar" | "en";

/** Day ids 6=Saturday … 0=Sunday, 1..4 Monday–Thursday, 5=Friday. Egyptian week. */
export const DAYS = [
  { id: 6, ar: "السبت", en: "Saturday", arShort: "سبت", enShort: "Sat" },
  { id: 0, ar: "الأحد", en: "Sunday", arShort: "أحد", enShort: "Sun" },
  { id: 1, ar: "الاثنين", en: "Monday", arShort: "إثنين", enShort: "Mon" },
  { id: 2, ar: "الثلاثاء", en: "Tuesday", arShort: "ثلاثاء", enShort: "Tue" },
  { id: 3, ar: "الأربعاء", en: "Wednesday", arShort: "أربعاء", enShort: "Wed" },
  { id: 4, ar: "الخميس", en: "Thursday", arShort: "خميس", enShort: "Thu" },
  { id: 5, ar: "الجمعة", en: "Friday", arShort: "جمعة", enShort: "Fri" },
] as const;

export const dayName = (id: number, lang: Lang) => {
  const d = DAYS.find((x) => x.id === id);
  return d ? (lang === "en" ? d.en : d.ar) : "";
};

export const dayShort = (id: number, lang: Lang) => {
  const d = DAYS.find((x) => x.id === id);
  return d ? (lang === "en" ? d.enShort : d.arShort) : "";
};

/** Table column order for the week grid: Sat..Thu */
export const TABLE_DAYS = [6, 0, 1, 2, 3, 4];
export const HOUR_START = 8;
export const HOUR_END = 20;
export const HOURS = Array.from({ length: 12 }, (_, i) => HOUR_START + i);
export const hourLabel = (h: number) => `${h % 12 || 12}-${(h + 1) % 12 || 12}`;

export const LECTURE_COLORS = [
  "indigo",
  "emerald",
  "amber",
  "rose",
  "sky",
  "violet",
  "teal",
  "orange",
] as const;
export type LectureColor = (typeof LECTURE_COLORS)[number];

export const COLOR_STYLES: Record<
  string,
  { dot: string; soft: string; text: string; bar: string }
> = {
  indigo: {
    dot: "bg-indigo-500",
    soft: "bg-indigo-50",
    text: "text-indigo-700",
    bar: "border-s-indigo-500",
  },
  emerald: {
    dot: "bg-emerald-500",
    soft: "bg-emerald-50",
    text: "text-emerald-700",
    bar: "border-s-emerald-500",
  },
  amber: {
    dot: "bg-amber-500",
    soft: "bg-amber-50",
    text: "text-amber-700",
    bar: "border-s-amber-500",
  },
  rose: {
    dot: "bg-rose-500",
    soft: "bg-rose-50",
    text: "text-rose-700",
    bar: "border-s-rose-500",
  },
  sky: {
    dot: "bg-sky-500",
    soft: "bg-sky-50",
    text: "text-sky-700",
    bar: "border-s-sky-500",
  },
  violet: {
    dot: "bg-violet-500",
    soft: "bg-violet-50",
    text: "text-violet-700",
    bar: "border-s-violet-500",
  },
  teal: {
    dot: "bg-teal-500",
    soft: "bg-teal-50",
    text: "text-teal-700",
    bar: "border-s-teal-500",
  },
  orange: {
    dot: "bg-orange-500",
    soft: "bg-orange-50",
    text: "text-orange-700",
    bar: "border-s-orange-500",
  },
};

export const colorStyle = (c?: string) =>
  COLOR_STYLES[c ?? ""] ?? COLOR_STYLES.indigo;

export const EVENT_TYPES = [
  { k: "holiday", ar: "إجازة", en: "Holiday", cls: "bg-red-100 text-red-700" },
  {
    k: "announcement",
    ar: "إعلان",
    en: "Announcement",
    cls: "bg-sky-100 text-sky-700",
  },
  { k: "exam", ar: "امتحان", en: "Exam", cls: "bg-amber-100 text-amber-700" },
  {
    k: "event",
    ar: "فعالية",
    en: "Event",
    cls: "bg-violet-100 text-violet-700",
  },
] as const;

export const GRADE_SCALE = [
  { l: "A", p: 4 },
  { l: "B+", p: 3.5 },
  { l: "B", p: 3 },
  { l: "C+", p: 2.5 },
  { l: "C", p: 2 },
  { l: "D", p: 1 },
  { l: "F", p: 0 },
] as const;

export const CAMPUSES = [
  { key: "shatby", label: "شطبي", center: [31.2246, 31.6221] as [number, number] },
  { key: "moqattam", label: "المقطم", center: [31.3456, 31.6379] as [number, number] },
  { key: "dokki", label: "الدقي", center: [30.0432, 31.2392] as [number, number] },
  { key: "nasr", label: "مدينة نصر", center: [30.0626, 31.3300] as [number, number] },
  { key: "maadi", label: "المعادي", center: [29.9769, 31.2557] as [number, number] },
] as const;

export const DEFAULT_CAMPUS = "shatby";
