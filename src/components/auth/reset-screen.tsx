"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/db/auth";
import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

function ResetForm() {
  const { tr } = useI18n();
  const router = useRouter();
  const { resetPassword, mode, session } = useAuth();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <AuthShell
      icon={KeyRound}
      title={tr("باسورد جديد", "New password")}
      subtitle={tr("اختار باسورد تستخدمه في كل مرة", "Pick one you'll remember")}
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          if (mode === "local" && !token) {
            setError(tr("اللينك ناقص", "The link is missing its token"));
            return;
          }
          if (mode === "supabase" && !session) {
            setError(
              tr(
                "افتح اللينك اللي جالك على الإيميل من جديد",
                "Open the recovery link from your email again",
              ),
            );
            return;
          }
          if (password.length < 6) {
            setError(tr("الباسورد لازم 6 حروف على الأقل", "Password must be at least 6 characters"));
            return;
          }
          if (password !== confirm) {
            setError(tr("الباسوردين مش متطابقين", "Passwords do not match"));
            return;
          }
          setBusy(true);
          try {
            await resetPassword(token, password);
            router.replace("/login");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={tr("الباسورد الجديد", "New password")}>
          <Input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 text-base"
          />
        </Field>

        <Field label={tr("أكد الباسورد", "Confirm password")}>
          <Input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            dir="ltr"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-11 text-base"
          />
        </Field>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" className="h-12 w-full text-base" disabled={busy}>
          {tr("احفظ الباسورد", "Save password")}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="underline">
            {tr("ارجع للدخول", "Back to sign in")}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function ResetScreen() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <ResetForm />
    </Suspense>
  );
}
