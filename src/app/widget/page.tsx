import { Suspense } from "react";
import type { Metadata } from "next";
import { Widget } from "@/components/schedule/widget";

export const metadata: Metadata = {
  title: "جدولي · Widget",
  robots: { index: false, follow: false },
};

export default function WidgetPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-40 place-items-center p-4">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
        </div>
      }
    >
      <Widget />
    </Suspense>
  );
}
