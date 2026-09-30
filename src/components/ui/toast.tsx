"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "default" | "destructive";

type Toast = {
  id: number;
  title?: string;
  description?: string;
  variant?: ToastVariant;
  action?: { label: string; onClick: () => void };
};

type ToastInput = Omit<Toast, "id">;

const ToastContext = createContext<{ toast: (t: ToastInput) => void }>({
  toast: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
  }, []);

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((t) =>
      setTimeout(() => dismiss(t.id), t.action ? 6500 : 4000),
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-3 shadow-lg",
              "bg-card text-card-foreground",
              t.variant === "destructive" &&
                "border-destructive/40 bg-destructive text-destructive-foreground",
            )}
          >
            <span className="mt-0.5 shrink-0">
              {t.variant === "destructive" ? (
                <AlertCircle className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              )}
            </span>
            <div className="min-w-0 flex-1 text-sm">
              {t.title && <p className="font-semibold">{t.title}</p>}
              {t.description && (
                <p className="text-muted-foreground">{t.description}</p>
              )}
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
                >
                  <Undo2 className="h-3 w-3" />
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded-sm opacity-60 transition-opacity hover:opacity-100"
              aria-label="close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext).toast;
