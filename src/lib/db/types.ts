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

export type UniversityEvent = {
  id: Id;
  title: string;
  title_en: string;
  date: string;
  type: "holiday" | "announcement" | "exam" | "event";
  note: string;
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
  UniversityEvent: UniversityEvent;
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
  "UniversityEvent",
  "Chat",
  "Message",
];
