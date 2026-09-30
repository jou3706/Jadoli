"use client";

import { ScheduleProvider } from "@/lib/schedule-context";
import { AppShell } from "@/components/layout/app-shell";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ScheduleProvider>
      <AppShell>{children}</AppShell>
    </ScheduleProvider>
  );
}
