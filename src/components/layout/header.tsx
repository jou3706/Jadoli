"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, BellRing, LogOut, Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/db/auth";
import { useList } from "@/lib/db/store";
import { useNotifications } from "@/hooks/use-notifications";
import { useScheduleContext } from "@/lib/schedule-context";
import { nowCairo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LangToggle } from "./lang-toggle";
import { ThemeToggle } from "./theme-toggle";

export function Header({
  editMode,
  hideOnMobile,
}: {
  editMode: boolean;
  hideOnMobile: boolean;
}) {
  const { tr, lang } = useI18n();
  const { search, setSearch } = useScheduleContext();
  const { session, signOut } = useAuth();
  const { data: lectures } = useList("Lecture", "-created_date", 300);
  const {
    permission,
    requestPermission: onRequest,
  } = useNotifications(lectures ?? [], nowCairo());
  const [now, setNow] = useState(() => nowCairo());
  const [term, setTerm] = useState(search);

  useEffect(() => {
    const id = setInterval(() => setNow(nowCairo()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => setTerm(search), [search]);

  useEffect(() => {
    const id = setTimeout(() => setSearch(term), 200);
    return () => clearTimeout(id);
  }, [term, setSearch]);

  const locale = lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
  const dayFmt = (d: Date) =>
    d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  const weekEnd = useMemo(() => {
    const d = new Date(now);
    d.setDate(d.getDate() + 5);
    return d;
  }, [now]);

  return (
    <header
      className={`sticky top-0 z-30 border-b bg-background/90 backdrop-blur ${hideOnMobile ? "hidden lg:block" : ""}`}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 lg:px-8">
        <Link
          href="/"
          className="font-display text-2xl font-bold text-primary lg:hidden"
        >
          {tr("جدولي", "Jadwali")}
        </Link>

        <div className="flex items-baseline gap-3">
          <span
            dir="ltr"
            className="font-display text-2xl font-bold tabular-nums text-foreground"
          >
            {now.toLocaleTimeString(locale, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: true,
            })}
          </span>
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {now.toLocaleDateString(locale, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
        </div>

        <span className="hidden rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground md:inline">
          {tr("الأسبوع", "Week")}: {dayFmt(now)} – {dayFmt(weekEnd)}
        </span>

        {editMode && (
          <span className="rounded-full border border-dashed border-primary px-3 py-1 text-sm font-medium text-primary">
            {tr("وضع التعديل", "Edit mode")}
          </span>
        )}

        <div className="ms-auto flex items-center gap-1.5">
          <div className="relative hidden sm:block">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={tr("ابحث…", "Search…")}
              aria-label={tr("بحث", "Search")}
              className="h-9 w-40 bg-card ps-9 lg:w-56"
            />
            {term && (
              <button
                type="button"
                onClick={() => setTerm("")}
                className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={tr("مسح", "Clear")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            aria-label={tr("التنبيهات", "Notifications")}
            onClick={() =>
              permission === "granted" ? undefined : onRequest()
            }
            className={
              permission === "granted" ? "text-emerald-600" : undefined
            }
          >
            {permission === "granted" ? (
              <BellRing className="h-4 w-4" />
            ) : (
              <Bell className="h-4 w-4" />
            )}
          </Button>

          <div className="hidden items-center gap-1 lg:flex">
            <ThemeToggle variant="ghost" />
            <LangToggle variant="ghost" />
          </div>

          {session && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void signOut()}
              aria-label={tr("تسجيل الخروج", "Sign out")}
              title={session.email}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
