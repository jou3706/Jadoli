-- Jadoli — Supabase schema
-- Run this once in the Supabase SQL editor, then set
-- NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.
--
-- Every table is scoped to auth.uid() so one user never sees another's data.
-- The client uses the anon key through PostgREST, so RLS is the only gate.

create table if not exists public.lectures (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  subject_name  text not null default '',
  subject_en    text not null default '',
  code          text not null default '',
  doctor        text not null default '',
  hall          text not null default '',
  day           smallint not null check (day between 0 and 6),
  start_time    text not null check (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time      text not null check (end_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  kind          text not null default 'lecture' check (kind in ('lecture','section')),
  color         text not null default 'indigo',
  notes         text not null default '',
  department    text not null default '',
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

create index if not exists lectures_user_day_idx on public.lectures (user_id, day);

create table if not exists public.attendance (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  lecture_id   uuid not null references public.lectures on delete cascade,
  date         date not null,
  week_start   date not null,
  created_date timestamptz not null default now(),
  updated_date    timestamptz not null default now()
);

create unique index if not exists attendance_unique_week
  on public.attendance (user_id, lecture_id, week_start);

create table if not exists public.grades (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  subject_name  text not null default '',
  code          text not null default '',
  credit_hours  numeric(4,1) not null default 3,
  letter        text not null default 'A',
  grade_point   numeric(3,2) not null default 4,
  semester      text not null default '',
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

create table if not exists public.materials (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  title         text not null default '',
  subject_key   text not null default '',
  url           text not null default '',
  type          text not null default '',
  -- Set when the file was uploaded to Storage (empty for a plain link).
  file_path     text not null default '',
  size          bigint not null default 0,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

create index if not exists materials_subject_idx on public.materials (user_id, subject_key);

-- ── Subjects ───────────────────────────────────────────────────────────
-- One row per course, holds the cover image used on the subjects page.
-- Created automatically from the schedule or by the assistant.

create table if not exists public.subjects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  name          text not null,
  image_url     text not null default '',
  image_credit  text not null default '',
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

create unique index if not exists subjects_user_name_key
  on public.subjects (user_id, name);

-- A quiz, an exam, or anything else due on a course.
--
-- Not a column on `lectures`: an exam happens on a date rather than a weekday,
-- and a course can have exams before it has any sessions at all. Keyed to the
-- course by name, the way materials.subject_key is. See 05-subject-events.sql
-- for the deployed version of this table.

create table if not exists public.subject_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  subject_key   text not null default '',
  title         text not null default '',
  kind          text not null default 'quiz'
                  check (kind in ('quiz','exam','assignment','other')),
  date          date not null,
  start_time    text not null default ''
                  check (start_time = '' or start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time      text not null default ''
                  check (end_time = '' or end_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  hall          text not null default '',
  note          text not null default '',
  remind_minutes integer not null default 60
                  check (remind_minutes between 0 and 10080),
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

create index if not exists subject_events_user_date_idx
  on public.subject_events (user_id, date);

create index if not exists subject_events_user_subject_idx
  on public.subject_events (user_id, subject_key);

create unique index if not exists subject_events_user_subject_title_date_key
  on public.subject_events (user_id, lower(btrim(subject_key)), lower(btrim(title)), date);

create table if not exists public.university_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  title         text not null default '',
  title_en      text not null default '',
  date          date not null,
  type          text not null default 'event'
                check (type in ('holiday','announcement','exam','event')),
  note          text not null default '',
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

-- ── Flashcards and review sessions ─────────────────────────────────────────
-- Generated from a student's own notes, and scheduled by the app into the holes
-- in the timetable. See 06-flashcards-and-review.sql for the deployed version.

create table if not exists public.flashcards (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  subject_key    text not null default '',
  question       text not null default '',
  answer         text not null default '',
  source         text not null default '',
  source_kind    text not null default 'typed'
                   check (source_kind in ('typed','notes')),
  language       text not null default 'ar' check (language in ('ar','en')),
  -- Spaced repetition, flattened onto the card: the next date is all that is
  -- needed to ask it again, and a row per past answer would be a history that
  -- has to be kept right and read by nobody.
  interval_days  integer not null default 0 check (interval_days between 0 and 365),
  ease           numeric not null default 2.5 check (ease between 1.3 and 2.8),
  reps           integer not null default 0 check (reps >= 0),
  lapses         integer not null default 0 check (lapses >= 0),
  due_date       date not null default current_date,
  last_review    date,
  created_date   timestamptz not null default now(),
  updated_date    timestamptz not null default now()
);

-- The queue is read by due date for one account, constantly.
create index if not exists flashcards_user_due_idx
  on public.flashcards (user_id, due_date);

create index if not exists flashcards_user_subject_idx
  on public.flashcards (user_id, subject_key);

-- One card is one question about one course: adding the same quiz twice is a
-- slip, not two facts to learn, and the index also makes the offline retry safe.
create unique index if not exists flashcards_user_subject_question_key
  on public.flashcards (user_id, lower(btrim(subject_key)), lower(btrim(question)));

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

-- A planner that looked at a week needs to read it by date, not by insertion.
create index if not exists review_sessions_user_date_idx
  on public.review_sessions (user_id, date);

-- ── Question bank ─────────────────────────────────────────────────────────
-- Every question the app has shown the student, so an exam is remembered and the
-- same question is never stored twice. See 08-questions.sql for the deployed
-- version.

create table if not exists public.questions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  subject_key   text not null default '',
  question      text not null default '',
  type          text not null default 'mcq'
                  check (type in ('mcq','truefalse','short')),
  options       jsonb not null default '[]'::jsonb,
  answer        text not null default '',
  explanation   text not null default '',
  source        text not null default '',
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

create index if not exists questions_user_subject_idx
  on public.questions (user_id, subject_key);

-- One course plus one question is one question: regenerating an exam should not
-- double the bank, and the index makes that true at the database as well.
create unique index if not exists questions_user_subject_question_key
  on public.questions (user_id, lower(btrim(subject_key)), lower(btrim(question)));

create table if not exists public.chats (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  title         text not null default '',
  sort_order    integer not null default 0,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  chat_id       uuid not null references public.chats on delete cascade,
  role          text not null check (role in ('user','assistant')),
  text          text not null default '',
  file_text     text,
  attachments   jsonb,
  created_date  timestamptz not null default now(),
  updated_date    timestamptz not null default now()
);

create index if not exists messages_chat_idx on public.messages (chat_id, created_date);

-- ── updated_date ──────────────────────────────────────────────────────
-- Every table above carries this because the client stamps it on every insert.
-- The trigger is what keeps it honest afterwards: the client does not send it on
-- every edit, and a column that means "when this row was last touched" has to
-- move on its own. See supabase/07-updated-date.sql for the deployed version.

create or replace function public.set_updated_date()
returns trigger
language plpgsql
as $$
begin
  new.updated_date := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'lectures','attendance','grades','materials','subjects',
    'subject_events','university_events','flashcards','review_sessions',
    'questions','chats','messages'
  ]
  loop
    execute format('drop trigger if exists %I_set_updated_date on public.%I', t, t);
    execute format(
      'create trigger %I_set_updated_date before update on public.%I
       for each row execute function public.set_updated_date()',
      t, t
    );
  end loop;
end;
$$;

-- ── Row level security ────────────────────────────────────────────────
-- Each student only ever sees and touches their own rows.

alter table public.lectures          enable row level security;
alter table public.attendance        enable row level security;
alter table public.grades            enable row level security;
alter table public.materials         enable row level security;
alter table public.subjects          enable row level security;
alter table public.subject_events    enable row level security;
alter table public.university_events enable row level security;
alter table public.flashcards        enable row level security;
alter table public.review_sessions   enable row level security;
alter table public.questions         enable row level security;
alter table public.chats             enable row level security;
alter table public.messages          enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'lectures','attendance','grades','materials','subjects',
    'subject_events','university_events','flashcards','review_sessions',
    'questions','chats','messages'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format(
      'create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_own', t
    );
  end loop;
end;
$$;

-- ── Push subscriptions (see also 09-push-subscriptions.sql) ─────────────
--
-- A push subscription is an endpoint held by a browser, and the thing that has
-- to send to it is a cron job on a server that has never met that browser. The
-- two are joined here and nowhere else. Kept in this snapshot as well as in the
-- incremental migration: a fresh project is built from this file, and a table
-- that exists only in the numbered migration is a table a new install does not
-- have.

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  -- The push service's address for this one browser, unique per user rather than
  -- globally: two browsers of the same student are two subscriptions, and the
  -- upsert that saves a re-subscribe has to land on the right one.
  endpoint      text not null,
  -- Public halves of the pair the browser generated, not secrets. The VAPID
  -- private key is what must never be stored here or logged, and it is not.
  p256dh        text not null,
  auth          text not null,
  language      text not null default 'ar' check (language in ('ar', 'en')),
  -- IANA name. An event is a date and an hour with no zone attached, so without
  -- this the send job would read a 09:00 exam as 09:00 UTC and every reminder
  -- would arrive by however far that student's clock is from Greenwich.
  time_zone     text not null default 'UTC',
  created_date  timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- What has already gone out. The reminder window has a grace period on purpose,
-- so a per-minute job would otherwise see the same event as due on every tick
-- for half an hour. This is the memory that makes a minute-accurate schedule
-- possible.
create table if not exists public.push_deliveries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  -- alarmKey from src/lib/alarm.ts: event id, date and start time. The time is
  -- part of it so moving an exam an hour later can ring again.
  alarm_key     text not null,
  sent_at       timestamptz not null default now(),
  unique (user_id, alarm_key)
);

create index if not exists push_deliveries_sent_idx
  on public.push_deliveries (sent_at);

-- No policy, deliberately: nothing in the browser reads or writes this table.
-- The send job runs with the service role and bypasses RLS by design, so RLS on
-- with no policy means a client that guesses the name correctly gets nothing.
alter table public.push_deliveries enable row level security;

-- ── Share links (optional, if you outgrow the .data/shares file) ──────

create table if not exists public.share_links (
  token       text primary key,
  user_id     uuid references auth.users on delete cascade,
  owner_name  text not null default '',
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);

alter table public.share_links enable row level security;

drop policy if exists share_links_read on public.share_links;
-- Owner-only. Anonymous viewing goes through /api/share/[token], which uses the
-- service key and bypasses RLS, so nothing needs to read these rows as a
-- client -- and the anon key is public, so `using (true)` would let anyone
-- list every user's shared schedule straight from the browser.
create policy share_links_read on public.share_links
  for select using (auth.uid() = user_id);

drop policy if exists share_links_write on public.share_links;
create policy share_links_write on public.share_links
  for insert with check (auth.uid() = user_id);

-- ── AI quota ───────────────────────────────────────────────────────────
-- The AI routes cost money per call and the keys are server-side, so nothing in
-- the app stops one person from calling /api/ai/chat in a loop. An in-process
-- counter would not help: a serverless deploy runs many instances, so a limit
-- held in one instance's memory is one any single call can slip past by landing
-- on another. This table is the counter every instance shares.
--
-- RLS is on with no policy, so the table is unreachable from a browser. The only
-- way in is consume_ai_quota below, and the server supplies the user id itself
-- after verifying the caller's token - so the argument cannot be forged.
-- Same text as supabase/10-ai-rate-limit.sql.

create table if not exists public.ai_usage (
  user_id      uuid primary key references auth.users on delete cascade,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);

alter table public.ai_usage enable row level security;

create or replace function public.consume_ai_quota(
  p_user          uuid,
  p_limit         integer,
  p_window_mins   integer
)
returns table(allowed boolean, remaining integer, resets_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  cur public.ai_usage%rowtype;
  now_ts timestamptz := now();
  window_len interval := make_interval(mins => p_window_mins);
begin
  -- Lock this caller's own row for the length of the transaction. At most one
  -- row exists per user, so this serialises that user's calls against each other
  -- and against nobody else.
  select * into cur from public.ai_usage where user_id = p_user for update;

  if not found then
    insert into public.ai_usage (user_id, window_start, count)
    values (p_user, now_ts, 1);
    return query select true, p_limit - 1, now_ts + window_len;
    return;
  end if;

  if cur.window_start + window_len <= now_ts then
    update public.ai_usage
       set window_start = now_ts, count = 1
     where user_id = p_user;
    return query select true, p_limit - 1, now_ts + window_len;
    return;
  end if;

  if cur.count >= p_limit then
    return query select false, 0, cur.window_start + window_len;
    return;
  end if;

  update public.ai_usage set count = count + 1 where user_id = p_user;
  return query select true, p_limit - (cur.count + 1), cur.window_start + window_len;
end;
$$;

revoke all on function public.consume_ai_quota(uuid, integer, integer) from public;
grant execute on function public.consume_ai_quota(uuid, integer, integer) to authenticated;

-- ── Material storage ──────────────────────────────────────────────────
-- Files dropped on a subject are uploaded here, not into Postgres.
-- The bucket is public so a PDF opens in a new tab, but writes are only
-- allowed inside the owner's own folder: <uid>/…

insert into storage.buckets (id, name, public)
values ('materials', 'materials', true)
on conflict (id) do nothing;

drop policy if exists materials_read on storage.objects;
create policy materials_read on storage.objects
  for select using (bucket_id = 'materials');

drop policy if exists materials_insert on storage.objects;
create policy materials_insert on storage.objects
  for insert with check (
    bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists materials_update on storage.objects;
create policy materials_update on storage.objects
  for update using (
    bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists materials_delete on storage.objects;
create policy materials_delete on storage.objects
  for delete using (
    bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text
  );
