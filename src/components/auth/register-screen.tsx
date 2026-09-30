"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/db/auth";
import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function RegisterScreen() {
  const { tr } = useI18n();
  const router = useRouter();
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <AuthShell
      icon={UserPlus}
      title={tr("حساب جديد", "Create an account")}
      subtitle={tr("مجاني بالكامل — وبياناتك عندك", "Free — and your data stays yours")}
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
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
            await signUp(email, password, fullName);
            router.replace("/");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={tr("الاسم", "Full name")}>
          <Input
            required
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="h-11 text-base"
          />
        </Field>

        <Field label={tr("الإيميل", "Email")}>
          <Input
            type="email"
            required
            autoComplete="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 text-base"
          />
        </Field>

        <Field label={tr("الباسورد", "Password")}>
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
          {tr("اعمل حساب", "Create account")}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          {tr("عندك حساب؟ ", "Already registered? ")}
          <Link href="/login" className="font-semibold text-primary underline">
            {tr("دخول", "Sign in")}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
