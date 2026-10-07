/**
 * One short guide per page: what the page does and exactly what to do with it.
 *
 * Content lives here so the pages themselves stay thin and the copy is easy to
 * review. Each guide is shown once per account (see `readPageSeen`) and can be
 * reopened at any time from the header's help button.
 */

export interface PageGuide {
  key: string;
  match: string;
  title: [string, string];
  features: [string, string][];
  steps: [string, string][];
}

export const PAGE_GUIDES: PageGuide[] = [
  {
    key: "schedule",
    match: "/",
    title: ["الجدول", "Schedule"],
    features: [
      [
        "محاضراتك أول بأول، وبطاقة \"الجاية\" بتفرش المحاضرة اللي جاية وكم باقي عليها",
        "Your lectures day by day, with a card showing the next one and how long until it starts",
      ],
      [
        "شرائح الأيام تقفز بيك بين النهارده وبكره وأي يوم تاني",
        "Day tabs jump between today, tomorrow and any other day",
      ],
      [
        "زرار + العائم يضيف محاضرة في ثواني (مادة، يوم، وقت، مكان)",
        "The floating + adds a lecture in seconds: course, day, time, place",
      ],
      [
        "وضع التعديل في البار يعدّل أو يمسح أي محاضرة",
        "Edit mode in the header changes or deletes any lecture",
      ],
      [
        "التصدير والمشاركة من هنا: صور، رابط، ويوم كامل في تقويمك",
        "Share and export live here: images, a link, or your week in your calendar",
      ],
    ],
    steps: [
      ["اقرا بطاقة \"الجاية\" فوق عشان تعرف محاضرتك القادمة", "Read the next-lecture card at the top to know what is coming"],
      ["بدّل اليوم من الشرائح لو محتاج يوم تاني", "Switch days from the tabs if you need another day"],
      ["حط محاضرة جديدة بزرار +، أو فعّل التعديل وعدّل/امسح", "Add a new lecture with +, or turn on Edit to change or delete"],
      ["لو عايز الجدول محفوظ، صدّره أو ابعته رابط", "To keep the schedule safe, export it or share a link"],
    ],
  },
  {
    key: "week",
    match: "/week",
    title: ["الأسبوع كله", "Full week"],
    features: [
      [
        "شبكة الأسبوع الكاملة: كل الأيام السبعة في جدول واحد",
        "The whole week: all seven days in one grid",
      ],
      [
        "تصدير iCalendar يفتح الأسبوع في تقويم الهاتف مباشرة",
        "An iCalendar export drops the week straight into the phone calendar",
      ],
      [
        "مشاركة الجدول برابط أو نسخة كاملة لحساب تاني",
        "Share the schedule by link or copy it to another account",
      ],
      [
        "المراجعات والأحداث الجامعية بتظهر في الشبكة مع المحاضرات",
        "Review sessions and university events sit in the grid with lectures",
      ],
    ],
    steps: [
      ["لفّ للنهاردة أو دوّر على اليوم اللي مهتم بيه", "Scroll to today or to the day you care about"],
      ["فعّل التعديل عشان تغيّر أي محاضرة من الشبكة نفسها", "Turn on Edit to change any lecture from the grid"],
      ["زرار التصدير وينزّل ملف تقويم مرتب للأسبوع", "The export button download a tidy calendar file of the week"],
    ],
  },
  {
    key: "attendance",
    match: "/attendance",
    title: ["الحضور", "Attendance"],
    features: [
      [
        "كل محاضرة ليها بدّال يحفظ حضورك أو غيابك بضغطة",
        "Every lecture has a toggle that stores present or absent in one tap",
      ],
      [
        "نسبة كل مادة تتحسب لحظيًا وبتترتب بتبدأ بالأضعف",
        "Each course's rate is live, ranked with the weakest first",
      ],
      [
        "سلسلة الأيام المتتالية بتحفّزك تكمل من غير ما تقطع",
        "A streak keeps you going without breaking the run",
      ],
      [
        "لما مادة تنزل تحت الحد، بتتلون بدري قبل النتائج",
        "A course dropping below the threshold lights up before results",
      ],
    ],
    steps: [
      ["اضغط بدّال الحضور بتاع المحاضرة اللي حضرتها وخلاص", "Tap the toggle on the lecture you attended and you are done"],
      ["شوف ترتيب المواد: الأضعف دايمًا فوق عشان تبدأ بيه", "Check the ranking: the weakest course sits on top, start there"],
      ["كل أسبوع حافظ على السلسلة وبتفضل في الأمان", "Keep the streak alive each week and you stay safe"],
    ],
  },
  {
    key: "subjects",
    match: "/subjects",
    title: ["المواد", "Subjects"],
    features: [
      [
        "كل مادة ليها بطاقة فيها بياناتها: دكتور، مكان، محاضرات",
        "Each course has a card with its details: lecturer, place, sessions",
      ],
      [
        "أضف ملفات ومذكرات ولينكات لكل مادة من زرارها الخاص",
        "Add files, notes and links to any course from its own + button",
      ],
      [
        "تبويب الأحداث بتاع كل مادة بجمع امتحاناتها وواجباتها بعداد تنازلي",
        "Each course's events tab collects its exams and assignments with a countdown",
      ],
      [
        "توليد كروت المراجعة بيخلي ملفاتك فلاش كارد جاهزة للحفظ",
        "Generate-cards turns your uploaded files into ready review flashcards",
      ],
    ],
    steps: [
      ["ابدأ ببطاقة: زرار + يضيف أول مادة", "Start with the card: the + button adds your first course"],
      ["افتح المادة وارفع ملفاتها (PDF/صور/لينكات)", "Open the course and upload its files: PDFs, images, links"],
      ["اضغط توليد الكروت عشان تحفظ من الملفات دي", "Press generate-cards so the files become flashcards"],
      ["تابع أحداث المادة (امتحانات/واجبات) من أيقونة الأحداث", "Track the course's events from the events icon"],
    ],
  },
  {
    key: "review",
    match: "/review",
    title: ["المراجعة", "Review"],
    features: [
      [
        "كروت الفلاش المستحقة للنهارده بس — ولا كارت قبل ميعاده",
        "Only today's due cards — never a card before its time",
      ],
      [
        "أنت اللي تحكم: عرفتها تتباعد، غلطت فيها بترجع بدري",
        "You grade yourself: known cards space out, missed ones come back sooner",
      ],
      [
        "خطة الأسبوع بتوصلها بامتحاناتك فتقولك تراجع إمتى",
        "The weekly plan ties reviews to your exams and says when to sit",
      ],
      [
        "مفيش كروت لسه؟ زر التوليد بياخدها من الملفات اللي رفعتها",
        "No cards yet? The generate button draws from the files you uploaded",
      ],
    ],
    steps: [
      ["اقرا السؤال وجاوب في دماغك قبل ما تكشف", "Read the question and answer in your head before flipping"],
      ["حكم على نفسك: عرفت أو ممعرفتش — والمواعيد بيتظبطوا", "Grade yourself right or wrong and the spacing adjusts"],
      ["خلص نصيب النهارده، وبعدين بص في الخطة للفترة الجاية", "Finish today's set, then check the plan for what is next"],
    ],
  },
  {
    key: "quiz",
    match: "/quiz",
    title: ["الاختبارات", "Quiz"],
    features: [
      [
        "اختار المادة أو كل المواد وعدد الأسئلة (من 3 لـ 100) والذكاء الاصطناعي يولّدها من ملفاتك",
        "Pick a course — or everything — and 3–100 questions generated by AI from your files",
      ],
      [
        "جاوب على كل سؤال قبل ما تكشف، وكل سؤال بيشرح ليه إجابته صح",
        "Answer before revealing, and each question explains why its answer is right",
      ],
      [
        "في الآخر بتاخد نتيجتك زي امتحان حقيقي",
        "You get a score at the end, like a real exam",
      ],
      [
        "الأسئلة اللي خلصتها بتتحفظ في بنك الأسئلة تلقائيًا",
        "Finished questions are saved to the question bank automatically",
      ],
    ],
    steps: [
      ["اختار المصدر وعدد الأسئلة واضغط توليد", "Choose the source and count, then hit generate"],
      ["جاوب سؤال سؤال، وبعدين كشف الإجابة والسبب", "Answer one by one, then reveal the answer and the reason"],
      ["راجع نتيجتك وكرر الاختبار على اللي غلطت فيه", "Review your score and redo what you missed"],
    ],
  },
  {
    key: "questions",
    match: "/questions",
    title: ["بنك الأسئلة", "Question bank"],
    features: [
      [
        "كل سؤال اتعرض ليك في اختبار أو المساعد، مترتب على المواد",
        "Every question you have seen, grouped by course",
      ],
      [
        "صح/خطأ، اختيار من متعدد، وإجابات قصيرة مع بعض",
        "True/false, multiple choice and short answers together",
      ],
      [
        "افتح أي سؤال تشوف إجابته وسبب إنها الصح",
        "Open any question to read the answer and why it is right",
      ],
      [
        "بحث فوري وسلة حذف نضيفة",
        "Instant search and a clean way to delete",
      ],
    ],
    steps: [
      ["اكتب اسم المادة أو كلمة في البحث", "Search by course or by keyword"],
      ["افتح المادة ودوّر على السؤال اللي عايز تذكره", "Open the course and find the question you want to revisit"],
      ["امسح أي سؤال من زرار السلة لو مش محتاجه", "Delete any question from its trash icon if you do not need it"],
    ],
  },
  {
    key: "gpa",
    match: "/gpa",
    title: ["المعدل", "GPA"],
    features: [
      [
        "ضيف علامات موادك (رمز، ساعات، درجة) والمعدل بيتحسب لوحده",
        "Add your grades and the GPA computes itself",
      ],
      [
        "يدعم فصول متعددة وبيجمعهم في معدل كلي واحد",
        "Multiple semesters roll into one overall GPA",
      ],
      [
        "ميزة What-if: جرّب درجة قبل امتحانها وشوف أثرها",
        "What-if: try a grade before the exam and see its impact",
      ],
      [
        "سمج الدرجات ثابت، فالأرقام اللي تخرج من هنا موثوقة",
        "The grade scale is fixed, so the numbers coming out are trustworthy",
      ],
    ],
    steps: [
      ["ضيف كل مادة بحروفها وساعتها من زرار +", "Add each course with its letter and hours via the + button"],
      ["اقرا معدلك في أول الصفحة", "Read your GPA at the top of the page"],
      ["استخدم What-if عشان تشوف إيه اللي يرفعك قبل ما تذاكر", "Use What-if to see what lifts your average before studying"],
    ],
  },
  {
    key: "events",
    match: "/events",
    title: ["الأحداث", "Events"],
    features: [
      [
        "كل أحداث الجامعة: امتحانات، كويزات، واجبات، وإعلانات",
        "All university events: exams, quizzes, assignments and announcements",
      ],
      [
        "إضافة بعنوان عربي وإنجليزي وتاريخ ونوع ونوتة",
        "Add with an Arabic and English title, date, type and a note",
      ],
      [
        "الحدث بيظهر تلقائيًا في الجدول وفي عرض الأسبوع",
        "The event shows automatically in the schedule and the week view",
      ],
      [
        "عداد تنازلي عشان أهم المواعيد تفضل قدامك",
        "A countdown keeps the big dates in front of you",
      ],
    ],
    steps: [
      ["اضغط +، اختار النوع، وكتب العنوان والتاريخ", "Tap +, choose the type, add the title and the date"],
      ["تقدر تكتب نوتة تفاصيل وبيتسجل في الجدول", "Optionally add a note, and it lands in the schedule"],
      ["عدّل أو شيل أي حدث من زراره", "Edit or remove any event from its own control"],
    ],
  },
  {
    key: "assistant",
    match: "/assistant",
    title: ["المساعد", "Assistant"],
    features: [
      [
        "بيقري ملفاتك وجدولك: اسأل عن مادة أو منهج أو طريقة مراجعة",
        "Reads your files and schedule: ask about a course, a topic or how to study",
      ],
      [
        "أفعال مش كلام: يقدر يضيف محاضرات وأحداث ودرجات — بموافقتك",
        "Actions, not talk: it can add lectures, events and grades — with your approval",
      ],
      [
        "اكتب او اتكلم: إدخال صوتي عربي وإنجليزي مدمج",
        "Type or talk: Arabic and English voice input built in",
      ],
      [
        "تقدر تغيّر الموديل، ويولّد اختبارات كاملة داخل المحادثة",
        "Switch models, or ask it to build a full quiz inside the chat",
      ],
    ],
    steps: [
      ["اكتب سؤالك عن مادة أو ملف — أو اضغط المايك وقولها", "Ask about a course or file — or press the mic and say it"],
      ["لو عرض يضيف حاجة للجدول، راجع خطواته واضغط موافقة", "If it offers to add something, review the steps and approve"],
      ["اقدر اطلب اختبار من المحادثة وبيعيديك على بنك الأسئلة", "Ask for a quiz and it hands it to the question bank"],
      ["غيّر الموديل من القايمة لو محتاج سرعة أو دقة", "Switch the model from the menu when you need speed or depth"],
    ],
  },
  {
    key: "import",
    match: "/import",
    title: ["استيراد", "Import"],
    features: [
      [
        "صور جدولك الورقي والجدول يتبني من غير كتابة",
        "Photograph your paper timetable and it rebuilds without typing",
      ],
      [
        "أو استورد ملف الجدول من الكلية مباشرة",
        "Or import your college's schedule file directly",
      ],
      [
        "معاينة قبل الحفظ: عدّل أي صف خطأ سطر بسطر",
        "Review before saving: fix any misread row line by line",
      ],
      [
        "الخانات بتبقى محاضراتك بنفس ألوانها في الجدول",
        "The rows become your lectures, colours included, right in the schedule",
      ],
    ],
    steps: [
      ["ارفع صورة الجدول أو الملف وبيتحل تلقائيًا", "Upload the image or file it parses automatically"],
      ["راجع المعاينة: عدّل اسم المادة أو اليوم أو الوقت لو حصل لبس", "Check the preview: fix course, day or time if it mixed up"],
      ["اضغط استيراد — والمحاضرات تنزل في الجدول جاهزة", "Press import and the lectures land in the schedule ready"],
    ],
  },
];

export const pageGuideFor = (pathname: string): PageGuide | undefined =>
  PAGE_GUIDES.find((g) => pathname === g.match);

const NS = "jadwali_page_seen";

export const readPageSeen = (who: string, page: string): boolean => {
  try {
    return localStorage.getItem(`${NS}:${who}:${page}`) === "1";
  } catch {
    return false;
  }
};

export const markPageSeen = (who: string, page: string): void => {
  try {
    localStorage.setItem(`${NS}:${who}:${page}`, "1");
  } catch {
    /* a blocked disk is not a reason to keep nagging the student */
  }
};