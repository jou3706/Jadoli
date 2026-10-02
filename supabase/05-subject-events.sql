-- Subject events: a quiz, an exam, or anything else due on a course.
--
-- Deliberately not a column on `lectures`. An exam is not a lecture: it has a
-- date rather than a weekday, it can exist before the course has any sessions
-- in it, and two exams on one course are two rows rather than two slots in a
-- timetable. Keyed to the subject by name, the same way `materials.subject_key`
-- is, so an event can be filed under a course that has no `subjects` row yet
-- and the subjects page can list it without creating anything.

begin;

create table if not exists public.subject_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  -- Matches materials.subject_key: the course name, compared the same way.
  subject_key text not null default '',
  title text not null default '',
  kind text not null default 'quiz'
    check (kind in ('quiz', 'exam', 'assignment', 'other')),
  -- A real calendar date, not a weekday: an exam is "the 14th", not "Tuesday".
  date date not null,
  start_time text not null default ''
    check (start_time = '' or start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time text not null default ''
    check (end_time = '' or end_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  hall text not null default '',
  note text not null default '',
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create index if not exists subject_events_user_date_idx
  on public.subject_events (user_id, date);

create index if not exists subject_events_user_subject_idx
  on public.subject_events (user_id, subject_key);

alter table public.subject_events enable row level security;

drop policy if exists subject_events_own on public.subject_events;
create policy subject_events_own on public.subject_events
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- One event per course per title per date. Adding the same quiz twice is a slip,
-- not two quizzes, and the unique index makes the retry after a flaky
-- connection safe instead of leaving a duplicate behind.
create unique index if not exists subject_events_user_subject_title_date_key
  on public.subject_events (user_id, lower(btrim(subject_key)), lower(btrim(title)), date);

commit;