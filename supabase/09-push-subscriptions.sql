-- Push subscriptions, and the job that delivers reminders to them.
--
-- Why a table at all: a push subscription is an endpoint held by a browser, and
-- the thing that has to send to it is a cron job on a server that has never met
-- the student's browser. The two can only be joined by somewhere both can reach,
-- and the only such place here is the database. It also means a student's
-- reminders follow them onto a new phone: the new browser subscribes, the old
-- row is pruned when the push service reports it gone, and nothing has to be
-- re-set-up by hand.
--
-- ONE THING TO ENABLE IN THE DASHBOARD FIRST, because SQL cannot do it:
-- Supabase → Database → Extensions → enable `pg_cron` and `pg_net`. A `create
-- extension` for either one fails from here with a permission error, which is the
-- extension not being enabled rather than the statement being wrong.
--
-- The job needs two pieces of information that are not the database's to invent:
-- the URL of the deployed app, and the secret that identifies this cron job to
-- it. Both once sat in this file as literals, which made this file (and therefore
-- the git repository) a copy of a secret. They now live in `app_secrets`, a table
-- that is closed to browsers, and the job reads them on every tick. Setting them
-- is one line each:
--
--   select public.set_secret('push_api_url', 'https://your-app.example/api/push/send');
--   select public.set_secret('push_cron_secret', '<openssl rand -hex 32>');
--
-- and PUSH_CRON_SECRET on Vercel must be the SAME string as push_cron_secret. The
-- two values seeded below are placeholders on purpose; replace them before launch.
--
-- This file is written to be run again at any time. Every statement in it is
-- either "if it is not there, make it" or "make it so", and the one thing it
-- must never do is leave two delivery jobs racing against each other.

begin;

-- ─────────────────────────────────────────────────────────────
-- Job configuration (closed to browsers)
-- ─────────────────────────────────────────────────────────────

create table if not exists public.app_secrets (
  name  text primary key,
  value text not null,
  -- The column this table was first created with. Both are kept, and both are
  -- read: a database that already has the table in the other shape must not be
  -- told to start over, and a job that reads one column must find the value
  -- whichever column it is in.
  secret text,
  created_at timestamptz not null default now()
);

-- The table exists in the wild in two shapes - `(name, secret, created_at)` and
-- `(name, value)` - and the second one is this file's idea of it. Both are
-- repaired here rather than chosen between, because the alternative is a file
-- that refuses to run against a database that is otherwise perfectly good.
alter table public.app_secrets add column if not exists value text;
alter table public.app_secrets add column if not exists secret text;
alter table public.app_secrets add column if not exists created_at timestamptz not null default now();

-- Copy across, in both directions, so whichever column holds the value the
-- other one does too. A row with no value at all is left alone: it is a name
-- with nothing behind it, and inventing a value for it would be inventing a
-- secret.
update public.app_secrets set value = secret where value is null and secret is not null;
update public.app_secrets set secret = value where secret is null and value is not null;

alter table public.app_secrets enable row level security;

