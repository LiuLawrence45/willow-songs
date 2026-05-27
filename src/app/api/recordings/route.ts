import { NextResponse, type NextRequest } from "next/server";
import { del, get } from "@vercel/blob";

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

type CreateRecordingBody = {
  blob_pathname?: unknown;
  duration_seconds?: unknown;
  file_name?: unknown;
  mime_type?: unknown;
  recording_id?: unknown;
  title?: unknown;
  waveform_peaks?: unknown;
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as CreateRecordingBody;
  const recordingId = stringValue(body.recording_id);
  const fileName = stringValue(body.file_name) || "recording";
  const mimeType = stringValue(body.mime_type) || "application/octet-stream";
  const blobPathname = stringValue(body.blob_pathname);
  const title =
    stringValue(body.title) || stripExtension(fileName) || "Untitled lesson";
  const durationSeconds = numberValue(body.duration_seconds);
  const waveformPeaks = parsePeaks(body.waveform_peaks);

  if (!isUuid(recordingId)) {
    return NextResponse.json(
      { error: "Missing recording id." },
      { status: 400 },
    );
  }

  const expectedPrefix = `${user.id}/${recordingId}/`;

  if (!blobPathname || !blobPathname.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: "Invalid uploaded audio." }, { status: 400 });
  }

  const blob = await get(blobPathname, {
    access: "private",
    useCache: false,
  });

  if (!blob || blob.statusCode !== 200) {
    return NextResponse.json({ error: "Uploaded audio not found." }, { status: 404 });
  }

  const audioBlob = await new Response(blob.stream).blob();
  const audioFile = new File([audioBlob], fileName, {
    type: mimeType || blob.blob.contentType || "application/octet-stream",
  });

  try {
    await createProcessingRecording({
      blobPathname: blob.blob.pathname,
      blobUrl: blob.blob.url,
      durationSeconds,
      fileName,
      id: recordingId,
      mimeType,
      title,
      userId: user.id,
      waveformPeaks: waveformPeaks.length ? waveformPeaks : fallbackPeaks(),
    });
  } catch (error) {
    await del(blobPathname).catch(() => undefined);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Recording save failed.",
      },
      { status: 500 },
    );
  }

  try {
    const transcription = await transcribeWithElevenLabs(audioFile);
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

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value !== "number") {
    return null;
  }

  return Number.isFinite(value) && value > 0 ? value : null;
}

function parsePeaks(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((peak) => Number(peak))
    .filter((peak) => Number.isFinite(peak) && peak >= 0)
    .slice(0, 240);
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, "");
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
