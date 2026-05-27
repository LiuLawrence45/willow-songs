import { getRequiredEnv } from "@/lib/env";
import type { TranscriptSegment, TranscriptWord } from "@/lib/types";

type ElevenLabsWord = {
  text?: string;
  start?: number;
  end?: number;
  speaker_id?: string;
  speaker?: string;
  type?: string;
};

type ElevenLabsResponse = {
  text?: string;
  words?: ElevenLabsWord[];
  audio_duration_secs?: number;
};

export type TranscriptionResult = {
  text: string;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
  durationSeconds: number | null;
};

export async function transcribeWithElevenLabs(
  file: File,
): Promise<TranscriptionResult> {
  const apiKey = getRequiredEnv("ELEVENLABS_API_KEY");
  const formData = new FormData();

  formData.append("model_id", "scribe_v2");
  formData.append("file", file, file.name || "recording");
  formData.append("timestamps_granularity", "word");
  formData.append("diarize", "true");
  formData.append("tag_audio_events", "true");

  const response = await fetch(
    "https://api.elevenlabs.io/v1/speech-to-text/convert",
    {
      body: formData,
      headers: {
        "xi-api-key": apiKey,
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs transcription failed: ${body}`);
  }

  const payload = (await response.json()) as ElevenLabsResponse;
  const words = normalizeWords(payload.words ?? []);

  return {
    durationSeconds: numberOrNull(payload.audio_duration_secs),
    segments: buildSegments(words),
    text: payload.text?.trim() ?? words.map((word) => word.text).join(" "),
    words,
  };
}

function normalizeWords(words: ElevenLabsWord[]): TranscriptWord[] {
  return words
    .map((word) => ({
      end: numberOrNull(word.end),
      speaker: word.speaker_id ?? word.speaker ?? null,
      start: numberOrNull(word.start),
      text: word.text?.trim() ?? "",
      type: word.type ?? null,
    }))
    .filter((word) => word.text.length > 0);
}

function buildSegments(words: TranscriptWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;

  for (const word of words) {
    const start: number = word.start ?? current?.end_seconds ?? 0;
    const end: number = word.end ?? start;
    const startsNewSegment =
      !current ||
      current.speaker !== word.speaker ||
      start - current.end_seconds > 1.5 ||
      current.text.length > 260;

    if (startsNewSegment) {
      current = {
        end_seconds: end,
        id: `segment-${segments.length + 1}`,
        speaker: word.speaker,
        start_seconds: start,
        text: word.text,
      };
      segments.push(current);
    } else {
      current!.text = `${current!.text}${needsLeadingSpace(word.text) ? " " : ""}${word.text}`;
      current!.end_seconds = Math.max(current!.end_seconds, end);
    }

    if (/[.!?]$/.test(word.text) && current!.text.length > 80) {
      current = null;
    }
  }

  return segments;
}

function needsLeadingSpace(text: string) {
  return !/^[,.;:!?)]/.test(text);
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
