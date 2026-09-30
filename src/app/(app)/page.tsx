import { Suspense } from "react";
import { ScheduleScreen } from "@/components/schedule/schedule-screen";

export default function SchedulePage() {
  return (
    <Suspense fallback={<div className="h-64" />}>
      <ScheduleScreen />
    </Suspense>
  );
}
