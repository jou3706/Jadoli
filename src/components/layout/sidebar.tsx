"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  DoorOpen,
  Eye,
  GraduationCap,
  LayoutGrid,
  Pencil,
  Sparkles,
  Upload,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useScheduleContext } from "@/lib/schedule-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { LangToggle } from "./lang-toggle";

export const NAV = [
  { to: "/", ar: "الجدول", en: "Schedule", Icon: LayoutGrid },
  { to: "/week", ar: "الأسبوع", en: "Week", Icon: CalendarRange },
  { to: "/attendance", ar: "الحضور", en: "Attendance", Icon: ClipboardCheck },
  { to: "/subjects", ar: "المواد", en: "Subjects", Icon: CalendarDays },
  { to: "/halls", ar: "القاعات", en: "Halls", Icon: DoorOpen },
  { to: "/gpa", ar: "المعدل", en: "GPA", Icon: GraduationCap },
  { to: "/events", ar: "الأحداث", en: "Events", Icon: Sparkles },
  { to: "/assistant", ar: "المساعد", en: "Assistant", Icon: Bot },
  { to: "/import", ar: "استيراد", en: "Import", Icon: Upload },
] as const;

export function Sidebar({
  editMode,
  onToggleEdit,
}: {
  editMode: boolean;
  onToggleEdit: () => void;
}) {
  const { tr } = useI18n();
  const pathname = usePathname();
  const { setEditMode } = useScheduleContext();

  return (
    <aside className="fixed inset-y-0 start-0 z-40 hidden w-20 flex-col items-center border-e bg-card py-6 lg:flex">
      <Link
        href="/"
        className="font-display text-xl font-bold text-primary"
        aria-label="Jadoli"
      >
        {tr("جدولي", "Jadwali")}
      </Link>

      <nav className="mt-8 flex flex-col gap-2">
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

      <div className="mt-auto flex flex-col items-center gap-2">
        <ThemeToggle variant="ghost" />
        <LangToggle variant="ghost" />
        <Button
          onClick={() => {
            setEditMode(editMode);
            onToggleEdit();
          }}
          className="flex w-16 flex-col items-center gap-1 rounded-xl py-2.5 text-xs font-medium"
          variant={editMode ? "default" : "ghost"}
        >
          {editMode ? <Eye className="h-5 w-5" /> : <Pencil className="h-5 w-5" />}
          {tr(editMode ? "عرض" : "تعديل", editMode ? "View" : "Edit")}
        </Button>
      </div>
    </aside>
  );
}
