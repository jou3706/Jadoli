-- Flashcards and review sessions.
--
-- Two things a student needs and neither of them is a lecture: somewhere to put
-- a question they were going to forget, and a slot in the day to answer it in.
--
-- The cards are generated from the student's own notes, so they are ordinary
-- rows with an ordinary primary key. The scheduling is a handful of numbers on
-- the card rather than a table of review history: to ask a card again all you
-- need is the date, and a log of every past answer is something nobody reads
-- and something that has to be kept correct forever.

begin;

create table if not exists public.flashcards (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  -- The course by name, the way materials and subject_events file it, so a card
  -- can exist for a course that has no row in `subjects` yet.
  subject_key    text not null default '',
  question       text not null default '',
  answer         text not null default '',
  -- Where it came from. Kept because a card that turned out to be wrong needs a
  -- way back to the notes it was made from.
  source         text not null default '',
  source_kind    text not null default 'typed'
                   check (source_kind in ('typed','notes')),
  language       text not null default 'ar' check (language in ('ar','en')),
  interval_days  integer not null default 0 check (interval_days between 0 and 365),
  ease           numeric not null default 2.5 check (ease between 1.3 and 2.8),
  reps           integer not null default 0 check (reps >= 0),
  lapses         integer not null default 0 check (lapses >= 0),
  due_date       date not null default current_date,
  -- Null rather than empty: "never reviewed" is not a date, and a null column
  -- is the one thing the database itself agrees is the truth.
  last_review    date,
  created_date   timestamptz not null default now(),
  -- The client stamps updated_date on every insert; without this column the
  -- whole card row is rejected with PGRST204. See supabase/07-updated-date.sql.
  updated_date   timestamptz not null default now()
);

-- The create above is skipped when the table already exists, so a database created
-- before updated_date was added here never receives the column from this file. The
-- insert is rejected with PGRST204 and the card is not saved. Adding it
-- separately is what makes re-running this migration a repair rather than a no-op.
alter table public.flashcards
  add column if not exists updated_date timestamptz not null default now();

-- A card generated for a lecture that was already on the plan is the same card
-- twice. This also makes the offline retry safe: the queued insert fails rather
-- than leaving a duplicate behind.
create unique index if not exists flashcards_user_subject_question_key
  on public.flashcards (user_id, lower(btrim(subject_key)), lower(btrim(question)));

create index if not exists flashcards_user_due_idx
  on public.flashcards (user_id, due_date);

create index if not exists flashcards_user_subject_idx
  on public.flashcards (user_id, subject_key);

create table if not exists public.review_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  date           date not null,
  start_time     text not null default '' check (start_time = '' or start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time       text not null default '' check (end_time = '' or end_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  subject_key    text not null default '',
  card_count     integer not null default 0 check (card_count >= 0),
  source         text not null default 'auto' check (source in ('auto','manual')),
  done           boolean not null default false,
  created_date   timestamptz not null default now(),
  updated_date   timestamptz not null default now()
);

create index if not exists review_sessions_user_date_idx
  on public.review_sessions (user_id, date);

alter table public.flashcards      enable row level security;
alter table public.review_sessions enable row level security;

drop policy if exists flashcards_own on public.flashcards;
create policy flashcards_own on public.flashcards
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists review_sessions_own on public.review_sessions;
create policy review_sessions_own on public.review_sessions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

commit;