"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Brain,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  DoorOpen,
  GraduationCap,
  LayoutGrid,
  Layers,
  ListChecks,
  Sparkles,
  Upload,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const NAV = [
  { to: "/", ar: "الجدول", en: "Schedule", Icon: LayoutGrid },
  { to: "/week", ar: "الأسبوع", en: "Week", Icon: CalendarRange },
  { to: "/attendance", ar: "الحضور", en: "Attendance", Icon: ClipboardCheck },
  { to: "/subjects", ar: "المواد", en: "Subjects", Icon: CalendarDays },
  { to: "/review", ar: "المراجعة", en: "Review", Icon: Layers },
  { to: "/quiz", ar: "الاختبارات", en: "Quiz", Icon: Brain },
  { to: "/questions", ar: "بنك الأسئلة", en: "Question bank", Icon: ListChecks },
  { to: "/halls", ar: "القاعات", en: "Halls", Icon: DoorOpen },
  { to: "/gpa", ar: "المعدل", en: "GPA", Icon: GraduationCap },
  { to: "/events", ar: "الأحداث", en: "Events", Icon: Sparkles },
  { to: "/assistant", ar: "المساعد", en: "Assistant", Icon: Bot },
  { to: "/import", ar: "استيراد", en: "Import", Icon: Upload },
] as const;

export function Sidebar() {
  const { tr } = useI18n();
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 start-0 z-40 hidden w-20 flex-col items-center border-e bg-card py-6 lg:flex">
      <Link
        href="/"
        className="shrink-0 font-display text-xl font-bold text-primary"
        aria-label="Jadoli"
      >
        {tr("جدولي", "Jadwali")}
      </Link>

      <nav className="scrollbar-thin mt-8 flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-1 pb-2">
        {NAV.map(({ to, ar, en, Icon }) => {
          const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
          return (
            <Link
              key={to}
              href={to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex w-16 flex-col items-center gap-1 rounded-xl py-2.5 text-xs font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="h-5 w-5" />
              {tr(ar, en)}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
