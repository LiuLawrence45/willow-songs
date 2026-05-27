import { NextResponse } from "next/server";

import { getRecordingChatContext } from "@/lib/db";
import { answerTranscriptQuestion } from "@/lib/openai";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

export async function POST(
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

  const body = (await request.json()) as { question?: unknown };
  const question = typeof body.question === "string" ? body.question.trim() : "";

  if (!question) {
    return NextResponse.json({ error: "Missing question." }, { status: 400 });
  }

  const recording = await getRecordingChatContext({ id, userId: user.id });

  if (!recording) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  const answer = await answerTranscriptQuestion({
    notes: recording.notesMarkdown ?? "",
    question,
    transcript: recording.transcriptText ?? "",
  });

  return NextResponse.json({ answer });
}
