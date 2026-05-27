create table if not exists recordings (
  id text primary key,
  user_id text not null,
  title text not null,
  file_name text,
  blob_url text not null,
  blob_pathname text not null,
  mime_type text,
  duration_seconds double precision,
  waveform_peaks jsonb not null default '[]'::jsonb,
  transcript_text text,
  transcript_words jsonb not null default '[]'::jsonb,
  transcript_segments jsonb not null default '[]'::jsonb,
  notes_markdown text,
  notes_json jsonb not null default '{}'::jsonb,
  annotations jsonb not null default '[]'::jsonb,
  status text not null default 'processing'
    check (status in ('processing', 'ready', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recordings_user_created_idx
  on recordings(user_id, created_at desc);
