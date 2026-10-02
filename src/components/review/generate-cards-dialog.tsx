"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, FileText, Loader2, Sparkles, X } from "lucide-react";
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
import { formatBytes, safeFileName } from "@/lib/db/storage";
import { kindMeta } from "@/lib/materials";
import {
  blockedLabel,
  capSelection,
  cardSourceLabel,
  cardableMaterials,
  type CardableReason,
} from "@/lib/material-cards";
import {
  dropReasonLabel,
  flashcardPayload,
  isDuplicateCard,
  type GeneratedCard,
} from "@/lib/flashcards";
import { MAX_NOTE_CHARS } from "@/lib/ai/schema";
import type { Material } from "@/lib/db/types";

/**
 * Making cards out of the materials already saved on a course.
 *
 * The source is the materials list, not a textarea. A student who has already
 * uploaded the lecture PDF to their course should not be asked to paste it a
 * second time, and one who has not should be told which file to add rather than
 * shown a blank box.
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

/** Refuse a read before it starts rather than after a slow download. */
const MAX_READ_BYTES = 12 * 1024 * 1024;

type Draft = GeneratedCard & { keep: boolean };

/** One picked material, with its bytes once they have been read. */
type Loaded = { material: Material; dataUrl: string; mime: string };

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
  const { data: materials = [] } = useList("Material", "created_date", 500);
  const { bulkCreate } = useMutate("Flashcard");

  const [course, setCourse] = useState(subject);
  const [count, setCount] = useState(10);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropNote, setDropNote] = useState("");

  const reset = () => {
    setCourse(subject);
    setCount(10);
    setText("");
    setPicked([]);
    setDrafts(null);
    setDropNote("");
  };

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) reset();
    onOpenChange(next);
  };

  // Reopening from another course should show that course's materials, not the
  // previous pick on a course that is no longer on screen.
  useEffect(() => {
    if (open) {
      setCourse(subject);
      setPicked([]);
      setDrafts(null);
    }
  }, [open, subject]);

  /**
   * The course's own materials, each judged on whether a model can read it.
   *
   * Judged here rather than in the route because the answer has to be on screen
   * next to the file: "why can't I pick this one" is the question, and a student
   * who cannot see the answer will assume the button is broken.
   */
  const courseMaterials = useMemo(() => {
    const mine = (materials as Material[]).filter(
      (m) => (m.subject_key ?? "").trim() === course.trim() && course.trim() !== "",
    );
    return cardableMaterials(mine);
  }, [materials, course]);

  const readableCount = courseMaterials.filter((c) => c.ok).length;

  const toggle = (id: string) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  /**
   * Reads the picked files into bytes.
   *
   * The browser does this rather than the route: the material lives in the
   * student's own bucket, and the route would otherwise have to be handed a URL
   * to fetch, which turns a failed read into a server-side request to whatever
   * that URL happens to point at.
   */
  const load = async (rows: Material[]): Promise<Loaded[]> => {
    const out: Loaded[] = [];
    for (const material of rows) {
      const url = material.url ?? "";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${material.title || "material"}: ${res.status}`);
      const blob = await res.blob();
      if (blob.size > MAX_READ_BYTES) {
        throw new Error(
          lang === "en"
            ? `${material.title} is too big to read`
            : `${material.title} كبير على التوليد`,
        );
      }
      const mime = blob.type || "application/pdf";
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      out.push({ material, dataUrl, mime });
    }
    return out;
  };

  const generate = async () => {
    const chosen = courseMaterials
      .filter((c) => c.ok && picked.includes(c.material.id))
      .map((c) => c.material);
    if (!text.trim() && !chosen.length) return;

    const { kept, over } = capSelection(chosen);
    if (over) {
      toast({
        title: tr(
          `اخترنا أول ${kept.length} ملف`,
          `Using the first ${kept.length} files`,
        ),
        description: tr(
          `الباقي (${over}) أكبر من اللي النموذج يقرأه مرة واحدة`,
          `The other ${over} are more than one request can read`,
        ),
      });
    }

    setBusy(true);
    setDropNote("");
    try {
      const files = await load(kept);
      const res = await fetch("/api/ai/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-35-flash",
          subject: course,
          text: text.trim(),
          count,
          language: lang,
          materials: files.map((f) => ({
            title: f.material.title,
            dataUrl: f.dataUrl,
            mime: f.mime,
          })),
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
          lang === "en" ? `Skipped: ${reasons.join(", ")}` : `اتخطى: ${reasons.join("، ")}`,
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
    const pickedRows = courseMaterials
      .filter((c) => picked.includes(c.material.id))
      .map((c) => c.material);
    const { kept: keptRows } = capSelection(pickedRows);

    setBusy(true);
    try {
      await bulkCreate(
        kept.map((d) =>
          flashcardPayload(
            { question: d.question, answer: d.answer },
            {
              subject: course,
              // Traceable back to the file, which is the whole point of reading
              // the material in the first place.
              source: cardSourceLabel(keptRows, lang) || tr("ملاحظاتي", "my notes"),
              sourceKind: keptRows.length ? "notes" : "typed",
              language: lang,
              today,
            },
          ),
        ),
      );
      onSaved?.(kept.length);
      toast({
        title: tr(`اتحفظت ${kept.length} كارت`, `${kept.length} cards saved`),
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
  const nothingToRead = !text.trim() && picked.length === 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">
            {drafts
              ? tr("راجع الكروت قبل ما تتحفظ", "Read the cards before they are saved")
              : tr("كروت من مواد المادة", "Cards from your course materials")}
          </DialogTitle>
          <DialogDescription>
            {drafts
              ? tr("امسح أي كارت مش عايزه", "Delete any card you do not want")
              : tr(
                  "اختار الملفات اللي عايز تعمل منها كروت",
                  "Pick the files on this course you want cards from",
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
                  onChange={(e) => {
                    setCourse(e.target.value);
                    setPicked([]);
                  }}
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

            <section className="rounded-xl border">
              <header className="flex items-center gap-2 border-b px-3 py-2">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">
                  {tr("مواد المادة", "Course materials")}
                </span>
                <span className="ms-auto text-xs text-muted-foreground">
                  {course.trim()
                    ? tr(
                        `${readableCount} قابل للقراءة`,
                        `${readableCount} readable`,
                      )
                    : tr("اختار مادة الأول", "Pick a course first")}
                </span>
              </header>

              {!course.trim() ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  {tr(
                    "اكتب اسم المادة فوق عشان نشوف موادها.",
                    "Type the course above to see its materials.",
                  )}
                </p>
              ) : courseMaterials.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  {course.trim()
                    ? tr(
                        "مفيش مواد على المادة دي. ارفع ملف المحاضرة من صفحة المواد الأول.",
                        "This course has no materials yet. Upload the lecture file from the subjects page first.",
                      )
                    : tr(
                        "اكتب اسم المادة فوق عشان نشوف موادها.",
                        "Type the course above to see its materials.",
                      )}
                </p>
              ) : (
                <ul className="max-h-56 divide-y overflow-y-auto">
                  {courseMaterials.map(({ material, kind, reason, ok }) => (
                    <li key={material.id}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-start gap-3 px-3 py-2.5",
                          ok ? "hover:bg-muted/50" : "cursor-not-allowed opacity-70",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={picked.includes(material.id)}
                          disabled={!ok}
                          onChange={() => toggle(material.id)}
                          className="mt-1"
                          aria-label={material.title}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span
                              className={cn(
                                "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                                kindMeta(kind).tone,
                              )}
                            >
                              {kindMeta(kind).ar}
                            </span>
                            <span className="truncate text-sm font-medium">
                              {material.title || tr("بدون عنوان", "Untitled")}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {ok ? (
                              <>
                                {safeFileName(material.title)}
                                {material.size ? ` · ${formatBytes(material.size)}` : ""}
                              </>
                            ) : (
                              blockedLabel(reason as CardableReason, lang)
                            )}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <Field
              label={tr("أو الصق ملخصًا", "Or paste a summary")}
              hint={tr(
                `${text.length} / ${MAX_NOTE_CHARS} حرف`,
                `${text.length} / ${MAX_NOTE_CHARS} characters`,
              )}
            >
              <Textarea
                value={text}
                maxLength={MAX_NOTE_CHARS}
                rows={4}
                onChange={(e) => setText(e.target.value)}
                placeholder={tr(
                  "لو مش فاكر الملف، الصق ملخص المحاضرة هنا…",
                  "If you cannot find the file, paste the summary here…",
                )}
              />
            </Field>

            {readableCount === 0 && course.trim() && courseMaterials.length > 0 && (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {tr(
                  "Materials links والفيديوهات مش قابلة للقراءة. نزّل الملف وارفعه على المادة، أو الصق ملخصًا فوق.",
                  "Links and videos cannot be read. Download the file and upload it to the course, or paste a summary above.",
                )}
              </p>
            )}
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
              <Button onClick={generate} disabled={busy || nothingToRead}>
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