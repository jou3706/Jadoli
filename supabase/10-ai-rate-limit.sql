-- Rate limiting for the AI routes.
--
-- The AI routes cost money per call, and the keys are server-side, so nothing in
-- the app itself stops one person from calling /api/ai/chat in a loop. Without a
-- limit, the first person to find the app spends the quota of everyone using it.
--
-- An in-process counter would not do: a serverless deploy runs many instances,
-- so a limit kept in one instance's memory is a limit any single call can slip
-- past by landing on another. The counter therefore lives in the database, which
-- every instance shares, and the read-increment-write happens inside one function
-- so two simultaneous calls cannot both read the same count.
--
-- RLS is on with no policies, so the table is unreachable from a browser: the
-- only way in is the function below, which the caller reaches only with their own
-- user id, supplied by the server after verifying their token.

create table if not exists public.ai_usage (
  user_id      uuid primary key references auth.users on delete cascade,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);

alter table public.ai_usage enable row level security;

-- Take one unit of quota, or take none.
--
-- Returns whether the call may proceed, what is left, and when the window rolls
-- over. The window is fixed when the first call of it arrives rather than sliding
-- with every call, so a burst cannot keep the limit alive indefinitely by never
-- stopping for a full window.
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
  -- Lock the caller's own row for the length of the transaction. There is at most
  -- one row per user, so this serialises that user's calls against each other and
  -- against nobody else.
  select * into cur from public.ai_usage where user_id = p_user for update;

  if not found then
    insert into public.ai_usage (user_id, window_start, count)
    values (p_user, now_ts, 1);
    return query select true, p_limit - 1, now_ts + window_len;
    return;
  end if;

  if cur.window_start + window_len <= now_ts then
    -- The window this counter belongs to has passed. Start a new one.
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