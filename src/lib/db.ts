import { neon } from "@neondatabase/serverless";

import { normalizeRecording, normalizeRecordings } from "@/lib/recordings";
import type {
  LessonAnnotation,
  LessonNotes,
  Recording,
  RecordingRow,
  TranscriptSegment,
  TranscriptWord,
} from "@/lib/types";

const RECORDING_COLUMNS = `
  id,
  user_id,
  title,
  file_name,
  blob_url,
  blob_pathname,
  mime_type,
  duration_seconds,
  waveform_peaks,
  transcript_text,
  transcript_words,
  transcript_segments,
  notes_markdown,
  notes_json,
  annotations,
  status,
  error_message,
  created_at,
  updated_at
`;

type SqlClient = ReturnType<typeof neon>;

let sqlClient: SqlClient | null = null;
let schemaReady: Promise<void> | null = null;

export type RecordingAudio = {
  blobPathname: string;
  blobUrl: string;
  mimeType: string | null;
};

export type RecordingChatContext = {
  notesMarkdown: string | null;
  title: string;
  transcriptText: string | null;
};

export function getSql() {
  if (!sqlClient) {
    const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

    if (!databaseUrl) {
      throw new Error("Missing DATABASE_URL or POSTGRES_URL.");
    }

    sqlClient = neon(databaseUrl);
  }

  return sqlClient;
}

export async function ensureRecordingsSchema() {
  schemaReady ??= createRecordingsSchema();
  return schemaReady;
}

export async function listRecordingsForUser(userId: string) {
  const rows = await queryRecordingRows(
    `select ${RECORDING_COLUMNS}
     from recordings
     where user_id = $1
     order by created_at desc`,
    [userId],
  );

  return normalizeRecordings(rows);
}

export async function getRecordingForUser(input: {
  id: string;
  userId: string;
}) {
  const rows = await queryRecordingRows(
    `select ${RECORDING_COLUMNS}
     from recordings
     where id = $1 and user_id = $2
     limit 1`,
    [input.id, input.userId],
  );

  return rows[0] ? normalizeRecording(rows[0]) : null;
}

export async function createProcessingRecording(input: {
  blobPathname: string;
  blobUrl: string;
  durationSeconds: number | null;
  fileName: string | null;
  id: string;
  mimeType: string | null;
  title: string;
  userId: string;
  waveformPeaks: number[];
}) {
  const rows = await queryRecordingRows(
    `insert into recordings (
       id,
       user_id,
       title,
       file_name,
       blob_url,
       blob_pathname,
       mime_type,
       duration_seconds,
       waveform_peaks,
       status
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'processing')
     returning ${RECORDING_COLUMNS}`,
    [
      input.id,
      input.userId,
      input.title,
      input.fileName,
      input.blobUrl,
      input.blobPathname,
      input.mimeType,
      input.durationSeconds,
      JSON.stringify(input.waveformPeaks),
    ],
  );

  return requireRecording(rows);
}

export async function markRecordingReady(input: {
  annotations: LessonAnnotation[];
  durationSeconds: number | null;
  id: string;
  notes: LessonNotes;
  notesMarkdown: string;
  transcriptSegments: TranscriptSegment[];
  transcriptText: string;
  transcriptWords: TranscriptWord[];
  userId: string;
}) {
  const rows = await queryRecordingRows(
    `update recordings
     set annotations = $3::jsonb,
         duration_seconds = $4,
         error_message = null,
         notes_json = $5::jsonb,
         notes_markdown = $6,
         status = 'ready',
         transcript_segments = $7::jsonb,
         transcript_text = $8,
         transcript_words = $9::jsonb,
         updated_at = now()
     where id = $1 and user_id = $2
     returning ${RECORDING_COLUMNS}`,
    [
      input.id,
      input.userId,
      JSON.stringify(input.annotations),
      input.durationSeconds,
      JSON.stringify(input.notes),
      input.notesMarkdown,
      JSON.stringify(input.transcriptSegments),
      input.transcriptText,
      JSON.stringify(input.transcriptWords),
    ],
  );

  return requireRecording(rows);
}

export async function markRecordingError(input: {
  errorMessage: string;
  id: string;
  userId: string;
}) {
  const rows = await queryRecordingRows(
    `update recordings
     set error_message = $3,
         status = 'error',
         updated_at = now()
     where id = $1 and user_id = $2
     returning ${RECORDING_COLUMNS}`,
    [input.id, input.userId, input.errorMessage],
  );

  return requireRecording(rows);
}

export async function updateRecordingNotes(input: {
  id: string;
  notesMarkdown: string;
  userId: string;
}) {
  const rows = await queryRecordingRows(
    `update recordings
     set notes_markdown = $3,
         updated_at = now()
     where id = $1 and user_id = $2
     returning ${RECORDING_COLUMNS}`,
    [input.id, input.userId, input.notesMarkdown],
  );

  return requireRecording(rows);
}

export async function getRecordingAudio(input: {
  id: string;
  userId: string;
}): Promise<RecordingAudio | null> {
  await ensureRecordingsSchema();
  const rows = (await getSql().query(
    `select blob_pathname, blob_url, mime_type
     from recordings
     where id = $1 and user_id = $2
     limit 1`,
    [input.id, input.userId],
  )) as Array<{ blob_pathname: string; blob_url: string; mime_type: string | null }>;
  const row = rows[0];

  return row
    ? {
        blobPathname: row.blob_pathname,
        blobUrl: row.blob_url,
        mimeType: row.mime_type,
      }
    : null;
}

export async function getRecordingChatContext(input: {
  id: string;
  userId: string;
}): Promise<RecordingChatContext | null> {
  await ensureRecordingsSchema();
  const rows = (await getSql().query(
    `select transcript_text, notes_markdown, title
     from recordings
     where id = $1 and user_id = $2
     limit 1`,
    [input.id, input.userId],
  )) as Array<{
    notes_markdown: string | null;
    title: string;
    transcript_text: string | null;
  }>;
  const row = rows[0];

  return row
    ? {
        notesMarkdown: row.notes_markdown,
        title: row.title,
        transcriptText: row.transcript_text,
      }
    : null;
}

async function queryRecordingRows(query: string, params: unknown[]) {
  await ensureRecordingsSchema();
  const rows = await getSql().query(query, params);
  return rows as RecordingRow[];
}

async function createRecordingsSchema() {
  const sql = getSql();

  await sql.query(`
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
    )
  `);

  await sql.query(`
    create index if not exists recordings_user_created_idx
      on recordings(user_id, created_at desc)
  `);
}

function requireRecording(rows: RecordingRow[]): Recording {
  const row = rows[0];

  if (!row) {
    throw new Error("Recording not found.");
  }

  return normalizeRecording(row);
}
