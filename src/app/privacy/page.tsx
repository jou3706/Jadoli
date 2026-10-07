"use client";

import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const LAST_UPDATED = "7 أكتوبر 2026";

export default function PrivacyPage() {
  const { tr } = useI18n();

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b bg-card/40">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 font-display font-bold text-primary"
          >
            <CalendarDays className="h-5 w-5" />
            {tr("جدولي", "Jadoli")}
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium text-muted-foreground underline"
          >
            {tr("تسجيل الدخول", "Sign in")}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="font-display text-3xl font-bold">
          {tr("سياسة الخصوصية", "Privacy Policy")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr(
            "آخر تحديث: " + LAST_UPDATED,
            "Last updated: " + LAST_UPDATED,
          )}
        </p>

        <div className="mt-8 space-y-8 text-[15px] leading-7">
          <section>
            <h2 className="font-display text-lg font-bold">
              {tr("البيانات اللي نجمعها", "The data we collect")}
            </h2>
            <p>
              {tr(
                "بنخزّن بس اللي محتاجينه عشان التطبيق يشتغل: بيانات حسابك (الإيميل واسمك، ومعلومات الدخول عبر جوجل لو استخدمتها)، والبيانات اللي بتضيفها بنفسك (الجدول، الحضور، الدرجات، المواد، الأسئلة، الأحداث والمراجعات)، والملفات اللي بترفعها عشان المساعد يقراها (PDF أو صور أو عروض تقديمية). كمان بنحتفظ باشتراك إشعاراتك لو فعلتها — وده رقم بيشاور على متصفحك، مش محتوى رسايلك.",
                "Only what the app needs to run: your account (email, name, and Google sign-in data if you use it), the data you add yourself (timetable, attendance, grades, subjects, questions, events and reviews), and the files you upload for the assistant to read (PDFs, images or slides). We also keep your push subscription if you enable it — that identifies your browser, not the content of your messages.",
              )}
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold">
              {tr(
                "البيانات اللي بنبعتلها للذكاء الاصطناعي",
                "Data sent to AI providers",
              )}
            </h2>
            <p>
              {tr(
                "لما تطلب من المساعد إنه يلخص محاضرة، أو يبنّي لك اختبار من مادة، أو يجاوب على سؤال، بنبعت المحتوى المطلوب (الملف أو المادة أو بنك الأسئلة) لخدمات الذكاء الاصطناعي (جوجل جيميناي / جروك / أوبنروتر) عشان يولّدولك الرد. من غير إرسال المحتوى مستحيل تيجي الإجابة، فلو محتوى المشترك في هذا لازم تعرف إن بيخرج لخدمة خارجية.\nبنبعت أقل قدر ممكن: بس المحتوى المطلوب للمهمة، من غير كلمة السر ولا بيانات الدخول.",
                "When you ask the assistant to summarise a lecture, build a quiz from a subject, or answer a question, we send the requested content (the file, the subject, or the question bank) to AI services (Google Gemini / Groq / OpenRouter) to produce the reply. Without sending that content the answer cannot be generated, so if the content is confidential you should know it leaves for an external service.\nWe send the minimum needed for the task — never your password or session data.",
              )}
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold">
              {tr("ليه بنجمعها", "Why we collect it")}
            </h2>
            <p>
              {tr(
                "عشان نشغّل التطبيق ونخزّن بياناتك على أجهزتك وأكتر من جهاز، ونبعتلك التنبيهات اللي طلبتها، ونحافظ على أمان الحسابات ومنع إساءة استخدام ميزات الذكاء الاصطناعي من خلال حد أقصى لعدد الطلبات.",
                "To run the app, keep your data available across your devices, send the reminders you asked for, secure accounts, and prevent abuse of the AI features through a request limit.",
              )}
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold">
              {tr(
                "مين اللي نقدر نشارك بياناتك معاه",
                "Who data is shared with",
              )}
            </h2>
            <p>
              {tr(
                "مزوّدو الذكاء الاصطناعي بس، بالحد اللي فوق. بنخزّن بياناتك على استضافة Supabase المضمّنة. مش بنبيع بياناتك ولا بنشاركها مع أي طرف تاني.",
                "Only the AI providers, to the extent described above. Your data is stored on the Supabase hosting the app uses. We do not sell your data or share it with anyone else.",
              )}
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold">
              {tr("حذف بياناتك", "Deleting your data")}
            </h2>
            <p>
              {tr(
                "تقدر تطلب حذف حسابك وكل بياناته في أي وقت، وبنتأكد إنها بتشال من قاعدة البيانات. قبل الحذف تقدر برضه تمسح أي ملف أو مادة لوحدها.",
                "You can ask for your account and all of its data to be deleted at any time, and we make sure it is removed from the database. Before deleting the account you can also remove any single file or material.",
              )}
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold">
              {tr("حماية البيانات", "Data protection")}
            </h2>
            <p>
              {tr(
                "بنستخدم التشفير أثناء النقل، وأذونات صارمة عشان ما حدش يشوف بيانات غيرو، ومفاتيح المزوّدين والخدمات محفوظة في السيرفر بس ومش بتوصل لمتصفحك أبدًا.",
                "We use encryption in transit, strict permissions so nobody can see anyone else's data, and provider/service keys live only on the server and never reach your browser.",
              )}
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold">
              {tr("تواصل معانا", "Contact us")}
            </h2>
            <p>
              {tr(
                "عندك سؤال عن الخصوصية أو عايز تحذف حسابك؟ ابعتلنا على الإيميل الخاص بالدعم والموجود في صفحة التطبيق الرسمية.",
                "Questions about privacy, or want your account deleted? Email us through the contact address on the app's official page.",
              )}
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}