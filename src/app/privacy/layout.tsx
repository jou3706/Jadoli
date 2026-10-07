import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "سياسة الخصوصية",
  description: "سياسة الخصوصية الخاصة بتطبيق جدولي — البيانات التي نجمعها ولماذا.",
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}