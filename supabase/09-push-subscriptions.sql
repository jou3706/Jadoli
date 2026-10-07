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

begin;

-- ─────────────────────────────────────────────────────────────
-- Job configuration (closed to browsers)
-- ─────────────────────────────────────────────────────────────

create table if not exists public.app_secrets (
  name  text primary key,
  value text not null
);

alter table public.app_secrets enable row level security;

-- RLS on with no policies, and the functions revoked below, means the only way
-- in is the SQL editor (or another security-definer function running as
-- postgres): a student's browser cannot read or write any of it.
create or replace function public.get_secret(p_name text)
returns text
language sql
security definer
set search_path = public
as $$
  select value from public.app_secrets where name = p_name
$$;

create or replace function public.set_secret(p_name text, p_value text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.app_secrets (name, value) values (p_name, p_value)
  on conflict (name) do update set value = excluded.value
$$;

revoke all on function public.get_secret(text) from public, anon, authenticated;
revoke all on function public.set_secret(text, text) from public, anon, authenticated;

-- Seeds are `do nothing` so re-running this file never clobbers a real value.
insert into public.app_secrets (name, value) values
  ('push_api_url', 'https://jadoli.vercel.app/api/push/send'),
  ('push_cron_secret', 'replace-me-before-going-live')
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
-- Idempotent on rerun: the old job is unscheduled by name first, so applying
-- this file twice does not leave two jobs racing to send every reminder twice.

select cron.unschedule('jadoli-push') where exists (
  select 1 from cron.job where jobname = 'jadoli-push'
);

select cron.schedule(
  'jadoli-push',
  '* * * * *',
  $cron$
    select net.http_post(
      url     := public.get_secret('push_api_url'),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', public.get_secret('push_cron_secret')
      ),
      body    := '{}'::jsonb
    )
  $cron$
);

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
$$;

select cron.schedule(
  'jadoli-push-prune',
  '17 4 * * *',
  $cron$ select public.prune_push_deliveries() $cron$
);