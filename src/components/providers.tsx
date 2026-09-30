"use client";

import { useEffect } from "react";
import { ThemeProvider } from "next-themes";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/lib/db/auth";
import { ToastProvider } from "@/components/ui/toast";
import { useCrossTabSync } from "@/lib/db/store";

function CrossTab() {
  useCrossTabSync();
  return null;
}

function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const id = setTimeout(() => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline support is optional */
      });
    }, 1000);
    return () => clearTimeout(id);
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>
            <CrossTab />
            <ServiceWorker />
            {children}
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
