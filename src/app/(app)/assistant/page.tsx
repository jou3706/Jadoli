"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Brain,
  Check,
  LayoutList,
  Loader2,
  MessageSquarePlus,
  MessagesSquare,
  Paperclip,
  Pencil,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList, useMutate } from "@/lib/db/store";
import { authHeader } from "@/lib/db/supabase-client";
import { useChats } from "@/hooks/use-chats";
import { applyActions } from "@/lib/ai/apply-actions";
import { buildContext, withContext } from "@/lib/ai/context";
import {
  splitAction,
  parseQuiz,
  type AssistantMode,
  type QuizSet,
  type QuizSource,
} from "@/lib/ai/schema";
import { newQuestions, questionPayload } from "@/lib/quiz-bank";
import { QuizBuilder } from "@/components/ai/quiz-builder";
import { QuizSession } from "@/components/review/quiz-session";
import { MODELS, PROVIDER_ORDER, findModel, type ModelDef } from "@/lib/ai/models";
import { nowCairo } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { Attachment } from "@/lib/db/types";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MODE_KEY = "jadoli:assistant-mode";

/**
 * The order the providers are offered in, and what to call them.
 *
 * Every model is offered, not only the ones that can read a picture. The other
 * pools are cheaper and often faster, and a question with no attachment in it
 * does not need a vision model - hiding them left one provider looking like the
 * only choice there was.
 */
const PROVIDER_LABEL: Record<ModelDef["provider"], [string, string]> = {
  gemini: ["جوجل Gemini", "Google Gemini"],
  groq: ["Groq", "Groq"],
  openrouter: ["OpenRouter", "OpenRouter"],
};

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });

type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  images?: Attachment[];
  applied?: { ok: boolean; label: string }[];
  quiz?: QuizSet & { corrected?: number };
  /** Set while the student is choosing which files the exam is made from. */
  quizOffer?: { subjectKey?: string; topic?: string };
  error?: string;
};

type QuizRequest = {
  subjectKey?: string;
  source?: string;
  chapter?: string;
  topic?: string;
  count?: number;
  language?: string;
};

/** Narrows an assistant action to the quiz request the chat model emits. */
function asQuizAction(a: unknown): QuizRequest | null {
  if (!a || typeof a !== "object") return null;
  const o = a as { type?: unknown; quiz?: unknown };
  if (o.type !== "make_quiz" || !o.quiz || typeof o.quiz !== "object") return null;
  return o.quiz as QuizRequest;
}

