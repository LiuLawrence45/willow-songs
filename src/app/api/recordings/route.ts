import { NextResponse, type NextRequest } from "next/server";

import { processUploadedRecording } from "@/lib/process-recording";
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

  try {
    const recording = await processUploadedRecording({
      blobPathname,
      durationSeconds,
      fileName,
      id: recordingId,
      mimeType,
      title,
      userId: user.id,
      waveformPeaks,
    });

    return NextResponse.json({
      recording,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed.";
    return NextResponse.json({ error: message }, { status: 500 });
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
