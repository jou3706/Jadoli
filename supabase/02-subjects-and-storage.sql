-- Jadwali — migration: subject covers + file storage
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It is additive: safe to run more than once.

-- ── 1. Uploaded files on materials ──────────────────────────────────────
alter table public.materials add column if not exists file_path text not null default '';
alter table public.materials add column if not exists size bigint not null default 0;
-- The client stamps updated_date on every insert; see supabase/07-updated-date.sql.
alter table public.materials
  add column if not exists updated_date timestamptz not null default now();

create index if not exists materials_subject_idx
  on public.materials (user_id, subject_key);

-- ── 2. Subjects: one row per course, holds the cover image ──────────────
create table if not exists public.subjects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  name          text not null,
  image_url     text not null default '',
  image_credit  text not null default '',
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

-- Added after the first run: the picked Wikimedia image needs its credit.
alter table public.subjects
  add column if not exists image_credit text not null default '';

create unique index if not exists subjects_user_name_key
  on public.subjects (user_id, name);

alter table public.subjects enable row level security;

drop policy if exists subjects_own on public.subjects;
create policy subjects_own on public.subjects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 3. Storage bucket for dropped files ─────────────────────────────────
-- Public so a PDF opens in a new tab; writes are limited to the owner's
-- own folder (<user id>/…) by the policies below.
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
