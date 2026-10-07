"use client";

import { ScheduleProvider } from "@/lib/schedule-context";
import { AppShell } from "@/components/layout/app-shell";
import { EventAlarms } from "@/components/subjects/event-alarm";
import { OnboardingGuide } from "@/components/layout/onboarding-guide";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ScheduleProvider>
      {/*
        One alarm for every page inside the app, mounted above them all. An
        alarm that belonged to whichever page happened to be open would go
        quiet the moment you opened another one, which is the one moment it
        matters. Inside the signed-in shell rather than the root, because an
        alarm has nothing to say to someone who has not signed in - and because
        asking for the events table before signing in is a request that has to
        be refused.
      */}
      <EventAlarms />
      <OnboardingGuide />
      <AppShell>{children}</AppShell>
    </ScheduleProvider>
  );
}
