import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse, type NextRequest } from "next/server";

import { processUploadedRecording } from "@/lib/process-recording";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

type UploadTokenPayload = {
  durationSeconds: number | null;
  fileName: string;
  mimeType: string;
  recordingId: string;
  title: string;
  userId: string;
  waveformPeaks: number[];
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as HandleUploadBody;
  const user = body.type === "blob.generate-client-token" ? await getUser() : null;

  if (body.type === "blob.generate-client-token" && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!user || !pathname.startsWith(`${user.id}/`)) {
          throw new Error("Invalid upload path.");
        }

        const uploadPayload = parseClientPayload(clientPayload);

        if (
          !uploadPayload ||
          uploadPayload.userId !== user.id ||
          !pathname.startsWith(`${user.id}/${uploadPayload.recordingId}/`)
        ) {
          throw new Error("Invalid upload metadata.");
        }

        return {
          addRandomSuffix: false,
          allowOverwrite: false,
          allowedContentTypes: [
            "application/octet-stream",
            "audio/*",
            "audio/aac",
            "audio/aiff",
            "audio/flac",
            "audio/mp4",
            "audio/mpeg",
            "audio/ogg",
            "audio/wav",
            "audio/webm",
            "audio/x-aiff",
            "audio/x-m4a",
            "audio/x-wav",
            "video/mp4",
            "video/quicktime",
            "video/x-m4v",
          ],
          maximumSizeInBytes: 1024 * 1024 * 1024,
          tokenPayload: JSON.stringify(uploadPayload),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const uploadPayload = parseTokenPayload(tokenPayload);

        if (
          !uploadPayload ||
          !blob.pathname.startsWith(
            `${uploadPayload.userId}/${uploadPayload.recordingId}/`,
          )
        ) {
          throw new Error("Invalid upload completion payload.");
        }

        await processUploadedRecording({
          blobPathname: blob.pathname,
          durationSeconds: uploadPayload.durationSeconds,
          fileName: uploadPayload.fileName,
          id: uploadPayload.recordingId,
          mimeType: uploadPayload.mimeType,
          title: uploadPayload.title,
          userId: uploadPayload.userId,
          waveformPeaks: uploadPayload.waveformPeaks,
        });
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to prepare upload.",
      },
      { status: 400 },
    );
  }
}

async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return error ? null : user;
}

function parseClientPayload(value: string | null): UploadTokenPayload | null {
  return parseUploadPayload(value);
}

function parseTokenPayload(value: string | null | undefined): UploadTokenPayload | null {
  return parseUploadPayload(value ?? null);
}

function parseUploadPayload(value: string | null): UploadTokenPayload | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const payload = {
      durationSeconds: numberOrNull(parsed.durationSeconds),
      fileName: stringValue(parsed.fileName) || "recording",
      mimeType: stringValue(parsed.mimeType) || "application/octet-stream",
      recordingId: stringValue(parsed.recordingId),
      title: stringValue(parsed.title) || "Untitled lesson",
      userId: stringValue(parsed.userId),
      waveformPeaks: parsePeaks(parsed.waveformPeaks),
    };

    if (!isUuid(payload.recordingId) || !payload.userId) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
