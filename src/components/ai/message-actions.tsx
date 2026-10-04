"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Pencil, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

/**
 * Copy, and edit on your own questions.
 *
 * Both are on every message rather than in a menu, because both are one tap on
 * the thing itself and a menu would put a second step in front of copying an
 * answer to read somewhere else.
 *
 * The buttons are shown on hover on a pointer and always shown on a touch
 * screen, where there is no hover to reveal them and a control that only exists
 * while the cursor is near it is a control nobody finds.
 */

/** How long the tick stays up after a copy. Long enough to notice, short enough
 * not to look like the state of the page. */
const COPIED_FOR = 1600;

type Props = {
  text: string;
  /** Only a question can be edited - an answer is the assistant's to stand by. */
  onEdit?: () => void;
  /** Offered but disabled, with the reason, while an answer is still coming. */
  editDisabled?: boolean;
  editDisabledReason?: string;
  /** Which edge of the bubble this row sits under. */
  align?: "start" | "end";
};

export function MessageActions({
  text,
  onEdit,
  editDisabled,
  editDisabledReason,
  align = "start",
}: Props) {
  const { tr } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A copy confirmed and then a new question typed should not leave the tick up
  // from the old one.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (!text.trim()) return null;

  const copy = async () => {
    const ok = await writeClipboard(text);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_FOR);
  };

  const button =
    "shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground";

  return (
    <div
      className={[
        // On a pointer this row is quiet until the message is pointed at, and on a
        // touch screen it is simply always there, because there is no hover to
        // reveal it and a control that only exists under the cursor is one nobody
        // finds.
        "mt-0.5 flex w-fit items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
        // The row has to sit under the same edge as the bubble it belongs to.
        align === "end" ? "ms-auto" : "me-auto",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={() => void copy()}
        className={button}
        aria-label={copied ? tr("اتنسخ", "Copied") : tr("انسخ", "Copy")}
        title={copied ? tr("اتنسخ", "Copied") : tr("انسخ", "Copy")}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>

      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          disabled={editDisabled}
          className={editDisabled ? `${button} opacity-50` : button}
          aria-label={tr("عدّل السؤال", "Edit question")}
          title={
            editDisabled
              ? (editDisabledReason ?? tr("ثواني", "Just a moment"))
              : tr("عدّل السؤال", "Edit question")
          }
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * The inline editor that replaces a question while it is being rewritten.
 *
 * Enter sends and Escape gives up, matching the input box below it, and the
 * original wording is the starting text so the common case - fixing one word -
 * is a small edit rather than a retype.
 */
export function MessageEditor({
  initial,
  busy,
  onCancel,
  onSubmit,
}: {
  initial: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const { tr } = useI18n();
  const [text, setText] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);

  // Put the caret at the end rather than selecting the whole thing, so the next
  // character typed is a correction rather than a replacement of everything.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Grow with the text up to a point, so a long question is not edited in a
  // three-line window.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [text]);

  const submit = () => {
    const next = text.trim();
    if (!next || busy) return;
    onSubmit(next);
  };

  return (
    <div className="space-y-1.5">
      <textarea
        ref={area}
        value={text}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        aria-label={tr("عدّل السؤال", "Edit question")}
        className="flex max-h-48 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          onClick={submit}
          disabled={!text.trim() || busy}
          aria-label={tr("ابعت من جديد", "Resend")}
        >
          {busy ? (
            <span className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5" />
              {tr("جاري الإرسال…", "Sending…")}
            </span>
          ) : (
            tr("ابعت من جديد", "Resend")
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-9 w-9"
          onClick={onCancel}
          disabled={busy}
          aria-label={tr("سيبه", "Cancel")}
        >
          <X className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground">
          {tr("Enter يبعث · Esc يرجع", "Enter to send · Esc to cancel")}
        </span>
      </div>
    </div>
  );
}

/**
 * Copy to the clipboard, with the old way as a fallback.
 *
 * The async clipboard API needs a secure context, so over plain http - a phone
 * on the college wifi looking at a local build - it is simply not there. Without
 * the fallback the button would do nothing at all and look broken.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* denied, or not a secure context: try the old way below */
  }

  try {
    const el = document.createElement("textarea");
    el.value = text;
    // Kept on screen but out of the way: `display: none` cannot be selected, and
    // a visible one at -9999px scrolls the page to the top on some browsers.
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "0";
    el.style.left = "-9999px";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    el.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}