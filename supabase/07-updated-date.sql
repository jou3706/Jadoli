-- Jadoli — migration: updated_date on every table the app writes
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It is additive: safe to run more than once.
--
-- Why this exists
-- --------------
-- Every insert the client makes carries `updated_date` (see the generic writer
-- in src/lib/db/supabase.ts, and the same stamp in the local store). Five tables
-- were created without that column, so PostgREST rejected the whole row:
--
--   PGRST204: Could not find the 'updated_date' column of 'materials'
--
-- The failure is on the insert, not on the feature, which is why adding a
-- material to a course looked like "Could not save" while the rest of the app
-- carried on working. Attendance, subjects, messages and flashcards hit the same
-- wall the first time each was written to on a real backend.
--
-- The column is added rather than removed from the request because the local
-- store keeps it, and a row written offline and synced later has to carry the
-- same shape as one written online.

alter table public.attendance
  add column if not exists updated_date timestamptz not null default now();
alter table public.materials
  add column if not exists updated_date timestamptz not null default now();
alter table public.subjects
  add column if not exists updated_date timestamptz not null default now();
alter table public.messages
  add column if not exists updated_date timestamptz not null default now();

-- The client stamps this on insert, but not on every edit path, and a column
-- that means "when this row was last touched" has to move on its own. The
-- trigger is what makes the value true rather than merely present.
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
    'lectures','attendance','grades','halls','materials','subjects',
    'subject_events','university_events','flashcards','review_sessions',
    'chats','messages'
  ]
  loop
    -- Skipped when the table is not there yet: 06 creates flashcards and
    -- review_sessions, and this file is meant to be runnable before it.
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;
    execute format('drop trigger if exists %I_set_updated_date on public.%I', t, t);
    execute format(
      'create trigger %I_set_updated_date before update on public.%I
       for each row execute function public.set_updated_date()',
      t, t
    );
  end loop;
end;
$$;

-- PostgREST answers from a cached copy of the schema, and it does not notice a
-- column that appeared a moment ago. Without this line the migration above runs
-- cleanly and the very same PGRST204 comes back, which reads exactly like the
-- fix having failed. Supabase sends this itself for changes made through the
-- dashboard's table editor; a pasted migration does not always wait for it.
notify pgrst, 'reload schema';