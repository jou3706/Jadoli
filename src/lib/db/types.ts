export type Id = string;

export type Lecture = {
  id: Id;
  subject_name: string;
  subject_en: string;
  code: string;
  doctor: string;
  hall: string;
  /** 0=Sun … 6=Sat */
  day: number;
  start_time: string;
  end_time: string;
  kind: "lecture" | "section";
  color: string;
  notes: string;
  department: string;
  created_date: string;
};

export type Attendance = {
  id: Id;
  lecture_id: Id;
  date: string;
  week_start: string;
};

export type Grade = {
  id: Id;
  subject_name: string;
  code: string;
  credit_hours: number;
  letter: string;
  grade_point: number;
  semester: string;
};

export type Hall = {
  id: Id;
  name: string;
  campus: string;
  lat: number | null;
  lng: number | null;
  note: string;
  streetview_url: string;
};

export type Material = {
  id: Id;
  title: string;
  subject_key: string;
  url: string;
  type: string;
  /** Storage path when the file was uploaded; empty for a plain link. */
  file_path: string;
  size: number;
  created_date: string;
};

/** One row per course — holds the cover shown on the subjects page. */
export type Subject = {
  id: Id;
  name: string;
  image_url: string;
  /** Attribution required by the image licence, e.g. "Author · CC BY-SA 4.0". */
  image_credit: string;
  created_date: string;
};

/** What an event on a course is: a quiz, an exam, or something else due. */
export type SubjectEventKind = "quiz" | "exam" | "assignment" | "other";

/**
 * Something due on a course: a quiz, an exam, a submission.
 *
 * Not a column on the lecture. An exam happens on a date rather than a weekday,
 * and a course can have exams before it has any sessions at all. Keyed to the
 * course by name, the way `Material.subject_key` is.
 */
export type SubjectEvent = {
  id: Id;
  subject_key: string;
  title: string;
  kind: SubjectEventKind;
  /** A calendar date, `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM`, empty when the event has no set time. */
  start_time: string;
  /** `HH:MM`, empty when the event has no set time. */
  end_time: string;
  hall: string;
  note: string;
  /** Minutes before the start to announce it. 0 means at the moment it starts. */
  remind_minutes: number;
  created_date: string;
};

export type UniversityEvent = {
  id: Id;
  title: string;
  title_en: string;
  date: string;
  type: "holiday" | "announcement" | "exam" | "event";
  note: string;
};

/**
 * One question and its answer, and everything the app remembers about it.
 *
 * A card belongs to a course by name, the way `Material.subject_key` and
 * `SubjectEvent.subject_key` do, so a card can exist for a course that has no
 * row in `subjects` yet.
 *
 * The scheduling fields are one flat row rather than a table of reviews: the
 * next date is all that is needed to show the card again, and a history of every
 * past answer is a thing nobody reads and a thing that has to be kept correct.
 */
export type Flashcard = {
  id: Id;
  subject_key: string;
  question: string;
  answer: string;
  /** Where it came from, so a wrong card can be traced back to its notes. */
  source: string;
  /** `typed` for something written by hand, `notes` for an uploaded file. */
  source_kind: "typed" | "notes";
  /** Which language the card is written in, so the page can say so. */
  language: "ar" | "en";
  /** ── Spaced repetition ─────────────────────────────────────── */
  /** Days until it is asked again. 0 means again today. */
  interval_days: number;
  /** How reliably it is remembered, and how fast the interval may grow. */
  ease: number;
  /** How many times it has been remembered. */
  reps: number;
  /** How many times it was forgotten after being remembered. */
  lapses: number;
  /** `YYYY-MM-DD` it is next asked for. */
  due_date: string;
  /** `YYYY-MM-DD` it was last graded, null when never. */
  last_review: string | null;
  created_date: string;
};

/**
 * A sitting, booked into a hole in the timetable.
 *
 * Not a lecture: nothing to attend, nothing to be marked, and it can be moved
 * or deleted without touching the week. The weekday is not stored, because a
 * session is on a date and the timetable's weekday would be a second, different
 * answer to the same question.
 */
export type ReviewSession = {
  id: Id;
  /** `YYYY-MM-DD` */
  date: string;
  start_time: string;
  end_time: string;
  /** The course being reviewed. Empty means whatever is due. */
  subject_key: string;
  /** How many cards the sitting was planned for, and how many it took. */
  card_count: number;
  /** `auto` when the planner put it there, `manual` when a person did. */
  source: "auto" | "manual";
  /** Ticked when the sitting has been done, so it can stop being offered. */
  done: boolean;
  created_date: string;
};

/**
 * A question kept in the student's bank.
 *
 * A question generated for an exam is saved here the moment it is shown, so the
 * same one is never written twice and an exam can be re-read later without asking
 * the model for it again. Keyed to the course by name, the way `Flashcard` is.
 */
export type Question = {
  id: Id;
  subject_key: string;
  question: string;
  type: "mcq" | "truefalse" | "short";
  /** The choices for an mcq; empty for the other types. */
  options: string[];
  answer: string;
  explanation: string;
  /** Where it came from — the material title, chapter or topic. */
  source: string;
  created_date: string;
};

export type Chat = {
  id: Id;
  title: string;
  sort_order: number;
  created_date: string;
  updated_date: string;
};

export type Attachment = { uri: string; name: string };

export type Message = {
  id: Id;
  chat_id: Id;
  role: "user" | "assistant";
  text: string;
  file_text?: string;
  attachments?: Attachment[];
  created_date: string;
};

export type EntityMap = {
  Lecture: Lecture;
  Attendance: Attendance;
  Grade: Grade;
  Hall: Hall;
  Material: Material;
  Subject: Subject;
  SubjectEvent: SubjectEvent;
  UniversityEvent: UniversityEvent;
  Flashcard: Flashcard;
  ReviewSession: ReviewSession;
  Question: Question;
  Chat: Chat;
  Message: Message;
};

export type EntityName = keyof EntityMap;

export const ENTITY_NAMES: EntityName[] = [
  "Lecture",
  "Attendance",
  "Grade",
  "Hall",
  "Material",
  "Subject",
  "SubjectEvent",
  "UniversityEvent",
  "Flashcard",
  "ReviewSession",
  "Question",
  "Chat",
  "Message",
];
