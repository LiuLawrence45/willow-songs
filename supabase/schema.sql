create extension if not exists pgcrypto;

create table if not exists public.recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  file_name text,
  file_path text not null,
  mime_type text,
  duration_seconds double precision,
  waveform_peaks jsonb not null default '[]'::jsonb,
  transcript_text text,
  transcript_words jsonb not null default '[]'::jsonb,
  transcript_segments jsonb not null default '[]'::jsonb,
  notes_markdown text,
  notes_json jsonb not null default '{}'::jsonb,
  annotations jsonb not null default '[]'::jsonb,
  status text not null default 'processing' check (status in ('processing', 'ready', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recordings_user_created_idx
  on public.recordings(user_id, created_at desc);

alter table public.recordings enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.recordings to authenticated;

create or replace function public.set_recordings_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists recordings_set_updated_at on public.recordings;
create trigger recordings_set_updated_at
before update on public.recordings
for each row execute function public.set_recordings_updated_at();

create policy recordings_select_own on public.recordings
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy recordings_insert_own on public.recordings
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy recordings_update_own on public.recordings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy recordings_delete_own on public.recordings
  for delete to authenticated
  using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do update set public = false;

create policy recordings_select_own_folder on storage.objects
  for select to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy recordings_insert_own_folder on storage.objects
  for insert to authenticated
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy recordings_update_own_folder on storage.objects
  for update to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy recordings_delete_own_folder on storage.objects
  for delete to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);
