import { NextResponse } from "next/server";

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

  const recording = await supabase
    .from("recordings")
    .select("transcript_text, notes_markdown, title")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (recording.error || !recording.data) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  const answer = await answerTranscriptQuestion({
    notes: recording.data.notes_markdown ?? "",
    question,
    transcript: recording.data.transcript_text ?? "",
  });

  return NextResponse.json({ answer });
}
