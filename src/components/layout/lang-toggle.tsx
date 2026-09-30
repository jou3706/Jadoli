"use client";

import { Languages } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LangToggle({
  variant = "ghost",
  className,
}: {
  variant?: "ghost" | "outline" | "default";
  className?: string;
}) {
  const { lang, toggle } = useI18n();
  return (
    <Button
      variant={variant}
      size="icon"
      onClick={toggle}
      aria-label="Switch language"
      className={cn(
        variant === "ghost" &&
          "flex w-16 flex-col items-center gap-1 rounded-xl py-2.5 text-xs font-medium",
        className,
      )}
    >
      <Languages className="h-4 w-4" />
      {variant === "ghost" ? <span>{lang === "ar" ? "EN" : "ع"}</span> : null}
    </Button>
  );
}
