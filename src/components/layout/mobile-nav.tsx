"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis, Plus, Search, SquarePen } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useScheduleContext } from "@/lib/schedule-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NAV } from "./sidebar";
import { cn } from "@/lib/utils";

/** The bottom bar only has room for a few items; the rest live behind "more". */
const PRIMARY = NAV.slice(0, 4);
const SECONDARY = NAV.slice(4, 6);
const OVERFLOW = NAV.slice(6);

const linkClass = (active: boolean) =>
  cn(
    "flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] font-medium",
    active ? "text-primary" : "text-muted-foreground",
  );

export function MobileNav({
  onAdd,
  showAdd = true,
}: {
  onAdd: () => void;
  showAdd?: boolean;
}) {
  const { tr } = useI18n();
  const pathname = usePathname();
  const [more, setMore] = useState(false);

  const isActive = (to: string) =>
    to === "/" ? pathname === "/" : pathname.startsWith(to);

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-lg items-center gap-1 px-1 pt-1">
        {PRIMARY.map(({ to, ar, en, Icon }) => (
          <Link key={to} href={to} className={linkClass(isActive(to))}>
            <Icon className="h-5 w-5" />
            {tr(ar, en)}
          </Link>
        ))}

        {showAdd && (
          <button
            type="button"
            onClick={onAdd}
            data-tour="add-lecture"
            aria-label={tr("إضافة محاضرة", "Add lecture")}
            className="mx-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95"
          >
            <Plus className="h-6 w-6" />
          </button>
        )}

        {SECONDARY.map(({ to, ar, en, Icon }) => (
          <Link key={to} href={to} className={linkClass(isActive(to))}>
            <Icon className="h-5 w-5" />
            {tr(ar, en)}
          </Link>
        ))}

        {OVERFLOW.length > 0 && (
          <button
            type="button"
            onClick={() => setMore(true)}
            aria-label={tr("المزيد", "More")}
            className={cn(
              linkClass(OVERFLOW.some((n) => isActive(n.to))),
              "shrink-0",
            )}
          >
            <Ellipsis className="h-5 w-5" />
            {tr("المزيد", "More")}
          </button>
        )}
      </div>

      <Dialog open={more} onOpenChange={setMore}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">
              {tr("كل الصفحات", "All pages")}
            </DialogTitle>
          </DialogHeader>
          <ul className="grid grid-cols-2 gap-2">
            {OVERFLOW.map(({ to, ar, en, Icon }) => (
              <li key={to}>
                <Link
                  href={to}
                  onClick={() => setMore(false)}
                  aria-current={isActive(to) ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border p-3 text-sm font-medium",
                    isActive(to)
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "hover:bg-muted",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{tr(ar, en)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </nav>
  );
}

export function MobileSearch() {
  const { tr } = useI18n();
  const { search, setSearch } = useScheduleContext();
  return (
    <div className="relative mb-3 sm:hidden">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={tr("ابحث في المواد والدكاترة…", "Search subjects, doctors…")}
        className="h-10 bg-card ps-9"
      />
    </div>
  );
}

export function EditToggleButton() {
  const { tr } = useI18n();
  const { editMode, setEditMode } = useScheduleContext();
  return (
    <button
      type="button"
      onClick={() => setEditMode((p) => !p)}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium lg:hidden"
    >
      <SquarePen className="h-3.5 w-3.5" />
      {tr(editMode ? "خلّصت" : "تعديل", editMode ? "Done" : "Edit")}
    </button>
  );
}
