import { NextResponse, type NextRequest } from "next/server";
import { del, put } from "@vercel/blob";

import {
  createProcessingRecording,
  markRecordingError,
  markRecordingReady,
} from "@/lib/db";
import { transcribeWithElevenLabs } from "@/lib/elevenlabs";
import { generateLessonNotes } from "@/lib/openai";
import { fallbackPeaks } from "@/lib/recordings";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing audio file." }, { status: 400 });
  }

  const recordingId = crypto.randomUUID();
  const title =
    stringFormValue(formData.get("title")) || stripExtension(file.name) || "Untitled lesson";
  const durationSeconds = numberFormValue(formData.get("duration_seconds"));
  const waveformPeaks = parsePeaks(formData.get("waveform_peaks"));
  const blobPathname = `${user.id}/${recordingId}/${safeFileName(file.name || "recording")}`;

  let blob;
  try {
    blob = await put(blobPathname, file, {
      access: "private",
      addRandomSuffix: false,
      contentType: file.type || "application/octet-stream",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Audio upload failed.",
      },
      { status: 500 },
    );
  }

  try {
    await createProcessingRecording({
      blobPathname: blob.pathname,
      blobUrl: blob.url,
      durationSeconds,
      fileName: file.name || null,
      id: recordingId,
      mimeType: file.type || null,
      title,
      userId: user.id,
      waveformPeaks: waveformPeaks.length ? waveformPeaks : fallbackPeaks(),
    });
  } catch (error) {
    await del(blob.url).catch(() => undefined);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Recording save failed.",
      },
      { status: 500 },
    );
  }

  try {
    const transcription = await transcribeWithElevenLabs(file);
    const generated = await generateLessonNotes({
      durationSeconds: transcription.durationSeconds ?? durationSeconds,
      title,
      transcript: transcription.text,
      words: transcription.words,
    });

    const recording = await markRecordingReady({
      annotations: generated.annotations,
      durationSeconds: transcription.durationSeconds ?? durationSeconds,
      id: recordingId,
      notes: generated.notes,
      notesMarkdown: generated.markdown,
      transcriptSegments: transcription.segments,
      transcriptText: transcription.text,
      transcriptWords: transcription.words,
      userId: user.id,
    });

    return NextResponse.json({
      recording,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed.";
    try {
      const recording = await markRecordingError({
        errorMessage: message,
        id: recordingId,
        userId: user.id,
      });
      return NextResponse.json({ error: message, recording }, { status: 500 });
    } catch {
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
}

function stringFormValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function numberFormValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePeaks(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed
          .map((peak) => Number(peak))
          .filter((peak) => Number.isFinite(peak) && peak >= 0)
          .slice(0, 240)
      : [];
  } catch {
    return [];
  }
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, "");
}

function safeFileName(fileName: string) {
  const cleaned = fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned || "recording";
}
