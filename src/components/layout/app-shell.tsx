"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/db/auth";
import { useScheduleContext } from "@/lib/schedule-context";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { MobileNav, MobileSearch, EditToggleButton } from "./mobile-nav";
import { ThemeToggle, } from "./theme-toggle";
import { LangToggle } from "./lang-toggle";
import { Button } from "@/components/ui/button";

function Spinner() {
  return (
    <div className="fixed inset-0 flex items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { tr } = useI18n();
  const { session, isLoading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { editMode, openForm } = useScheduleContext();

  const isAssistant = pathname === "/assistant";
  // The floating button opens the lecture form, so it makes no sense on the
  // pages that do not edit lectures.
  const showAdd = !["/assistant", "/subjects", "/import"].includes(pathname);

  useEffect(() => {
    if (!isLoading && !session) router.replace("/login");
  }, [isLoading, session, router]);

  if (isLoading) return <Spinner />;
  if (!session) return <Spinner />;

  return (
    <div className="min-h-screen overflow-x-clip bg-background">
      <Sidebar />

      <div className="lg:ps-20">
        <Header editMode={editMode} hideOnMobile={isAssistant} />
        <main
          className={`mx-auto max-w-7xl px-4 pt-4 lg:px-8 lg:pb-10 lg:pt-6 ${
            isAssistant ? "pb-20" : "pb-32"
          }`}
        >
          <div className="mb-3 flex items-center justify-between gap-2 lg:hidden">
            <MobileSearch />
            <div className="mb-3 flex items-center gap-1">
              <EditToggleButton />
              <ThemeToggle variant="ghost" />
              <LangToggle variant="ghost" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void signOut()}
                className="text-xs"
              >
                {tr("خروج", "Sign out")}
              </Button>
            </div>
          </div>
          {children}
        </main>
      </div>

      {!isAssistant && (
        <MobileNav onAdd={() => openForm(null)} showAdd={showAdd} />
      )}
    </div>
  );
}
