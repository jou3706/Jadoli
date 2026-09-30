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
  created_date timestamptz not null default now()
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

create table if not exists public.halls (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  name            text not null default '',
  campus          text not null default '',
  lat             double precision,
  lng             double precision,
  note            text not null default '',
  streetview_url  text not null default '',
  created_date    timestamptz not null default now(),
  updated_date    timestamptz not null default now()
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
  created_date  timestamptz not null default now()
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
  created_date  timestamptz not null default now()
);

create unique index if not exists subjects_user_name_key
  on public.subjects (user_id, name);

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
  created_date  timestamptz not null default now()
);

create index if not exists messages_chat_idx on public.messages (chat_id, created_date);

-- ── Row level security ────────────────────────────────────────────────
-- Each student only ever sees and touches their own rows.

alter table public.lectures          enable row level security;
alter table public.attendance        enable row level security;
alter table public.grades            enable row level security;
alter table public.halls             enable row level security;
alter table public.materials         enable row level security;
alter table public.subjects          enable row level security;
alter table public.university_events enable row level security;
alter table public.chats             enable row level security;
alter table public.messages          enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'lectures','attendance','grades','halls','materials','subjects',
    'university_events','chats','messages'
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
