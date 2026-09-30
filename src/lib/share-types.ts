import type { Lecture, UniversityEvent } from "@/lib/db/types";

/** What a share link stores. Shared by the server store and the public view. */
export type SharePayload = {
  owner_name: string;
  lectures: Lecture[];
  events: UniversityEvent[];
  created: number;
};
