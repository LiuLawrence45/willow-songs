import { NextResponse } from "next/server";

import { normalizeRecording, RECORDING_SELECT } from "@/lib/recordings";
import { createClient } from "@/lib/supabase/server";
import type { RecordingRow } from "@/lib/types";

export async function PATCH(
  request: Request,
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

  const body = (await request.json()) as { notes_markdown?: unknown };

  if (typeof body.notes_markdown !== "string") {
    return NextResponse.json({ error: "Missing notes." }, { status: 400 });
  }

  const update = await supabase
    .from("recordings")
    .update({ notes_markdown: body.notes_markdown })
    .eq("id", id)
    .eq("user_id", user.id)
    .select(RECORDING_SELECT)
    .single();

  if (update.error) {
    return NextResponse.json({ error: update.error.message }, { status: 500 });
  }

  return NextResponse.json({
    recording: normalizeRecording(update.data as RecordingRow),
  });
}
