"use client";

import Link from "next/link";
import { CalendarDays, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { LangToggle } from "@/components/layout/lang-toggle";

/** Shared frame for the sign-in / sign-up / reset screens. */
export function AuthShell({
  icon: Icon = CalendarDays,
  title,
  subtitle,
  children,
  footer,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { tr } = useI18n();

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold">
          <Icon className="h-6 w-6" />
          <span className="font-display">{tr("جدولي", "Jadoli")}</span>
        </Link>

        <div className="space-y-5">
          <h2 className="font-display text-4xl font-bold leading-tight">
            {tr("نظّم أسبوعك كله في ثواني", "Organise your whole week in seconds")}
          </h2>
          <ul className="space-y-2.5 text-primary-foreground/85">
            {[
              tr("جدولك كله في مكان واحد", "Your whole week in one place"),
              tr("مواعيدك مع تنبيهات", "Timetables with reminders"),
              tr("حتى 12 محاضرة في يوم", "Up to 12 lectures in a day"),
            ].map((p) => (
              <li key={p} className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-white/20 text-xs font-bold">
                  ✓
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-sm text-primary-foreground/70">
          © {new Date().getFullYear()} Jadoli
        </p>
      </aside>

      <main className="flex flex-col bg-background">
        <div className="flex items-center justify-between p-4">
          <Link href="/" className="flex items-center gap-2 font-display font-bold lg:invisible">
            <Icon className="h-5 w-5 text-primary" />
            {tr("جدولي", "Jadoli")}
          </Link>
          <div className="flex items-center gap-1">
            <LangToggle />
            <ThemeToggle />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center p-4 pb-10">
          <div className="w-full max-w-sm space-y-6">
            <header className="space-y-1 text-center">
              <h1 className="font-display text-2xl font-bold">{title}</h1>
              {subtitle && (
                <p className="text-sm text-muted-foreground">{subtitle}</p>
              )}
            </header>
            {children}
            {footer && (
              <div className="text-center text-sm text-muted-foreground">
                {footer}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
