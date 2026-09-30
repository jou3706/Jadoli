"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThemeToggle({
  variant = "ghost",
  className,
}: {
  variant?: "ghost" | "outline" | "default";
  className?: string;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === "dark";

  return (
    <Button
      variant={variant}
      size="icon"
      aria-label="Switch theme"
      className={cn(
        variant === "ghost" &&
          "flex w-16 flex-col items-center gap-1 rounded-xl py-2.5 text-xs font-medium",
        className,
      )}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      {!mounted || variant === "ghost" ? (
        <span>{mounted ? (dark ? "داكن" : "فاتح") : "…"}</span>
      ) : null}
    </Button>
  );
}
