import { NextResponse, type NextRequest } from "next/server";

import { getRecordingAudio } from "@/lib/db";
import { getRequiredEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recording = await getRecordingAudio({ id, userId: user.id });

  if (!recording) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  const headers = new Headers({
    Authorization: `Bearer ${getRequiredEnv("BLOB_READ_WRITE_TOKEN")}`,
  });
  const range = request.headers.get("range");

  if (range) {
    headers.set("Range", range);
  }

  const blobResponse = await fetch(recording.blobUrl, { headers });

  if (!blobResponse.ok && blobResponse.status !== 206) {
    return NextResponse.json({ error: "Unable to load audio." }, { status: 500 });
  }

  const responseHeaders = new Headers({
    "Cache-Control": "private, no-cache",
    "Content-Type":
      blobResponse.headers.get("content-type") ||
      recording.mimeType ||
      "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });

  for (const header of [
    "accept-ranges",
    "content-length",
    "content-range",
    "etag",
    "last-modified",
  ]) {
    const value = blobResponse.headers.get(header);
    if (value) {
      responseHeaders.set(header, value);
    }
  }

  return new NextResponse(blobResponse.body, {
    headers: responseHeaders,
    status: blobResponse.status,
  });
}
