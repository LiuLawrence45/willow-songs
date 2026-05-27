import { NextResponse } from "next/server";

import { updateRecordingNotes } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

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

  try {
    const recording = await updateRecordingNotes({
      id,
      notesMarkdown: body.notes_markdown,
      userId: user.id,
    });
    return NextResponse.json({ recording });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to save notes.",
      },
      { status: 500 },
    );
  }
}
