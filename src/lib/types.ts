export type RecordingStatus = "processing" | "ready" | "error";

export type TranscriptWord = {
  text: string;
  start: number | null;
  end: number | null;
  speaker: string | null;
  type: string | null;
};

export type TranscriptSegment = {
  id: string;
  start_seconds: number;
  end_seconds: number;
  speaker: string | null;
  text: string;
};

export type LessonAnnotation = {
  id: string;
  title: string;
  summary: string;
  start_seconds: number;
  end_seconds: number;
};

export type LessonSection = {
  title: string;
  body: string;
  cue: string;
  start_seconds: number;
  end_seconds: number;
};

export type PracticeStep = {
  duration: string;
  task: string;
};

export type ListenReference = {
  time_seconds: number;
  reason: string;
};

export type LessonNotes = {
  title: string;
  overall_note: string;
  sections: LessonSection[];
  practice_steps: PracticeStep[];
  listen_references: ListenReference[];
};

export type Recording = {
  id: string;
  user_id: string;
  title: string;
  file_name: string | null;
  file_path: string;
  mime_type: string | null;
  duration_seconds: number | null;
  waveform_peaks: number[];
  transcript_text: string | null;
  transcript_words: TranscriptWord[];
  transcript_segments: TranscriptSegment[];
  notes_markdown: string | null;
  notes_json: LessonNotes | null;
  annotations: LessonAnnotation[];
  status: RecordingStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type RecordingRow = Omit<
  Recording,
  | "waveform_peaks"
  | "transcript_words"
  | "transcript_segments"
  | "notes_json"
  | "annotations"
> & {
  waveform_peaks: unknown;
  transcript_words: unknown;
  transcript_segments: unknown;
  notes_json: unknown;
  annotations: unknown;
};
