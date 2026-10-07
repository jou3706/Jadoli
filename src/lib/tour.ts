/**
 * Interactive tour steps, one tour per page.
 *
 * The teaching a step points at is a CSS selector carrying a `data-tour` name
 * on the page's own elements, so wiring a new page is: write the steps here,
 * sprinkle the attributes in the page, and the shell picks it up. Whether a
 * page is taught by the tours or by the static card is decided by the tour
 * existing at all — a page with a tour is too important for only a card.
 */

export type TourStepPosition =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left-aligned"
  | "top-right-aligned"
  | "top-middle-aligned"
  | "bottom-left-aligned"
  | "bottom-right-aligned"
  | "bottom-middle-aligned";

export type TourStep = {
  /** A CSS selector for an element carrying `data-tour="…"`. */
  selector: string;
  title: [string, string];
  intro: [string, string];
  position: TourStepPosition;
};

export type TourConfig = {
  /** Must equal the page-guide key for the same page, so the two never fight. */
  key: string;
  match: string;
  steps: TourStep[];
};

export const TOURS: TourConfig[] = [
  {
    key: "schedule",
    match: "/",
    steps: [
      {
        selector: '[data-tour="today-hero"]',
        title: ["بطاقة النهاردة", "Today's card"],
        intro: [
          "كل اللي محتاجه النهارده في مكان واحد: عدد محاضراتك، المحاضرة الجاية، الامتحانات القريبة، معدلك، ونسبة حضورك.",
          "Everything you need today in one place: how many lectures, the next one, exams coming up, your GPA, and this week's attendance.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="day-tabs"]',
        title: ["شرائح الأيام", "Day tabs"],
        intro: [
          "دوس على أي يوم تاني (بكره، بعد بكره…) عشان تشوف جدوله وترتب لنفسك من بدري.",
          "Tap any other day to see its schedule and plan ahead of time.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="lecture-list"]',
        title: ["محاضرات اليوم", "The day's lectures"],
        intro: [
          "كل محاضرة هنا حاملة وقتها ومكانها ودكتورها، ولو فعّلت وضع التعديل هتلاقي زرار حضور ومسح على كل واحدة.",
          "Each lecture shows its time, place and doctor; with Edit on, each one also has attendance and delete.",
        ],
        position: "left",
      },
      {
        selector: '[data-tour="search"]',
        title: ["البحث", "Search"],
        intro: [
          "جدولك كبر؟ اكتب اسم المادة أو الدكتور هنا والجدول بيترشّح على طول.",
          "Schedule got big? Type a course or a doctor name here to filter instantly.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="edit-schedule"]',
        title: ["وضع التعديل", "Edit mode"],
        intro: [
          "فعّل التعديل عشان تعدّل أو تمسح أي محاضرة بأمان، ومن غير ما تمسح كل الجدول غلط.",
          "Turn Edit mode on to change or delete any lecture safely.",
        ],
        position: "left",
      },
      {
        selector: '[data-tour="add-lecture"]',
        title: ["زرار الإضافة", "Add lecture"],
        intro: [
          "زرار + ده يضيف محاضرة جديدة في ثواني: المادة واليوم والوقت والمكان.",
          "The + button adds a new lecture in seconds: course, day, time and place.",
        ],
        position: "top",
      },
    ],
  },
  {
    key: "week",
    match: "/week",
    steps: [
      {
        selector: '[data-tour="week-header"]',
        title: ["الأسبوع كله", "Full week"],
        intro: [
          "أسبوعك كله في شبكة واحدة من السبت للخميس — محاضراتك وجلسات المراجعة ومناسبات الجامعة في مكان واحد.",
          "Your whole week in one grid, Sat to Thu — lectures, review sessions and university events all in one place.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="week-export"]',
        title: ["صدّر وشارك", "Export & share"],
        intro: [
          "الصق سكرين-شوت، صدّره كملف تقويم يفتح في تقويم الهاتف مباشرة، أو ابعته كامل لحساب تاني.",
          "Screenshot it, export an iCalendar file that opens straight in the phone calendar, or send a full copy to another account.",
        ],
        position: "left",
      },
      {
        selector: '[data-tour="week-grid"]',
        title: ["شبكة الجدول", "The week grid"],
        intro: [
          "شوف كل محاضرة في يومها وساعتها. فعّل وضع التعديل من فوق عشان تضيف أو تعدّل مباشرة من الشبكة.",
          "Every lecture in its day and hour. Turn Edit mode on above to add or change right in the grid.",
        ],
        position: "top",
      },
      {
        selector: '[data-tour="edit-toggle"]',
        title: ["وضع التعديل", "Edit mode"],
        intro: [
          "دوس تعديل، وهتلاقي + في الفراغات، وأي محاضرة تفتحها تبقى قابلة للتعديل من الشبكة نفسها.",
          "Tap Edit and you get + in the gaps, and any lecture you open is editable right on the grid.",
        ],
        position: "bottom",
      },
    ],
  },
  {
    key: "attendance",
    match: "/attendance",
    steps: [
      {
        selector: '[data-tour="attendance-header"]',
        title: ["الحضور", "Attendance"],
        intro: [
          "سجّل محاضراتك اللي حضرتها وشوف نسبتك أسبوعًا بأسبوع.",
          "Log the lectures you attended and watch your rate week by week.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="attendance-stats"]',
        title: ["أرقامك المهمة", "Your numbers"],
        intro: [
          "حضور الأسبوع، إجمالي المحاضرات اللي حضرتها، وعدد الأسابيع المتتبعة — كلها قدامك.",
          "This week's attendance, sessions you've attended, and weeks tracked — all up front.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="attendance-risk"]',
        title: ["المواد على الخط", "Courses on the line"],
        intro: [
          "الحد 75%، وكل مادة بتقولك تقدّر تغيب كام محاضرة كمان وتفضل فوق الخط. الأحمر = خطر.",
          "The line is 75% and each course tells you how many more sessions you can miss. Red means risk.",
        ],
        position: "left",
      },
      {
        selector: '[data-tour="attendance-chart"]',
        title: ["آخر 8 أسابيع", "Last 8 weeks"],
        intro: [
          "الرسمة دي بتوضح نظامك بيتماسك ولا بيفضّ، عشان تعرف تظبط مجهودك.",
          "This chart shows whether your run is steady or slipping, so you can pace yourself.",
        ],
        position: "top",
      },
    ],
  },
  {
    key: "subjects",
    match: "/subjects",
    steps: [
      {
        selector: '[data-tour="subjects-header"]',
        title: ["موادي", "My subjects"],
        intro: [
          "كل مادة ليك في بطاقة: دكتورها، مكانها، محاضراتها، ملفاتها وأحداثها.",
          "Every course has a card: its lecturers, place, sessions, files and events.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="subject-add"]',
        title: ["ضيف ملفات ومذكرات", "Add files & notes"],
        intro: [
          "اسحب أي ملف من جهازك على السطر ده، أو الصق لينك — بيتربط بالمادة على طول.",
          "Drag any file from your device onto this row, or paste a link — it attaches to the course at once.",
        ],
        position: "left",
      },
      {
        selector: '[data-tour="subject-actions"]',
        title: ["إدارة المادة", "Manage the course"],
        intro: [
          "ثلاثة أزرار على سطر واحد: ملفات المادة، أحداثها، وتوليد كروت المراجعة منها.",
          "Three actions in one row: the course's materials, its events, and generating review cards from it.",
        ],
        position: "left",
      },
      {
        selector: '[data-tour="subjects-empty"]',
        title: ["أول مادة", "Your first course"],
        intro: [
          "لما تضيف أول محاضرة أو ملف، بطاقة المادة تظهر هنا وكل حاجة تترتب حوالينها.",
          "Add a first lecture or file and the course's card appears here, everything building around it.",
        ],
        position: "bottom",
      },
    ],
  },
  {
    key: "review",
    match: "/review",
    steps: [
      {
        selector: '[data-tour="review-header"]',
        title: ["المراجعة", "Review"],
        intro: [
          "كروت مصنوعة من ملاحظاتك بترجع لك في معادها. زرار «كروت جديدة» يولّدها من ملفاتك.",
          "Cards made from your notes come back when due. The \"New cards\" button generates them from your files.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="review-stats"]',
        title: ["حالة الكروت", "Card status"],
        intro: [
          "مستنية دلوقتي، جديدة، لسه بتحفضها، ومرسّخة — شوف شغلك في نظرة.",
          "Due now, new, learning, and known — your workload at a glance.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="review-queue"]',
        title: ["ابدأ جلسة مراجعة", "Start a session"],
        intro: [
          "اضغط ابدأ وجاوب بصراحة: الكارت اللي عرفته يتباعد، واللي غلطت فيه يرجع بدري.",
          "Press Start and answer honestly: known cards space out, missed ones come back sooner.",
        ],
        position: "left",
      },
      {
        selector: '[data-tour="review-empty"]',
        title: ["أول كروت", "First cards"],
        intro: [
          "لسه مفيش كروت؟ زرار «كروت جديدة» بيعملها من مذكراتك وملفاتك على طول.",
          "No cards yet? \"New cards\" turns your notes and files into review cards right away.",
        ],
        position: "bottom",
      },
    ],
  },
  {
    key: "quiz",
    match: "/quiz",
    steps: [
      {
        selector: '[data-tour="quiz-header"]',
        title: ["اختبارات من ملفاتك", "Exams from your files"],
        intro: [
          "الذكاء الاصطناعي بيلخص ملفاتك ويجيب أسئلة اختيار من متعدد وصح/خطأ وقصيرة.",
          "AI draws multiple-choice, true/false and short questions from your files.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="quiz-builder"]',
        title: ["اختار الاختبار", "Build the exam"],
        intro: [
          "اختار المادة أو كل المواد، عدد الأسئلة من 3 لـ 100، واللغة — والاختبار بيتولّد من ملفاتك.",
          "Pick a course or everything, 3–100 questions, and the language — the exam is generated from your files.",
        ],
        position: "left",
      },
      {
        selector: '[data-tour="quiz-bank"]',
        title: ["بنك الأسئلة", "Question bank"],
        intro: [
          "كل سؤال شفته بيتحفظ في البنك، فالمكرر متتكررش واللي فاتك يرجع له في أي وقت.",
          "Every question you see is kept in the bank, so nothing repeats and you can revisit what you missed.",
        ],
        position: "bottom",
      },
    ],
  },
  {
    key: "questions",
    match: "/questions",
    steps: [
      {
        selector: '[data-tour="bank-header"]',
        title: ["بنك الأسئلة", "Question bank"],
        intro: [
          "كل سؤال اتعرض ليك في اختبار أو المساعد، مترتب على المواد، مع إجابته وسبب صحته.",
          "Every question you've faced in a quiz or the assistant, grouped by course, with answers and reasons.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="bank-search"]',
        title: ["دوّر بسرعة", "Search fast"],
        intro: [
          "اكتب كلمة من السؤال أو اسم المادة والبنك بيتفلتر لحظيًا.",
          "Type a word from a question or a course name and the bank filters instantly.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="bank-row"]',
        title: ["افتح وشوف الإجابة", "Open to see the answer"],
        intro: [
          "افتح أي سؤال تقرا إجابته والسبب، وامسحه بزرار السلة لو مش محتاجه.",
          "Open any question to read its answer and why it is right, or remove it with the trash icon.",
        ],
        position: "left",
      },
      {
        selector: '[data-tour="bank-empty"]',
        title: ["ابدأ من الاختبارات", "Start from a quiz"],
        intro: [
          "لسه مفيش أسئلة؟ اعمل أي اختبار من صفحة الاختبارات والأسئلة بتتحفظ هنا لوحدها.",
          "No questions yet? Take any quiz and its questions are kept here on their own.",
        ],
        position: "bottom",
      },
    ],
  },
  {
    key: "gpa",
    match: "/gpa",
    steps: [
      {
        selector: '[data-tour="gpa-header"]',
        title: ["حاسبة المعدل", "GPA calculator"],
        intro: [
          "حط موادك وساعاتها وتقديراتها، والمعدل التراكمي بيتحسب لوحده.",
          "Enter your courses, credit hours and grades and the GPA computes itself.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="gpa-add"]',
        title: ["ضيف مادة", "Add a course"],
        intro: [
          "اختار المادة من جدولك أو اكتبها، واكتب الساعات والتقدير واسم الترم.",
          "Pick a course from your schedule or type it; add hours, the grade letter and the semester name.",
        ],
        position: "left",
      },
      {
        selector: '[data-tour="gpa-stats"]',
        title: ["معدلك في لحظة", "Your GPA instantly"],
        intro: [
          "المعدل الكلي والساعات والنقاط — بتتحدث مع كل إضافة.",
          "GPA, hours and points — updated with every entry.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="gpa-whatif"]',
        title: ["What-if", "What-if"],
        intro: [
          "جرّب: «لو جبت A في 3 ساعات» — شوف أثرها على معدلك قبل ما تذاكر، ومن غير ما تحفظ حاجة.",
          "Try it: \"what if I get an A in 3 hours\" — see the impact before studying, nothing is saved.",
        ],
        position: "top",
      },
    ],
  },
  {
    key: "events",
    match: "/events",
    steps: [
      {
        selector: '[data-tour="events-header"]',
        title: ["مناسبات الجامعة", "University events"],
        intro: [
          "امتحاناتك وكويزاتك وواجباتك وإعلاناتك في مكان واحد، وبتظهر في جدولك تلقائيًا.",
          "Exams, quizzes, assignments and announcements in one place, shown automatically in your schedule.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="events-add"]',
        title: ["ضيف مناسبة", "Add an event"],
        intro: [
          "اكتب العنوان بالعربي والإنجليزي، اختار النوع والتاريخ، وزود تفاصيل لو حبيت.",
          "Enter Arabic and English titles, the type, the date, and a note if you like.",
        ],
        position: "left",
      },
      {
        selector: '[data-tour="events-tabs"]',
        title: ["جاية وفاتت", "Upcoming & past"],
        intro: [
          "تبويبين يفصلوا اللي لسه جاي عن اللي عدى.",
          "Two tabs separate what is coming from what has passed.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="events-list"]',
        title: ["قايمة الأحداث", "The events list"],
        intro: [
          "كل مناسبة ليها تاريخ واضح، وتقدر تعدّلها أو تمسحها من زرارها.",
          "Each event shows a clear date, and you can edit or remove it from its own control.",
        ],
        position: "left",
      },
    ],
  },
  {
    key: "assistant",
    match: "/assistant",
    steps: [
      {
        selector: '[data-tour="assistant-modes"]',
        title: ["أوضاع المساعد", "Assistant modes"],
        intro: [
          "عام: شايف جدولك ودرجاتك. مواد: بيجاوب من ملفاتك بس. اختبارات: يعمللك امتحان جوه المحادثة.",
          "General: sees your schedule and grades. Materials: answers from your files only. Quiz: builds exams in the chat.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="assistant-chat"]',
        title: ["اسأل أي حاجة", "Ask anything"],
        intro: [
          "المساعد بيقرا ملفاتك وجدولك، وبيجاوب بأفعال مش كلام — بيضيف محاضرات ودرجات بموافقتك.",
          "It reads your files and schedule and replies with actions, not talk — it can add lectures and grades with your approval.",
        ],
        position: "top",
      },
      {
        selector: '[data-tour="assistant-input"]',
        title: ["اكتب أو اتكلم", "Type or talk"],
        intro: [
          "اكتب سؤالك، الصق صورة أو ملف، أو دوس المايك واملي بالعربي أو الإنجليزي.",
          "Type your question, attach a picture or file, or press the mic and dictate in Arabic or English.",
        ],
        position: "top",
      },
      {
        selector: '[data-tour="assistant-model"]',
        title: ["غيّر الموديل", "Switch models"],
        intro: [
          "من القايمة دي تبدّل بين موديلات مختلفة — نص، صور، أو PDF — حسب حاجتك.",
          "This menu swaps between providers and models — text, vision or PDF — to fit the task.",
        ],
        position: "bottom",
      },
    ],
  },
  {
    key: "import",
    match: "/import",
    steps: [
      {
        selector: '[data-tour="import-header"]',
        title: ["استيراد الجدول", "Import schedule"],
        intro: [
          "صوّر الجدول الورقي أو ارفع الـ PDF، والمساعد يقراه ويبني الجدول بدل الكتابة.",
          "Photograph your paper timetable or upload the PDF and the assistant rebuilds it instead of typing.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="import-drop"]',
        title: ["ارفع الملفات", "Upload your files"],
        intro: [
          "اسحب الصور هنا أو اختارها من الجهاز — لحد 8 ملفات، صورة أو PDF.",
          "Drag images here or choose files — up to 8, image or PDF.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="import-run"]',
        title: ["اقرا الجدول", "Read the timetable"],
        intro: [
          "دوس الزرار ده والذكاء الاصطناعي بيحول البروفات لصفوف جدول جاهزة.",
          "Press this and AI turns the photo into ready timetable rows.",
        ],
        position: "bottom",
      },
      {
        selector: '[data-tour="import-review"]',
        title: ["راجع قبل الحفظ", "Review before saving"],
        intro: [
          "قبل ما يتسجل، راجع المعاينة: عدّل أي اسم أو يوم أو وقت، وشيل اللي فهمه غلط.",
          "Before anything is saved, review the preview: fix any name, day or time, and remove what it misread.",
        ],
        position: "left",
      },
      {
        selector: '[data-tour="import-save"]',
        title: ["احفظ في الجدول", "Save to the schedule"],
        intro: [
          "احفظ والجدول بينزل في محاضراتك بنفس ألوانها، والمكرر بيتخطى أو بتسح الجدول القديم إن طلبت.",
          "Save and the lectures land in your schedule with their colors; duplicates are skipped or the old schedule replaced if you ask.",
        ],
        position: "top",
      },
    ],
  },
];

export const tourForPath = (pathname: string): TourConfig | undefined =>
  TOURS.find((t) => t.match === pathname);

const NS = "jadwali_tour_seen";

export const readTourSeen = (who: string, key: string): boolean => {
  try {
    return localStorage.getItem(`${NS}:${who}:${key}`) === "1";
  } catch {
    return false;
  }
};

export const markTourSeen = (who: string, key: string): void => {
  try {
    localStorage.setItem(`${NS}:${who}:${key}`, "1");
  } catch {
    /* a blocked disk is not a reason to keep nagging the student */
  }
};

/** Dispatched by the header's tour button to restart the current page's tour. */
export const TOUR_START_EVENT = "jadwali:start-tour";

export const startTour = (): void => {
  try {
    window.dispatchEvent(new CustomEvent(TOUR_START_EVENT));
  } catch {
    /* calling it before the browser exists is a no-op */
  }
};