-- Duplicate rows. Safe to run more than once.
--
-- The app dedupes on the client before it writes, but a client-side check is a
-- suggestion: two tabs importing the same file, or a retry after a timeout,
-- both put the same lecture in twice. The pairs below were real rows in the
-- live database, and the subjects table had two rows whose name had been
-- concatenated onto itself.
--
-- A unique index turns that race into a no-op at the database, which is the
-- only place that can be sure two writes are not the same session.
--
-- Deduping keeps the oldest row of each group, so the row that any earlier
-- edit was applied to is the one that stays.

begin;

-- Collapse lecture duplicates before the index can be built, otherwise the
-- create fails on the existing pairs. Ordinality is what a week means here, so
-- it is part of the identity, along with the day and the start time.
delete from public.lectures a
using public.lectures b
where a.user_id is not distinct from b.user_id
  and lower(btrim(a.subject_name)) = lower(btrim(b.subject_name))
  and a.day is not distinct from b.day
  and a.start_time is not distinct from b.start_time
  and (a.created_date, a.id) > (b.created_date, b.id);

create unique index if not exists lectures_user_slot_key
  on public.lectures (user_id, lower(subject_name), day, start_time);

-- One subjects row per course. ensureRow() already looks for an existing row
-- first, but two tabs on a brand new course both found nothing and both
-- inserted, and nothing at the database stopped the second one.
delete from public.subjects a
using public.subjects b
where a.user_id is not distinct from b.user_id
  and lower(btrim(a.name)) = lower(btrim(b.name))
  and a.id <> b.id;

create unique index if not exists subjects_user_name_key
  on public.subjects (user_id, lower(btrim(name)));

-- Materials are reusable across subjects on purpose, so identity is the file
-- itself. Two rows for one upload mean the file was stored twice.
delete from public.materials a
using public.materials b
where a.user_id is not distinct from b.user_id
  and nullif(btrim(a.title), '') is not distinct from nullif(btrim(b.title), '')
  and nullif(btrim(a.subject_key), '') is not distinct from nullif(btrim(b.subject_key), '')
  and nullif(a.file_path, '') is not distinct from nullif(b.file_path, '')
  and (a.created_date, a.id) > (b.created_date, b.id);

create unique index if not exists materials_user_subject_title_key
  on public.materials (user_id, lower(btrim(subject_key)), lower(btrim(title)));

commit;
