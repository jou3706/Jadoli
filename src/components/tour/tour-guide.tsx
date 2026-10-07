"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import introJs from "intro.js";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/db/auth";
import {
  markTourSeen,
  readTourSeen,
  tourForPath,
  TOUR_START_EVENT,
  type TourConfig,
} from "@/lib/tour";
import { markPageSeen } from "@/lib/page-guides";
import { PAGE_GUIDE_EVENT } from "@/components/layout/page-guide";

type Tour = ReturnType<typeof introJs.tour>;

/** Only the steps whose element is actually on screen are walkable. */
const visible = (selector: string): boolean => {
  try {
    const el = document.querySelector(selector);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  } catch {
    return false;
  }
};

/**
 * The interactive tour for the current page.
 *
 * Renders nothing. It is a client shell over intro.js: on a first visit it
 * runs the page's tour automatically (keyed per account, once per page), and
 * it listens for the header's tour button to replay it on demand. Lighting
 * up only real, on-screen elements means a phone tour never points at a
 * desktop-only control and vice versa.
 */
export function TourGuideHost() {
  const { lang } = useI18n();
  const pathname = usePathname();
  const { session } = useAuth();
  const tourRef = useRef<Tour | null>(null);
  const uid = session?.id;

  const run = async (config: TourConfig) => {
    if (!uid) return;
    if (tourRef.current?.isActive()) return;

    // The page's data may still be loading, so the targeted elements might not
    // exist yet. Give them a moment, and give up quietly if they never appear
    // rather than steering a tour at nothing.
    let steps = config.steps.filter((s) => visible(s.selector));
    for (let i = 0; i < 4 && steps.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 350));
      steps = config.steps.filter((s) => visible(s.selector));
    }
    if (steps.length === 0) return;

    const ar = lang === "ar";
    const t = introJs.tour();
    tourRef.current = t;
    t.setOptions({
      steps: steps.map((s) => ({
        element: s.selector,
        title: ar ? s.title[0] : s.title[1],
        intro: ar ? s.intro[0] : s.intro[1],
        position: s.position,
      })),
      nextLabel: ar ? "التالي" : "Next",
      prevLabel: ar ? "السابق" : "Back",
      skipLabel: ar ? "تخطي" : "Skip",
      doneLabel: ar ? "إنهاء" : "Done",
      showProgress: true,
      showBullets: false,
      showStepNumbers: false,
      exitOnOverlayClick: false,
      overlayOpacity: 0.7,
      scrollPadding: 14,
    });
    const finish = () => {
      markTourSeen(uid, config.key);
      // The same page key drives the static card, so they never fight.
      markPageSeen(uid, config.key);
    };
    t.onComplete(finish);
    t.onExit(finish);
    t.onSkip(finish);
    void t.start();
  };

  // Leaving the page closes the tour; both end and completion mark it seen,
  // so the tour is a thing that happened, not a thing that nags.
  useEffect(() => {
    const t = tourRef.current;
    if (t?.isActive()) void t.exit(true);
    tourRef.current = null;
    return () => {
      if (tourRef.current?.isActive()) void tourRef.current.exit(true);
      tourRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // First visit, once per account: a tour-enabled page is taught by the tour.
  useEffect(() => {
    const config = tourForPath(pathname);
    if (!config || !uid || readTourSeen(uid, config.key)) return;
    const id = window.setTimeout(() => void run(config), 400);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, uid, lang]);

  // The header's tour button replays the tour; pages without a tour fall back
  // to the static page card so the button never dead-ends.
  useEffect(() => {
    const onStart = () => {
      const config = tourForPath(pathname);
      if (!config) {
        window.dispatchEvent(new CustomEvent(PAGE_GUIDE_EVENT));
        return;
      }
      void run(config);
    };
    window.addEventListener(TOUR_START_EVENT, onStart);
    return () => window.removeEventListener(TOUR_START_EVENT, onStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, uid, lang]);

  return null;
}