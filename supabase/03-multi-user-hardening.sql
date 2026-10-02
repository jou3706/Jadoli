-- Multi-user hardening. Safe to run more than once.
--
-- 1. share_links could be read by anyone holding the anon key, which ships in
--    the browser bundle. That let any visitor list every user's shared
--    schedule. Anonymous viewing goes through /api/share/[token] with the
--    service key, which bypasses RLS, so owner-only costs the app nothing.
--
-- The rest of the app already scopes every table with
-- `auth.uid() = user_id`, which is what keeps two accounts from seeing each
-- other's rows. These are the policies that were missing it.

begin;

drop policy if exists share_links_read on public.share_links;
create policy share_links_read on public.share_links
  for select using (auth.uid() = user_id);

-- The owner has to be able to drop their own share links.
drop policy if exists share_links_delete on public.share_links;
create policy share_links_delete on public.share_links
  for delete using (auth.uid() = user_id);

-- Belt and braces: no table may sit in the database with RLS switched off.
do $$
declare
  t text;
begin
  foreach t in array array[
'lectures', 'attendance', 'grades', 'halls', 'materials',
      'subjects', 'subject_events', 'university_events', 'chats', 'messages',
      'share_links'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

commit;