-- RLS on with no policies, and the functions revoked below, means the only way
-- in is the SQL editor (or another security-definer function running as
-- postgres): a student's browser cannot read or write any of it.
--
-- The getter reads both columns and takes whichever has something in it. The
-- setter writes both, because the live table has `secret` marked NOT NULL and
-- a write that left it empty would be refused.
create or replace function public.get_secret(p_name text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(value, secret) from public.app_secrets where name = p_name
$$;

create or replace function public.set_secret(p_name text, p_value text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.app_secrets (name, value, secret) values (p_name, p_value, p_value)
  on conflict (name) do update set value = excluded.value, secret = excluded.secret
$$;

revoke all on function public.get_secret(text) from public, anon, authenticated;
revoke all on function public.set_secret(text, text) from public, anon, authenticated;

-- Seeds are `do nothing` so re-running this file never clobbers a real value.
insert into public.app_secrets (name, value, secret) values
  ('push_api_url', 'https://jadoli.vercel.app/api/push/send', 'https://jadoli.vercel.app/api/push/send'),
  ('push_cron_secret', 'replace-me-before-going-live', 'replace-me-before-going-live')
on conflict (name) do nothing;

-- ─────────────────────────────────────────────────────────────
-- Subscriptions
-- ─────────────────────────────────────────────────────────────

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  -- The push service's address for this one browser. Unique per user rather than
  -- globally, because two browsers of the same student are two subscriptions and
  -- the upsert that saves a re-subscribe has to land on the right one.
  endpoint text not null,
  -- The two halves of the key pair the browser generated. They are not secrets
  -- in the sense that matters: they are public keys, and the push service uses
  -- them to verify a message came from this subscription. The thing that must
  -- never be stored here or logged is the VAPID private key, which is not.
  p256dh text not null,
  auth text not null,
  language text not null default 'ar'
    check (language in ('ar', 'en')),
  -- IANA name, e.g. `Africa/Cairo`. Read from the browser when it subscribes,
  -- because the browser is the only place that knows whose clock it is on. An
  -- event is stored as a date and an hour with no zone attached, so without
  -- this the server would read a 09:00 exam as 09:00 UTC and every reminder
  -- would arrive by however far that student's clock is from Greenwich.
  time_zone text not null default 'UTC',
  created_date timestamptz not null default now(),
  -- When this row last proved it still works. A subscription nobody has been
  -- able to reach for months is one that should not be scanned every minute.
  last_seen timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_own on public.push_subscriptions;
-- Full access to your own row and nothing else: the app subscribes, resubscribes
-- after a browser rotates the endpoint, and unsubscribes when you turn the
-- reminder off. It never reads anybody else's, which is what the service role
-- bypasses in order to do its job.
create policy push_subscriptions_own on public.push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- What has already gone out
-- ─────────────────────────────────────────────────────────────

-- The reminder window has a grace period, on purpose: someone who opens the app
-- five minutes before an exam with an hour's warning should still be told. The
-- cost of that is that the job sees the same event as due on every tick for half
-- an hour - thirty identical notifications, which is not a reminder, it is a
-- punishment. This table is the memory that makes a per-minute schedule possible:
-- a row is written the moment a push goes out, and the alarm that produced it is
-- never offered again.
create table if not exists public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  -- `alarmKey` from src/lib/alarm.ts: event id, date and start time. The time is
  -- part of it on purpose - moving an exam an hour later has to let it ring
  -- again, and a key without the time would refuse to.
  alarm_key text not null,
  sent_at timestamptz not null default now(),
  unique (user_id, alarm_key)
);

create index if not exists push_deliveries_sent_idx
  on public.push_deliveries (sent_at);

-- No policy, deliberately. Nothing in the browser reads or writes this table; the
-- send job is the only writer and runs with the service role, which bypasses RLS
-- by design. Leaving it with RLS on and no policy means an authenticated client
-- that guessed the name gets nothing - which is the correct answer.
alter table public.push_deliveries enable row level security;

-- ─────────────────────────────────────────────────────────────
-- The job's heartbeat
-- ─────────────────────────────────────────────────────────────

-- A row is written every time the delivery job runs, whether or not it had
-- anything to send.
--
-- This table is the answer to the question that could not be answered before:
-- is the job running? Without it, a job that stopped and a job that found
-- nothing to send look exactly the same, and both of them look like a student
-- who has no reminders. The health endpoint reads the newest row and says how
-- long ago it was written.
create table if not exists public.push_ticks (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  subscriptions integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  removed integer not null default 0,
  reminders integer not null default 0
);

create index if not exists push_ticks_at_idx on public.push_ticks (at desc);

-- No policy, for the same reason as the deliveries table: only the service role
-- writes here, and only the server reads it.
alter table public.push_ticks enable row level security;

commit;

-- ─────────────────────────────────────────────────────────────
-- The job itself
-- ─────────────────────────────────────────────────────────────
--
-- Every minute. This is the reason for pg_cron rather than a Vercel cron: the
-- reminders are minute-scale - "an hour before this exam" has to mean an hour -
-- and a Vercel cron on the Hobby plan runs once a day, which can only ever be a
-- morning digest. A minute of drift is invisible; a day of it is a different
-- feature.
--
-- Idempotent on rerun: every job that sends reminders is unscheduled first, so
-- applying this file twice does not leave two jobs racing to send every reminder
-- twice.

-- The extensions the job needs. `pg_cron` holds the schedule and `pg_net` makes
-- the HTTP call. Both are enabled from the dashboard, and a `create extension`
-- for an extension that is not enabled fails with a permission error rather than
-- with anything that explains itself - so the failure is caught and said out
-- loud, and the rest of this file still runs.
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
exception when others then
  raise notice 'pg_cron is not enabled: turn it on in Dashboard → Database → Extensions, then run this file again';
end
$$;

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net is not enabled: turn it on in Dashboard → Database → Extensions, then run this file again';
end
$$;

-- Deliveries are only needed until the reminder they stop from repeating has
-- passed. Anything older than a fortnight describes an event that has already
-- happened, and the table is read on every tick.
create or replace function public.prune_push_deliveries()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_deliveries where sent_at < now() - interval '14 days';
  delete from public.push_ticks where at < now() - interval '2 days';
$$;

-- Every job that sends reminders is unscheduled, whatever it is called.
--
-- The names below are the ones this file has used. The loop afterwards is the
-- part that matters: a job is identified by what it does, not by what it is
-- called, so a database that ran an older version of this file - or one whose
-- job was named by hand - ends up with exactly one delivery job instead of two
-- racing to send every reminder twice.
do $$
declare
  r record;
begin
  for r in select jobid from cron.job where command like '%api/push/send%' loop
    perform cron.unschedule(r.jobid);
  end loop;
  if exists (select 1 from cron.job where jobname = 'jadwali-push') then
    perform cron.unschedule('jadwali-push');
  end if;
  if exists (select 1 from cron.job where jobname = 'jadoli-push') then
    perform cron.unschedule('jadoli-push');
  end if;
exception when others then
  raise notice 'could not unschedule the old push jobs: %', sqlerrm;
end
$$;

-- The job reads its address and its secret from the database on every tick, so
-- moving the deployment or rotating the secret is a change to one table rather
-- than to a schedule.
--
-- The `case` is a guard rather than a decoration: with no address in the table
-- the call would be made with a null url, which fails on every tick and says
-- nothing about why.
do $$
begin
  perform cron.schedule(
    'jadwali-push',
    '* * * * *',
    $cron$
      select case
        when public.get_secret('push_api_url') is null then null
        else net.http_post(
          url     := public.get_secret('push_api_url'),
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'x-cron-secret', public.get_secret('push_cron_secret')
          ),
          body    := '{}'::jsonb
        )
      end
    $cron$
  );
exception when others then
  raise notice 'could not schedule the push job: %', sqlerrm;
end
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'jadwali-push-prune') then
    perform cron.unschedule('jadwali-push-prune');
  end if;
  if exists (select 1 from cron.job where jobname = 'jadoli-push-prune') then
    perform cron.unschedule('jadoli-push-prune');
  end if;
  perform cron.schedule(
    'jadwali-push-prune',
    '17 4 * * *',
    $cron$ select public.prune_push_deliveries() $cron$
  );
exception when others then
  raise notice 'could not schedule the prune job: %', sqlerrm;
end
$$;
