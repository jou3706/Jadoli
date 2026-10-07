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
];

export const tourForPath = (pathname: string): TourConfig | undefined =>
  TOURS.find((t) => t.match === pathname);

const NS = "jadoli_tour_seen";

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
export const TOUR_START_EVENT = "jadoli:start-tour";

export const startTour = (): void => {
  try {
    window.dispatchEvent(new CustomEvent(TOUR_START_EVENT));
  } catch {
    /* calling it before the browser exists is a no-op */
  }
};