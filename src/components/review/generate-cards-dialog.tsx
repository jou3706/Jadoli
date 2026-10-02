"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Sparkles, Upload, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList, useMutate } from "@/lib/db/store";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  dropReasonLabel,
  flashcardPayload,
  isDuplicateCard,
  type GeneratedCard,
} from "@/lib/flashcards";
import { MAX_NOTE_CHARS } from "@/lib/ai/schema";

/**
 * Making cards out of notes.
 *
 * Two steps on purpose: the model writes them, the student reads them, and only
 * then do they become part of the queue. Cards arrive on a screen with a delete
 * button next to every one, because a card nobody wants is worse than a missing
 * one - it will be asked again in a week, and again after that, and it will be
 * wrong every time.
 *
 * Nothing is written until the last button is pressed, which also means the
 * screen works the same whether the save is going to reach the server or sit on
 * the device until it can.
 */
const COUNT_CHOICES = [5, 10, 15, 20];

/** What the file picker is allowed to be: a page of notes, or a photo of one. */
const ACCEPTED = ".pdf,.png,.jpg,.jpeg,.webp,.txt";

type Draft = GeneratedCard & { keep: boolean };

export function GenerateCardsDialog({
  open,
  onOpenChange,
  subject,
  today,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefilled when opened from a course, empty when opened from the page. */
  subject: string;
  today: string;
  onSaved?: (count: number) => void;
}) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data: subjects = [] } = useList("Subject", "name", 100);
  const { bulkCreate } = useMutate("Flashcard");
  const fileRef = useRef<HTMLInputElement>(null);

  const [course, setCourse] = useState(subject);
  const [count, setCount] = useState(10);
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropNote, setDropNote] = useState("");

  const reset = () => {
    setCourse(subject);
    setCount(10);
    setText("");
    setFile(null);
    setDrafts(null);
    setDropNote("");
  };

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const pick = async (f: File) => {
    const kind = f.type.startsWith("image/") ? "image" : "pdf";
    if (kind === "image" && !/^image\/(png|jpeg|webp)$/.test(f.type)) {
      toast({
        title: tr("صورة غير مدعومة", "That image is not supported"),
        description: tr("استخدم PNG أو JPG", "Use a PNG or a JPG"),
        variant: "destructive",
      });
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      toast({
        title: tr("الملف كبير", "That file is too big"),
        description: tr("الحد 8 ميجا", "The limit is 8 MB"),
        variant: "destructive",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setFile({ name: f.name, dataUrl: String(reader.result ?? "") });
    reader.readAsDataURL(f);
  };

  const generate = async () => {
    if (!text.trim() && !file) return;
    setBusy(true);
    setDropNote("");
    try {
      const res = await fetch("/api/ai/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-35-flash",
          subject: course,
          text: text.trim(),
          count,
          language: lang,
          images: file
            ? [
                {
                  dataUrl: file.dataUrl,
                  mime: file.dataUrl.startsWith("data:application/pdf")
                    ? "application/pdf"
                    : "image/png",
                },
              ]
            : [],
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        cards?: GeneratedCard[];
        dropped?: { dropped?: string }[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || tr("فشل الطلب", "That did not work"));

      const cards = data.cards ?? [];
      setDrafts(cards.map((c) => ({ ...c, keep: true })));
      const skipped = (data.dropped ?? []).filter((d) => d.dropped);
      if (skipped.length) {
        const reasons = [...new Set(skipped.map((d) => dropReasonLabel(d.dropped ?? "", lang)))];
        setDropNote(
          lang === "en"
            ? `Skipped: ${reasons.join(", ")}`
            : `اتخطى: ${reasons.join("، ")}`,
        );
      }
    } catch (e) {
      toast({
        title: tr("مقدرناش نعمل كروت", "Could not make the cards"),
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const kept = (drafts ?? []).filter((d) => d.keep);
    if (!kept.length) return;
    setBusy(true);
    try {
      await bulkCreate(
        kept.map((d) =>
          flashcardPayload(
            { question: d.question, answer: d.answer },
            {
              subject: course,
              source: file?.name ?? "",
              sourceKind: file ? "notes" : "typed",
              language: lang,
              today,
            },
          ),
        ),
      );
      onSaved?.(kept.length);
      toast({
        title: tr(
          `اتحفظت ${kept.length} كارت`,
          `${kept.length} cards saved`,
        ),
        description: tr(
          "هتظهرلك في المراجعة أول النهاردة",
          "They will be waiting in review today",
        ),
      });
      close(false);
    } catch (e) {
      if (isDuplicateCard(e)) {
        toast({
          title: tr("فيه كارت موجودة", "Some of these already exist"),
          description: tr(
            "اتخطت المكرر، والباقي اتحفظ",
            "The repeats were skipped, the rest saved",
          ),
        });
        close(false);
      } else {
        toast({
          title: tr("مش قادرين نحفظ الكروت", "Could not save the cards"),
          description: (e as Error).message,
          variant: "destructive",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const keptCount = (drafts ?? []).filter((d) => d.keep).length;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">
            {drafts
              ? tr("راجع الكروت قبل ما تتحفظ", "Read the cards before they are saved")
              : tr("كروت من ملاحظاتك", "Cards from your notes")}
          </DialogTitle>
          <DialogDescription>
            {drafts
              ? tr(
                  "امسح أي كارت مش عايزه",
                  "Delete any card you do not want",
                )
              : tr(
                  "الصق الملخص أو ارفع صورة الورقة أو الـ PDF",
                  "Paste your summary, or upload a photo of the page or a PDF",
                )}
          </DialogDescription>
        </DialogHeader>

        {drafts ? (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pe-1">
            {drafts.map((d, i) => (
              <div
                key={`${d.question}-${i}`}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3",
                  !d.keep && "opacity-50",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-bold leading-snug">{d.question}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{d.answer}</p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  aria-label={tr("امسح الكارت", "Remove this card")}
                  onClick={() =>
                    setDrafts((prev) =>
                      (prev ?? []).map((row, j) => (j === i ? { ...row, keep: false } : row)),
                    )
                  }
                >
                  <X className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
            {dropNote && <p className="text-xs text-muted-foreground">{dropNote}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={tr("المادة", "Course")}>
                <Input
                  list="review-courses"
                  value={course}
                  onChange={(e) => setCourse(e.target.value)}
                  placeholder={tr("فيزياء 2", "Physics 2")}
                />
                <datalist id="review-courses">
                  {subjects.map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
                </datalist>
              </Field>
              <Field label={tr("عدد الكروت", "How many cards")}>
                <Select value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
                  {COUNT_CHOICES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field
              label={tr("الملاحظات", "Your notes")}
              hint={tr(
                `${text.length} / ${MAX_NOTE_CHARS} حرف`,
                `${text.length} / ${MAX_NOTE_CHARS} characters`,
              )}
            >
              <Textarea
                value={text}
                maxLength={MAX_NOTE_CHARS}
                rows={7}
                onChange={(e) => setText(e.target.value)}
                placeholder={tr(
                  "اكتب أو الصق ملخص المحاضرة هنا…",
                  "Type or paste your lecture summary here…",
                )}
              />
            </Field>

            <Field
              label={tr("أو ارفع الورقة", "Or upload the page")}
              hint={tr("صورة أو PDF, 8 ميجا بالكتير", "An image or a PDF, 8 MB at most")}
            >
              {file ? (
                <div className="flex items-center gap-2 rounded-xl border p-3">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setFile(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="h-4 w-4" /> {tr("اختار ملف", "Choose a file")}
                </Button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void pick(f);
                  e.target.value = "";
                }}
              />
            </Field>
          </div>
        )}

        <DialogFooter>
          {drafts ? (
            <>
              <Button variant="outline" onClick={() => close(false)} disabled={busy}>
                {tr("تراجع", "Back")}
              </Button>
              <Button onClick={save} disabled={busy || keptCount === 0}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {tr(
                  keptCount ? `احفظ ${keptCount}` : "اختار كارت",
                  keptCount ? `Save ${keptCount}` : "Keep a card",
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)} disabled={busy}>
                {tr("إلغاء", "Cancel")}
              </Button>
              <Button onClick={generate} disabled={busy || (!text.trim() && !file)}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {busy ? tr("بيشتغل…", "Working…") : tr("اعمل الكروت", "Make the cards")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}