export default function AssistantPage() {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data: lectures = [] } = useList("Lecture", "-created_date", 300);
  const { data: grades = [] } = useList("Grade");
  const { data: events = [] } = useList("UniversityEvent", "date", 300);
  const { data: materials = [] } = useList("Material", "-created_date", 100);
  // The picker needs every material of the chosen course, not just the newest
  // hundred the context happens to carry.
  const { data: pickerMaterials = [] } = useList("Material", "-created_date", 500);
  const { data: bank = [] } = useList("Question", "-created_date", 1000);
  const { bulkCreate } = useMutate("Question");

  const [model, setModel] = useState("gemini-35-flash");
  const [mode, setMode] = useState<AssistantMode>("general");
  const [streamed, setStreamed] = useState<Turn[] | null>(null);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [quizBusy, setQuizBusy] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [totalKeys, setTotalKeys] = useState(0);
  const [showChats, setShowChats] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const creatingRef = useRef(false);

  const chats = useChats();
  // In-flight turns carry the streaming text and the applied-action badges;
  // everything else is rendered from the persisted thread.
  const turns: Turn[] = streamed ?? chats.turns;

  const pickerSubjects = useMemo(() => {
    const s = new Set<string>();
    for (const l of lectures) if (l.subject_name) s.add(l.subject_name.trim());
    for (const m of pickerMaterials) if (m.subject_key) s.add(m.subject_key.trim());
    return Array.from(s).sort();
  }, [lectures, pickerMaterials]);

  const patchTurn = (id: string, next: Partial<Turn>) =>
    setStreamed((p) => (p ? p.map((t) => (t.id === id ? { ...t, ...next } : t)) : p));

  /**
   * Builds an exam from the files the student picked, saves whatever is new to
   * the question bank, and turns the offer block into the interactive exam.
   */
  const runQuiz = async (source: QuizSource, turnId: string) => {
    setQuizBusy(true);
    patchTurn(turnId, { error: undefined });
    try {
      const res = await fetch("/api/ai/quiz", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify(source),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String(data.message ?? data.reason ?? data.error ?? "quiz generation failed"));
      }
      const set = data as QuizSet & { corrected?: number };
      const fresh = newQuestions(set.questions, bank, source.subjectKey);
      if (fresh.length) {
        const picked = source.materialIds
          .map((id) => pickerMaterials.find((m) => m.id === id)?.title ?? "")
          .filter(Boolean);
        const label =
          source.source === "chapter"
            ? `فصل: ${source.chapter ?? ""}`
            : source.source === "topic"
              ? source.topic ?? ""
              : picked.join("، ");
        try {
          await bulkCreate(
            fresh.map((q) => questionPayload(q, { subjectKey: source.subjectKey, source: label })),
          );
        } catch {
          /* already saved — the unique index refused a duplicate */
        }
      }
      patchTurn(turnId, { quizOffer: undefined, quiz: set });
      if (chats.activeId) {
        await chats
          .saveMessage(chats.activeId, "assistant", tr("اختبار تفاعلي", "Interactive quiz"))
          .catch(() => {});
      }
    } catch (e) {
      // Keep the offer on screen so a failed generation can be tried again.
      patchTurn(turnId, { error: (e as Error).message });
    } finally {
      setQuizBusy(false);
    }
  };

  const def = findModel(model);
  const canAttach = def.supportsImages || def.supportsPdf === true;

  const providerGroups = useMemo(
    () =>
      PROVIDER_ORDER.map((p) => ({
        id: p,
        label: tr(PROVIDER_LABEL[p][0], PROVIDER_LABEL[p][1]),
        models: MODELS.filter((m) => m.provider === p),
      })).filter((g) => g.models.length > 0),
    [tr],
  );

  // A different thread means a different history.
  //
  // Sending in a brand-new chat also changes activeId (the chat is created
  // mid-send), and that must NOT wipe the turn it just rendered — so the send
  // marks itself and this effect skips that one change.
  useEffect(() => {
    if (creatingRef.current) {
      creatingRef.current = false;
      return;
    }
    setStreamed(null);
  }, [chats.activeId]);

  // The mode survives a reload. Read after mount: this component is server
  // rendered once, so localStorage is not available during the first pass.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MODE_KEY);
      if (saved === "general" || saved === "materials" || saved === "quiz") setMode(saved);
    } catch {
      /* private mode: keep the default */
    }
  }, []);

  const pickMode = (m: AssistantMode) => {
    setMode(m);
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    let alive = true;
    fetch("/api/ai/chat")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setConfigured(Boolean(d.configured));
        setTotalKeys(Number(d.totalKeys) || 0);
      })
      .catch(() => alive && setConfigured(false));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const context = useMemo(
    () =>
      buildContext({
        lectures,
        grades,
        events,
        materials,
        now: nowCairo(),
        lang,
        mode,
      }),
    [lectures, grades, events, materials, lang, mode],
  );

  const pickFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: Attachment[] = [];
    for (const f of Array.from(files).slice(0, 6)) {
      const isPdf = f.type === "application/pdf";
      const isImage = f.type.startsWith("image/");
      if (!isPdf && !isImage) continue;
      if (isPdf && !def.supportsPdf) {
        toast({
          title: tr(
            "الموديل ده مش بيقرأ PDF",
            "That model cannot read PDFs",
          ),
          variant: "destructive",
        });
        continue;
      }
      if (f.size > (isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) {
        toast({
          title: tr(
            "الملف كبير أوي",
            "That file is too large",
          ),
          variant: "destructive",
        });
        continue;
      }
      next.push({ name: f.name, uri: await readAsDataUrl(f) });
    }
    setImages((p) => [...p, ...next].slice(0, 6));
    if (fileRef.current) fileRef.current.value = "";
  };

  const send = async () => {
    const question = input.trim();
    if (!question || busy) return;

    const attachments = images;
    setInput("");
    setImages([]);
    setBusy(true);

    const history = turns
      .filter((t) => t.text.trim() && !t.error)
      .slice(-16)
      .map((t) => ({ role: t.role, text: t.text }));

    const base: Turn[] = [...turns];
    const assistantId = crypto.randomUUID();
    setStreamed([
      ...base,
      { id: crypto.randomUUID(), role: "user", text: question, images: attachments },
      { id: assistantId, role: "assistant", text: "" },
    ]);

    // Persist the question first so the thread survives a crash mid-answer.
    // A new chat is created here, which changes activeId; flag it so the
    // "thread changed" effect does not clear the turn above.
    if (!chats.activeId) creatingRef.current = true;
    const chatId = await chats.ensureChat(question).catch(() => null);
    if (chatId) await chats.saveMessage(chatId, "user", question).catch(() => {});

    const ac = new AbortController();
    abortRef.current = ac;

    const patch = (next: Partial<Turn>) => patchTurn(assistantId, next);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        // The route refuses anyone it cannot identify, so this has to be here on
        // every call that costs a key - not only the ones that read a file.
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          model,
          mode,
          question: withContext(question, context),
          history,
          images: attachments.map((a) => ({
            dataUrl: a.uri,
            mime: a.uri.match(/^data:([^;]+);/)?.[1] ?? "image/png",
          })),
        }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const msg = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(String(msg.error ?? "request failed"));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let answer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          let payload: { token?: string; answer?: string; done?: boolean; error?: string };
          try {
            payload = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (payload.token) {
            answer += payload.token;
            patch({ text: answer });
          }
          if (payload.error) throw new Error(payload.error);
        }
      }

      const { visible, actions } = splitAction(answer);
      const quizReq = mode === "quiz" ? (actions.map(asQuizAction).find(Boolean) ?? null) : null;
      const dbActions = quizReq ? actions.filter((a) => !asQuizAction(a)) : actions;
      const applied = dbActions.length ? await applyActions(dbActions, mode) : undefined;

      // The subject is known: hand it to the picker so the student chooses the
      // files and the count, rather than generating from the model's guess.
      if (quizReq) {
        patch({
          text: visible,
          applied,
          quizOffer: { subjectKey: quizReq.subjectKey, topic: quizReq.topic },
        });
        if (chatId && visible.trim()) {
          await chats.saveMessage(chatId, "assistant", visible).catch(() => {});
        }
        return;
      }

      // The model sometimes writes the quiz itself instead of the action block.
      const quizSet = mode === "quiz" ? parseQuiz(visible) : null;
      patch({ text: quizSet ? "" : visible, applied, quiz: quizSet ?? undefined });
      // Save a short marker rather than the action JSON the model appended.
      const savedText = quizSet ? tr("اختبار تفاعلي", "Interactive quiz") : visible;
      if (chatId && savedText.trim()) {
        await chats.saveMessage(chatId, "assistant", savedText).catch(() => {});
      }
    } catch (e) {
      const err = e as Error;
      if (err.name !== "AbortError") patch({ error: err.message });
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="icon"
          variant="outline"
          className="h-9 w-9"
          onClick={() => setShowChats((v) => !v)}
          aria-label={tr("المحادثات", "Conversations")}
          aria-expanded={showChats}
        >
          <MessagesSquare className="h-4 w-4" />
        </Button>
        <h1 className="font-display text-2xl font-bold">{tr("المساعد", "Assistant")}</h1>
        <div
          className="ms-auto flex items-center gap-2"
          role="group"
          aria-label={tr("وضع المساعد", "Assistant mode")}
        >
          <div className="flex rounded-md border p-0.5">
            {(
              [
                { id: "general", Icon: LayoutList, ar: "عام", en: "General" },
                { id: "materials", Icon: BookOpen, ar: "المواد", en: "Materials" },
                { id: "quiz", Icon: Brain, ar: "الاختبارات", en: "Quiz" },
              ] as const
            ).map(({ id, Icon, ar, en }) => (
              <button
                key={id}
                type="button"
                onClick={() => pickMode(id)}
                aria-pressed={mode === id}
                className={
                  mode === id
                    ? "flex h-8 items-center gap-1.5 rounded-sm bg-primary px-2 text-xs font-medium text-primary-foreground"
                    : "flex h-8 items-center gap-1.5 rounded-sm px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {tr(ar, en)}
              </button>
            ))}
          </div>
          <select
            value={model}
            onChange={(e) => {
              const next = findModel(e.target.value);
              setModel(e.target.value);
              // Saying so beats silently throwing away the attachment somebody
              // just picked a file for.
              if (!(next.supportsImages || next.supportsPdf) && images.length) {
                setImages([]);
                toast({
                  title: tr(
                    `${next.label} نص بس، فشِلنا المرفقات`,
                    `${next.label} is text only, so the attachments were dropped`,
                  ),
                });
              }
            }}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            aria-label={tr("اختار الموديل", "Choose model")}
          >
            {providerGroups.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.supportsImages || m.supportsPdf
                      ? ""
                      : tr(" — نص بس", " — text only")}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {mode === "materials" && (
        <p className="rounded-lg border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          {tr(
            "وضع المواد: المساعد بيجاوب من مذكراتك وملفاتك المرفوعة بس — مش بيشوف الجدول ولا الدرجات. لو لقى لينك مفيد يقدر يحفظه في صفحة المواد.",
            "Materials mode: the assistant answers from your saved materials and attached files only — it cannot see the timetable or grades. If it finds a useful link it can save it to the materials page.",
          )}
        </p>
      )}

      {showChats && (
        <div className="flex max-h-56 flex-col gap-2 rounded-2xl border bg-card p-2">
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start"
            onClick={() => {
              chats.newChat();
              setStreamed(null);
            }}
          >
            <MessageSquarePlus className="h-4 w-4" />
            {tr("محادثة جديدة", "New chat")}
          </Button>
          {chats.chats.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              {tr(
                "لسه مفيش محادثات محفوظة.",
                "No saved conversations yet.",
              )}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {chats.chats.map((c) => (
                <li
                  key={c.id}
                  className={
                    c.id === chats.activeId
                      ? "flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1.5"
                      : "flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-muted"
                  }
                >
                  <button
                    className="min-w-0 flex-1 truncate text-start text-sm"
                    onClick={() => {
                      setStreamed(null);
                      chats.openChat(c.id);
                    }}
                  >
                    {c.title || tr("محادثة بدون عنوان", "Untitled chat")}
                  </button>
                  <button
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label={tr("غيّر الاسم", "Rename")}
                    onClick={() => {
                      const next = window.prompt(
                        tr("اسم المحادثة", "Conversation title"),
                        c.title,
                      );
                      if (next && next.trim()) void chats.renameChat(c.id, next);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                    aria-label={tr("امسح المحادثة", "Delete chat")}
                    onClick={() => {
                      setStreamed(null);
                      void chats.deleteChat(c.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {configured === false && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {tr(
            "مفيش مفاتيح API مضبوطة على السيرفر — ضيف GEMINI_API_KEYS في ملف .env.local",
            "No API keys configured on the server — add GEMINI_API_KEYS to .env.local",
          )}
          {totalKeys > 0 && ` (${totalKeys})`}
        </p>
      )}

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto rounded-2xl border bg-card p-3"
      >
        {turns.length === 0 && (
          <div className="grid h-full place-items-center p-6 text-center">
            <div>
              <p className="font-display text-xl font-bold">
                {mode === "quiz"
                  ? tr("اعمل امتحان من مذكراتك", "Make an exam from your materials")
                  : mode === "materials"
                    ? tr("اسأل عن مذكراتك", "Ask about your materials")
                    : tr("اسأل أي حاجة عن جدولك", "Ask anything about your schedule")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {mode === "quiz"
                  ? tr(
                      "قولي المادة والجزء اللي عايز تتمرن عليه، وهجهزلك امتحان اختيارات مع التصحيح والسبب.",
                      "Tell me the subject and the part, and I'll build a multiple-choice exam with instant feedback and explanations.",
                    )
                  : mode === "materials"
                    ? tr(
                        "اقرا قائمة مذكراتك، ارفع ملف واسأل عنه، أو ادّيه لينك يحفظهولك.",
                        "Read through your material list, attach a file and ask about it, or hand it a link to save for you.",
                      )
                    : tr(
                        "المساعد شايف جدولك ودرجاتك ومناسبات الجامعة، ويقدر يضيف محاضرات أو درجات ليك.",
                        "The assistant can see your lectures, grades and events, and can add lectures or grades for you.",
                      )}
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {(mode === "quiz"
                  ? [
                      tr("عايز امتحان", "I want an exam"),
                      tr("امتحنّي في آخر محاضرة", "Quiz me on the last lecture"),
                    ]
                  : mode === "materials"
                    ? [
                        tr("قائمة مذكراتي", "List my materials"),
                        tr("عندك مذكرات لمادة إيه؟", "Which courses have materials?"),
                        tr("احفظ اللينك ده: ...", "Save this link: ..."),
                      ]
                    : [
                        tr("امبارح عندي إيه؟", "What do I have tomorrow?"),
                        tr("فين المحاضرة الجاية؟", "Where is my next lecture?"),
                        tr("كم ساعتي في الأسبوع؟", "How many hours this week?"),
                      ]
                ).map((s, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    onClick={() => setInput(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}

        {turns.map((t) => (
          <div
            key={t.id}
            className={t.role === "user" ? "ms-auto max-w-[85%] " : "me-auto max-w-[90%] "}
          >
            {t.quiz ? (
              <QuizSession
                title={t.quiz.title}
                questions={t.quiz.questions}
                corrected={t.quiz.corrected}
                onDone={() =>
                  setStreamed((p) =>
                    p
                      ? p.map((x) =>
                          x.id === t.id
                            ? { ...x, quiz: undefined, text: tr("انتهى الاختبار", "Quiz finished") }
                            : x,
                        )
                      : p,
                  )
                }
              />
            ) : t.quizOffer ? (
              <div className="space-y-2">
                {t.text && (
                  <p className="rounded-2xl rounded-es-sm bg-muted px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
                    {t.text}
                  </p>
                )}
                <QuizBuilder
                  subjects={pickerSubjects}
                  materials={pickerMaterials}
                  defaultSubject={t.quizOffer.subjectKey}
                  defaultTopic={t.quizOffer.topic}
                  busy={quizBusy}
                  onGenerate={(src) => runQuiz(src, t.id)}
                />
                {t.error && (
                  <p className="text-sm text-destructive">
                    {tr("خطأ:", "Error:")} {t.error}
                  </p>
                )}
              </div>
            ) : (
            <div
              className={
                t.role === "user"
                  ? "ms-auto w-fit rounded-2xl rounded-ee-sm bg-primary px-3 py-2 text-primary-foreground"
                  : "rounded-2xl rounded-es-sm bg-muted px-3 py-2"
              }
            >
              {t.images && t.images.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {t.images.map((a, i) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      key={i}
                      src={a.uri}
                      alt={a.name}
                      className="h-20 w-20 rounded-lg object-cover"
                    />
                  ))}
                </div>
              )}
              {t.text && <p className="whitespace-pre-wrap text-sm leading-relaxed">{t.text}</p>}
              {!t.text && !t.error && t.role === "assistant" && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {t.error && (
                <p className="text-sm text-destructive">
                  {tr("خطأ:", "Error:")} {t.error}
                </p>
              )}
              {t.applied && t.applied.length > 0 && (
                <ul className="mt-2 space-y-0.5 border-t pt-2 text-xs">
                  {t.applied.map((a, i) => (
                    <li
                      key={i}
                      className={a.ok ? "text-emerald-600" : "text-destructive"}
                    >
                      {a.ok ? <Check className="inline h-3 w-3" /> : <X className="inline h-3 w-3" />}{" "}
                      {a.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            )}
          </div>
        ))}
      </div>

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a, i) => (
            <div key={i} className="relative">
              {a.uri.startsWith("data:image/") ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={a.uri} alt={a.name} className="h-16 w-16 rounded-lg object-cover" />
              ) : (
                <span className="grid h-16 w-16 place-items-center rounded-lg bg-muted p-1 text-center text-[9px]">
                  {a.name}
                </span>
              )}
              <button
                onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                className="absolute -end-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-destructive text-white"
                aria-label={tr("شيل", "Remove")}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={def.supportsPdf ? "image/*,application/pdf" : "image/*"}
          multiple
          hidden
          onChange={(e) => void pickFiles(e.target.files)}
        />
        <Button
          size="icon"
          variant="outline"
          className="h-12 w-12 shrink-0"
          disabled={!canAttach || images.length >= 6}
          onClick={() => fileRef.current?.click()}
          aria-label={tr("ارفع صورة", "Attach a file")}
        >
          <Paperclip className="h-4 w-4" />
        </Button>

        <Textarea
          value={input}
          rows={1}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={tr("اكتب سؤالك…", "Ask anything…")}
          className="max-h-32 min-h-12 resize-none text-base"
        />

        {busy ? (
          <Button
            size="icon"
            variant="destructive"
            className="h-12 w-12 shrink-0"
            onClick={() => abortRef.current?.abort()}
            aria-label={tr("قف", "Stop")}
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="h-12 w-12 shrink-0"
            disabled={!input.trim()}
            onClick={() => void send()}
            aria-label={tr("ابعت", "Send")}
          >
            <Send className="h-4 w-4" />
          </Button>
        )}

        {turns.length > 0 && (
          <Button
            size="icon"
            variant="ghost"
            className="h-12 w-12 shrink-0"
            onClick={() => {
              if (chats.activeId) void chats.deleteChat(chats.activeId);
              setStreamed([]);
            }}
            aria-label={tr("امسح المحادثة", "Clear chat")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
