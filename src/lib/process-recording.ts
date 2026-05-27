import { get } from "@vercel/blob";

import {
  createProcessingRecording,
  getRecordingForUser,
  markRecordingError,
  markRecordingReady,
} from "@/lib/db";
import { transcribeWithElevenLabs } from "@/lib/elevenlabs";
import { generateLessonNotes } from "@/lib/openai";
import { fallbackPeaks } from "@/lib/recordings";
import type { Recording } from "@/lib/types";

export type ProcessUploadedRecordingInput = {
  blobPathname: string;
  durationSeconds: number | null;
  fileName: string;
  id: string;
  mimeType: string;
  title: string;
  userId: string;
  waveformPeaks: number[];
};

export async function processUploadedRecording(
  input: ProcessUploadedRecordingInput,
): Promise<Recording> {
  const existing = await getRecordingForUser({
    id: input.id,
    userId: input.userId,
  });

  if (existing?.status === "ready") {
    return existing;
  }

  const blob = await get(input.blobPathname, {
    access: "private",
    useCache: false,
  });

  if (!blob || blob.statusCode !== 200) {
    throw new Error("Uploaded audio not found.");
  }

  if (!existing) {
    await createProcessingRecording({
      blobPathname: blob.blob.pathname,
      blobUrl: blob.blob.url,
      durationSeconds: input.durationSeconds,
      fileName: input.fileName,
      id: input.id,
      mimeType: input.mimeType || blob.blob.contentType || "application/octet-stream",
      title: input.title,
      userId: input.userId,
      waveformPeaks: input.waveformPeaks.length
        ? input.waveformPeaks
        : fallbackPeaks(),
    });
  }

  const audioBlob = await new Response(blob.stream).blob();
  const audioFile = new File([audioBlob], input.fileName, {
    type: input.mimeType || blob.blob.contentType || "application/octet-stream",
  });

  try {
    const transcription = await transcribeWithElevenLabs(audioFile);
    const generated = await generateLessonNotes({
      durationSeconds: transcription.durationSeconds ?? input.durationSeconds,
      title: input.title,
      transcript: transcription.text,
      words: transcription.words,
    });

    return await markRecordingReady({
      annotations: generated.annotations,
      durationSeconds: transcription.durationSeconds ?? input.durationSeconds,
      id: input.id,
      notes: generated.notes,
      notesMarkdown: generated.markdown,
      transcriptSegments: transcription.segments,
      transcriptText: transcription.text,
      transcriptWords: transcription.words,
      userId: input.userId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed.";

    return markRecordingError({
      errorMessage: message,
      id: input.id,
      userId: input.userId,
    });
  }
}
