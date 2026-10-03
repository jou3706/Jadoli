-- Question bank. Safe to run more than once.
--
-- Every question the app has generated and shown the student is kept here, so an
-- exam is remembered and the same question is never written twice. A unique index
-- on course + question is the guarantee: the client dedupes before it writes, but
-- two tabs, or a retry after a timeout, both bypass a client-side check.
--
-- Run this once in the Supabase SQL editor. It adds the table to a database that
-- already has the rest of the schema.

begin;

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

-- Every table the writer touches carries updated_date, because the client stamps
-- it on insert and PostgREST rejects the whole row when the column is missing.
alter table public.questions
  add column if not exists updated_date timestamptz not null default now();

create index if not exists questions_user_subject_idx
  on public.questions (user_id, subject_key);

-- Collapse anything already present before the unique index is built, keeping the
-- oldest row of each pair, then add the index. On a fresh table this deletes
-- nothing.
delete from public.questions a
using public.questions b
where a.user_id is not distinct from b.user_id
  and lower(btrim(a.subject_key)) = lower(btrim(b.subject_key))
  and lower(btrim(a.question)) = lower(btrim(b.question))
  and (a.created_date, a.id) > (b.created_date, b.id);

create unique index if not exists questions_user_subject_question_key
  on public.questions (user_id, lower(btrim(subject_key)), lower(btrim(question)));

-- updated_date moves on its own; the client does not send it on every edit.
drop trigger if exists questions_set_updated_date on public.questions;
create trigger questions_set_updated_date
  before update on public.questions
  for each row execute function public.set_updated_date();

alter table public.questions enable row level security;

drop policy if exists questions_own on public.questions;
create policy questions_own on public.questions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Prove the repair instead of assuming it.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'questions'
      and column_name = 'updated_date'
  ) then
    raise exception 'public.questions is missing updated_date';
  end if;
  raise notice 'OK: public.questions is ready';
end;
$$;

commit;

-- PostgREST answers from a cached schema, so the new table is invisible until it
-- reloads.
notify pgrst, 'reload schema';
