import { NextResponse, type NextRequest } from "next/server";

import { transcribeWithElevenLabs } from "@/lib/elevenlabs";
import { generateLessonNotes } from "@/lib/openai";
import {
  fallbackPeaks,
  normalizeRecording,
  RECORDING_SELECT,
} from "@/lib/recordings";
import { createClient } from "@/lib/supabase/server";
import type { RecordingRow } from "@/lib/types";

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
  const filePath = `${user.id}/${recordingId}/${safeFileName(file.name || "recording")}`;

  const upload = await supabase.storage.from("recordings").upload(filePath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (upload.error) {
    return NextResponse.json({ error: upload.error.message }, { status: 500 });
  }

  const insert = await supabase
    .from("recordings")
    .insert({
      duration_seconds: durationSeconds,
      file_name: file.name || null,
      file_path: filePath,
      id: recordingId,
      mime_type: file.type || null,
      status: "processing",
      title,
      user_id: user.id,
      waveform_peaks: waveformPeaks.length ? waveformPeaks : fallbackPeaks(),
    })
    .select(RECORDING_SELECT)
    .single();

  if (insert.error) {
    return NextResponse.json({ error: insert.error.message }, { status: 500 });
  }

  try {
    const transcription = await transcribeWithElevenLabs(file);
    const generated = await generateLessonNotes({
      durationSeconds: transcription.durationSeconds ?? durationSeconds,
      title,
      transcript: transcription.text,
      words: transcription.words,
    });

    const update = await supabase
      .from("recordings")
      .update({
        annotations: generated.annotations,
        duration_seconds: transcription.durationSeconds ?? durationSeconds,
        error_message: null,
        notes_json: generated.notes,
        notes_markdown: generated.markdown,
        status: "ready",
        transcript_segments: transcription.segments,
        transcript_text: transcription.text,
        transcript_words: transcription.words,
      })
      .eq("id", recordingId)
      .eq("user_id", user.id)
      .select(RECORDING_SELECT)
      .single();

    if (update.error) {
      throw new Error(update.error.message);
    }

    return NextResponse.json({
      recording: normalizeRecording(update.data as RecordingRow),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed.";
    const failed = await supabase
      .from("recordings")
      .update({
        error_message: message,
        status: "error",
      })
      .eq("id", recordingId)
      .eq("user_id", user.id)
      .select(RECORDING_SELECT)
      .single();

    if (failed.error) {
      return NextResponse.json({ error: message }, { status: 500 });
    }

    return NextResponse.json(
      {
        error: message,
        recording: normalizeRecording(failed.data as RecordingRow),
      },
      { status: 500 },
    );
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
