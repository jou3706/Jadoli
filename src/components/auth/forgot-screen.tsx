"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/db/auth";
import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function ForgotScreen() {
  const { tr } = useI18n();
  const { requestReset, mode } = useAuth();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <AuthShell
      icon={MailCheck}
      title={tr("استعادة الباسورد", "Reset your password")}
      subtitle={tr("هنبعتلك لينك على الإيميل", "We'll send a reset link to your email")}
    >
      {mode === "supabase" && sent ? (
        <div className="space-y-4">
          <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
            {tr(
              "ابعتنا لينك إعادة التعيين على الإيميل، افتحه عشان تكمل.",
              "We sent a reset link to your email — open it to continue.",
            )}
          </p>
          <Button asChild className="h-12 w-full text-base">
            <Link href="/login">{tr("ارجع للدخول", "Back to sign in")}</Link>
          </Button>
        </div>
      ) : token ? (
        <div className="space-y-4">
          <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
            {tr("اللينك جاهز:", "Your reset link:")}
          </p>
          {mode === "local" && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              {tr(
                "وضع محلي مفيش إيميل، فالموقع بيعطيك اللينك ده على طول. كمله دلوقتي.",
                "In local mode there is no mail server, so the site hands you the link directly.",
              )}
            </p>
          )}
          <Button asChild className="h-12 w-full text-base">
            <Link href={`/reset-password?token=${encodeURIComponent(token)}`}>
              {tr("كمّل إعادة التعيين", "Continue to reset")}
            </Link>
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            try {
              const issued = await requestReset(email);
              if (issued) setToken(issued);
              else setSent(true);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={tr("الإيميل", "Email")}>
            <Input
              type="email"
              required
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 text-base"
            />
          </Field>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            type="submit"
            className="h-12 w-full gap-2 text-base"
            disabled={busy}
          >
            <Send className="h-4 w-4" /> {tr("ابعت اللينك", "Send the link")}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            <Link href="/login" className="underline">
              {tr("ارجع للدخول", "Back to sign in")}
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
