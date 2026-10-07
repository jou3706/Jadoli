"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/db/auth";
import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { hasPrivacyConsent, markPrivacyConsent } from "@/lib/privacy-consent";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.1-4 1.1a7 7 0 0 1-6.6-4.8H1.4v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1A7 7 0 0 1 12 4.8Z"
      />
    </svg>
  );
}

export function LoginScreen() {
  const { tr } = useI18n();
  const router = useRouter();
  const { signIn, signInWithGoogle, mode } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentAgreed, setConsentAgreed] = useState(false);
  const [consentError, setConsentError] = useState("");

  const startGoogle = async () => {
    setError("");
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthShell
      icon={LogIn}
      title={tr("تسجيل الدخول", "Sign in")}
      subtitle={tr("ادخل على جدولك من أي جهاز", "Open your schedule from any device")}
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            await signIn(email, password);
            router.replace("/");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {mode === "supabase" && (
          <>
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full text-base"
              disabled={busy}
              onClick={() => {
                setError("");
                if (!hasPrivacyConsent()) {
                  setConsentError("");
                  setConsentAgreed(false);
                  setConsentOpen(true);
                } else {
                  void startGoogle();
                }
              }}
            >
              <GoogleMark />
              {tr("كمّل دخول بحساب جوجل", "Continue with Google")}
            </Button>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {tr("أو بالإيميل", "or with email")}
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

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
            autoComplete="current-password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 text-base"
          />
        </Field>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" className="h-12 w-full text-base" disabled={busy}>
          {tr("دخول", "Sign in")}
        </Button>

        <p className="text-center text-sm">
          <Link href="/forgot-password" className="text-muted-foreground underline">
            {tr("نسيت الباسورد؟", "Forgot your password?")}
          </Link>
        </p>

        <p className="text-center text-sm text-muted-foreground">
          {tr("لسه معندكش حساب؟ ", "No account yet? ")}
          <Link href="/register" className="font-semibold text-primary underline">
            {tr("اعمل واحد", "Sign up")}
          </Link>
        </p>

        {mode === "local" && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-center text-xs">
            {tr(
              "وضع محلي: الحساب بيتخزن في المتصفح بتاعك بس.",
              "Local mode: your account lives in this browser only.",
            )}
            <br />
            {tr(
              "دخول جوجل محتاج مشروع Supabase — املا مفاتيحه في .env.local.",
              "Google sign-in needs a Supabase project — fill in .env.local.",
            )}
          </p>
        )}
      </form>

      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {tr("خطوة واحدة قبل جوجل", "One step before Google")}
            </DialogTitle>
            <DialogDescription>
              {tr(
                "عمل حساب من خلال جوجل بيحتاج موافقتك الأول على سياسة الخصوصية.",
                "Creating an account with Google first requires your consent to the Privacy Policy.",
              )}
            </DialogDescription>
          </DialogHeader>

          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={consentAgreed}
              onChange={(e) => setConsentAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>
              {tr("أوافق، قرأت ", "I have read and agree to the ")}
              <Link
                href="/privacy"
                target="_blank"
                className="font-semibold text-primary underline"
              >
                {tr("سياسة الخصوصية", "Privacy Policy")}
              </Link>
            </span>
          </label>

          {consentError && (
            <p className="text-sm text-destructive">{consentError}</p>
          )}

          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConsentOpen(false)}
            >
              {tr("إلغاء", "Cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!consentAgreed) {
                  setConsentError(
                    tr(
                      "لازم توافق على سياسة الخصوصية الأول",
                      "You need to accept the Privacy Policy first",
                    ),
                  );
                  return;
                }
                setConsentError("");
                markPrivacyConsent();
                setConsentOpen(false);
                void startGoogle();
              }}
            >
              {tr("أوافق وكمل مع جوجل", "Agree and continue with Google")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AuthShell>
  );
}
