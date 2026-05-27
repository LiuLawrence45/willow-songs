import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(`${user.id}/`)) {
          throw new Error("Invalid upload path.");
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
          tokenPayload: JSON.stringify({ userId: user.id }),
        };
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
