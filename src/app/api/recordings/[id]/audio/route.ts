import { NextResponse, type NextRequest } from "next/server";

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

  const recording = await supabase
    .from("recordings")
    .select("file_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (recording.error || !recording.data?.file_path) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  const signed = await supabase.storage
    .from("recordings")
    .createSignedUrl(recording.data.file_path, 60 * 60);

  if (signed.error || !signed.data?.signedUrl) {
    return NextResponse.json(
      { error: signed.error?.message ?? "Unable to load audio." },
      { status: 500 },
    );
  }

  return NextResponse.redirect(new URL(signed.data.signedUrl, request.url));
}
