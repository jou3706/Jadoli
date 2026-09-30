"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
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

/**
 * Hands the worker the assets this page actually used.
 *
 * The worker cannot precache them itself: their names are hashed per build, so
 * they do not exist until a build has been served, and the page loads its own
 * JavaScript before the worker is in control. Without this the cache ends up
 * holding pages whose scripts were never stored, and losing signal leaves a
 * blank screen - the cache looks healthy and answers nothing usable.
 */
function OfflineWarmup() {
  const pathname = usePathname();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Late enough that the route's own chunks have been requested.
    const id = setTimeout(() => {
      void (async () => {
        try {
          const worker = (await navigator.serviceWorker.ready).active;
          if (!worker) return;
          const urls = new Set<string>();
          const add = (u: string | null | undefined) => {
            if (!u) return;
            try {
              const abs = new URL(u, location.href);
              if (abs.origin === location.origin && abs.pathname.startsWith("/_next/static/")) {
                urls.add(abs.href);
              }
            } catch {
              /* not a url we can store */
            }
          };
          for (const s of Array.from(document.scripts)) add(s.src);
          for (const l of Array.from(
            document.querySelectorAll<HTMLLinkElement>(
              'link[rel="stylesheet"], link[rel="preload"], link[rel="prefetch"]',
            ),
          )) {
            add(l.getAttribute("href"));
          }
          for (const e of performance.getEntriesByType("resource")) {
            const kind = (e as PerformanceResourceTiming).initiatorType;
            if (kind !== "beacon") add(e.name);
          }
          if (urls.size) worker.postMessage({ type: "jadoli:warm", urls: [...urls] });
        } catch {
          /* offline support is optional */
        }
      })();
    }, 1500);
    return () => clearTimeout(id);
  }, [pathname]);
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
            <OfflineWarmup />
            {children}
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
