import type { Metadata, Viewport } from "next";
import { Cairo, Tajawal } from "next/font/google";
import "intro.js/introjs.css";
import "./globals.css";
import { Providers } from "@/components/providers";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["500", "700", "800"],
  variable: "--font-cairo",
  display: "swap",
});

const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700"],
  variable: "--font-tajawal",
  display: "swap",
});

export const metadata: Metadata = {
  title: "جدولي الدراسي",
  description:
    "منظم دراسي ذكي للمحاضرات والتنبيهات وتتبع الحضور.",
  applicationName: "جدولي الدراسي",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black", title: "جدولي الدراسي" },
  icons: {
    icon: "/icon.svg",
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafbfd" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className={`${cairo.variable} ${tajawal.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
