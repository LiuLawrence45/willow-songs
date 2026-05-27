import type {
  LessonAnnotation,
  LessonNotes,
  Recording,
  RecordingRow,
  TranscriptSegment,
  TranscriptWord,
} from "@/lib/types";

export function normalizeRecording(row: RecordingRow): Recording {
  return {
    created_at: timestampString(row.created_at),
    duration_seconds: row.duration_seconds,
    error_message: row.error_message,
    file_name: row.file_name,
    id: row.id,
    mime_type: row.mime_type,
    notes_markdown: row.notes_markdown,
    status: row.status,
    title: row.title,
    transcript_text: row.transcript_text,
    updated_at: timestampString(row.updated_at),
    user_id: row.user_id,
    annotations: arrayOf<LessonAnnotation>(row.annotations),
    notes_json: lessonNotesOrNull(row.notes_json),
    transcript_segments: arrayOf<TranscriptSegment>(row.transcript_segments),
    transcript_words: arrayOf<TranscriptWord>(row.transcript_words),
    waveform_peaks: arrayOf<number>(row.waveform_peaks).filter(
      (peak) => Number.isFinite(peak) && peak >= 0,
    ),
  };
}

export function normalizeRecordings(rows: RecordingRow[] | null): Recording[] {
  return (rows ?? []).map(normalizeRecording);
}

export function secondsToTimestamp(totalSeconds: number | null | undefined) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds ?? 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function buildMarkdown(notes: LessonNotes) {
  const practice = notes.practice_steps
    .map((step) => `- ${step.duration}: ${step.task}`)
    .join("\n");
  const listen = notes.listen_references
    .map((item) => `- ${secondsToTimestamp(item.time_seconds)}: ${item.reason}`)
    .join("\n");
  const sections = notes.sections
    .map(
      (section) =>
        `## ${section.title}\n${section.body}\n\nCue: ${section.cue}\nListen: ${secondsToTimestamp(section.start_seconds)}-${secondsToTimestamp(section.end_seconds)}`,
    )
    .join("\n\n");

  return `# ${notes.title}\n\n## Overall\n${notes.overall_note}\n\n## Practice this week\n${practice}\n\n## Listen back\n${listen}\n\n${sections}`;
}

export function makeAnnotations(notes: LessonNotes): LessonAnnotation[] {
  return notes.sections.map((section, index) => ({
    id: `${index + 1}-${slugify(section.title)}`,
    title: section.title,
    summary: section.cue || section.body,
    start_seconds: Math.max(0, section.start_seconds),
    end_seconds: Math.max(section.start_seconds + 1, section.end_seconds),
  }));
}

export function fallbackPeaks(count = 96) {
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin(index * 0.47) * 0.24 + Math.sin(index * 0.13) * 0.18;
    return Math.round((0.52 + wave) * 100) / 100;
  });
}

function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function lessonNotesOrNull(value: unknown): LessonNotes | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as LessonNotes;
}

function timestampString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return typeof value === "string" ? value : new Date().toISOString();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
