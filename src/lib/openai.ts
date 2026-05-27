import OpenAI from "openai";

import { getRequiredEnv } from "@/lib/env";
import {
  buildMarkdown,
  makeAnnotations,
  secondsToTimestamp,
} from "@/lib/recordings";
import type { LessonNotes, TranscriptWord } from "@/lib/types";

let openAIClient: OpenAI | null = null;

function getOpenAIClient() {
  if (!openAIClient) {
    openAIClient = new OpenAI({ apiKey: getRequiredEnv("OPENAI_API_KEY") });
  }

  return openAIClient;
}

function getModel() {
  return process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

export async function generateLessonNotes({
  durationSeconds,
  title,
  transcript,
  words,
}: {
  durationSeconds: number | null;
  title: string;
  transcript: string;
  words: TranscriptWord[];
}) {
  if (!process.env.OPENAI_API_KEY) {
    const notes = buildFallbackNotes({ durationSeconds, title, words });

    return {
      annotations: makeAnnotations(notes),
      markdown: buildMarkdown(notes),
      notes,
    };
  }

  const client = getOpenAIClient();
  const timestampHints = words
    .filter((word) => word.start !== null)
    .slice(0, 260)
    .map((word) => `${secondsToTimestamp(word.start)} ${word.text}`)
    .join(" ");

  const completion = await client.chat.completions.create({
    messages: [
      {
        content:
          "You turn voice lesson transcripts into concise, actionable singing practice notes. Return only valid JSON. Use generated section times as waveform annotations. Preserve practical teacher cues, body sensations, and reference moments. Do not quote long song lyrics.",
        role: "system",
      },
      {
        content: JSON.stringify({
          duration_seconds: durationSeconds,
          output_shape: {
            listen_references:
              "array of { time_seconds:number, reason:string }",
            overall_note: "string",
            practice_steps: "array of { duration:string, task:string }",
            sections:
              "array of 4-7 { title:string, body:string, cue:string, start_seconds:number, end_seconds:number }",
            title: "string",
          },
          timestamp_hints: timestampHints,
          title,
          transcript: transcript.slice(0, 60000),
        }),
        role: "user",
      },
    ],
    model: getModel(),
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message.content;
  if (!content) {
    throw new Error("OpenAI returned an empty notes response.");
  }

  const notes = normalizeNotes(JSON.parse(content), title, durationSeconds);

  return {
    annotations: makeAnnotations(notes),
    markdown: buildMarkdown(notes),
    notes,
  };
}

export async function answerTranscriptQuestion({
  notes,
  question,
  transcript,
}: {
  notes: string;
  question: string;
  transcript: string;
}) {
  if (!process.env.OPENAI_API_KEY) {
    return `OpenAI is not configured yet, so I can only give a simple pointer. For "${question}", start with the generated notes and then search the transcript for the phrase or cue you are asking about.`;
  }

  const client = getOpenAIClient();

  const completion = await client.chat.completions.create({
    messages: [
      {
        content:
          "You answer questions about a singing lesson transcript. Be direct, practical, and tie advice back to timestamps or notes when available. Do not invent transcript details.",
        role: "system",
      },
      {
        content: `Notes:\n${notes.slice(0, 18000)}\n\nTranscript:\n${transcript.slice(0, 50000)}\n\nQuestion:\n${question}`,
        role: "user",
      },
    ],
    model: getModel(),
  });

  return (
    completion.choices[0]?.message.content?.trim() ||
    "I could not generate an answer for that lesson yet."
  );
}

function normalizeNotes(
  value: unknown,
  fallbackTitle: string,
  durationSeconds: number | null,
): LessonNotes {
  const object = isRecord(value) ? value : {};
  const duration = Math.max(1, durationSeconds ?? 1);
  const rawSections = Array.isArray(object.sections) ? object.sections : [];
  const sections = rawSections.slice(0, 7).map((section, index) => {
    const sectionObject = isRecord(section) ? section : {};
    const fallbackStart = (duration / Math.max(rawSections.length, 4)) * index;
    const start = numberOr(sectionObject.start_seconds, fallbackStart);
    const end = numberOr(
      sectionObject.end_seconds,
      Math.min(duration, start + Math.max(20, duration / 10)),
    );

    return {
      body: stringOr(sectionObject.body, "Practice this idea slowly, then apply it to the target phrase."),
      cue: stringOr(sectionObject.cue, "Listen once, then copy the sensation."),
      end_seconds: clamp(Math.max(start + 1, end), 1, duration),
      start_seconds: clamp(start, 0, duration - 1),
      title: stringOr(sectionObject.title, `Practice focus ${index + 1}`),
    };
  });

  const practiceSteps = Array.isArray(object.practice_steps)
    ? object.practice_steps.slice(0, 6).map((step) => {
        const stepObject = isRecord(step) ? step : {};
        return {
          duration: stringOr(stepObject.duration, "5 min"),
          task: stringOr(stepObject.task, "Practice the selected section."),
        };
      })
    : [];

  const listenReferences = Array.isArray(object.listen_references)
    ? object.listen_references.slice(0, 5).map((item) => {
        const itemObject = isRecord(item) ? item : {};
        return {
          reason: stringOr(itemObject.reason, "Replay this teacher reference."),
          time_seconds: clamp(numberOr(itemObject.time_seconds, 0), 0, duration),
        };
      })
    : [];

  return {
    listen_references: listenReferences.length
      ? listenReferences
      : sections.slice(0, 3).map((section) => ({
          reason: section.cue,
          time_seconds: section.start_seconds,
        })),
    overall_note: stringOr(
      object.overall_note,
      "Keep the sound supported by steady air and use the lesson sections as short reference clips.",
    ),
    practice_steps: practiceSteps.length
      ? practiceSteps
      : [
          { duration: "3 min", task: "Reset breath and body expansion." },
          { duration: "7 min", task: "Loop the first two lesson sections." },
          { duration: "5 min", task: "Record one pass and compare tension." },
        ],
    sections: sections.length
      ? sections
      : [
          {
            body: "Start by replaying the clearest teacher reference and copying the body sensation before singing.",
            cue: "Expansion first, sound second.",
            end_seconds: Math.min(duration, 45),
            start_seconds: 0,
            title: "Reference reset",
          },
        ],
    title: stringOr(object.title, fallbackTitle),
  };
}

function buildFallbackNotes({
  durationSeconds,
  title,
  words,
}: {
  durationSeconds: number | null;
  title: string;
  words: TranscriptWord[];
}): LessonNotes {
  const duration = Math.max(1, durationSeconds ?? words.at(-1)?.end ?? 300);
  const chunkCount = Math.min(5, Math.max(3, Math.ceil(duration / 600)));
  const sections = Array.from({ length: chunkCount }, (_, index) => {
    const start = Math.floor((duration / chunkCount) * index);
    const end = Math.floor(
      index === chunkCount - 1 ? duration : (duration / chunkCount) * (index + 1),
    );
    const excerpt = transcriptWordsNear(words, start, end);

    return {
      body:
        excerpt ||
        "Replay this part and write down the teacher's exact cue after listening.",
      cue:
        index === 0
          ? "Notice the setup before singing."
          : "Listen for the physical sensation, then copy it slowly.",
      end_seconds: Math.max(start + 1, end),
      start_seconds: start,
      title: `Lesson section ${index + 1}`,
    };
  });

  return {
    listen_references: sections.slice(0, 3).map((section) => ({
      reason: section.cue,
      time_seconds: section.start_seconds,
    })),
    overall_note:
      "The transcript is ready. Use each generated section as a replay point, then edit these notes with the exact teacher cues that matter most.",
    practice_steps: [
      { duration: "3 min", task: "Replay the first section and reset breath." },
      { duration: "7 min", task: "Loop the clearest teacher reference." },
      { duration: "10 min", task: "Practice the target phrase slowly." },
      { duration: "2 min", task: "Record one pass and compare tension." },
    ],
    sections,
    title,
  };
}

function transcriptWordsNear(
  words: TranscriptWord[],
  startSeconds: number,
  endSeconds: number,
) {
  return words
    .filter((word) => {
      const start = word.start ?? 0;
      return start >= startSeconds && start <= endSeconds;
    })
    .slice(0, 32)
    .map((word) => word.text)
    .join(" ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
