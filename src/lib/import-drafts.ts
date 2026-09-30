/** A lecture as the assistant read it off the timetable, before it is saved. */
export type Draft = {
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
  notes: string;
  department: string;
  color: string;
};

/** One lecture is the same when its subject, day and start all match. */
export const draftKey = (d: Draft) =>
  `${d.subject_name.trim().toLowerCase()}|${d.day}|${d.start_time}`;

/**
 * The rows on screen while the user reviews an import.
 *
 * `all` keeps every row the assistant read, in the order it read them, and
 * `removed` holds the positions currently taken out of the list. The rows are
 * not thrown away: a stray tap on the bin used to mean reading the whole
 * timetable again, and a read costs money and can come back slightly different
 * each time, so a mis-removed lecture was unrecoverable until the user
 * re-uploaded a photo. Keeping the original list also means a restored row
 * comes back in the place it was read rather than at the end of the list, and
 * keeps a name the user corrected by hand.
 */
export type Preview = { all: Draft[]; removed: number[] };

export const emptyPreview = (): Preview => ({ all: [], removed: [] });

/** A row paired with its position in `all`, so edits address the right one. */
export type Indexed = { row: Draft; i: number };

const indexed = (p: Preview): Indexed[] => p.all.map((row, i) => ({ row, i }));

/** The rows that will be saved: everything the user has not removed. */
export const keptRows = (p: Preview): Indexed[] =>
  indexed(p).filter(({ i }) => !p.removed.includes(i));

/** The rows taken out, in the order they sit in the original list. */
export const removedRows = (p: Preview): Indexed[] =>
  indexed(p).filter(({ i }) => p.removed.includes(i));

export const isRemoved = (p: Preview, i: number): boolean => p.removed.includes(i);

export const removeAt = (p: Preview, i: number): Preview => {
  if (!p.all[i] || isRemoved(p, i)) return p;
  return { ...p, removed: [...p.removed, i].sort((a, b) => a - b) };
};

export const restoreAt = (p: Preview, i: number): Preview => {
  if (!isRemoved(p, i)) return p;
  return { ...p, removed: p.removed.filter((j) => j !== i) };
};

export const restoreAll = (p: Preview): Preview =>
  p.removed.length ? { ...p, removed: [] } : p;

/** Replaces a row after the user corrects its name on screen. */
export const renameAt = (p: Preview, i: number, subject_name: string): Preview => {
  const row = p.all[i];
  if (!row || row.subject_name === subject_name) return p;
  const all = [...p.all];
  all[i] = { ...row, subject_name };
  return { ...p, all };
};
