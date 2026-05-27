"use client";

import { upload } from "@vercel/blob/client";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileAudio,
  Loader2,
  MessageCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  Save,
  Search,
  Send,
  Upload,
  UserRound,
  Waves,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  fallbackPeaks,
  secondsToTimestamp,
} from "@/lib/recordings";
import type { LessonAnnotation, Recording } from "@/lib/types";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type UploadStage = "preparing" | "uploading" | "processing" | "complete" | "error";

type UploadState = {
  etaSeconds: number | null;
  fileName: string;
  fileSize: number;
  loaded: number;
  message: string;
  percentage: number;
  speedBps: number | null;
  stage: UploadStage;
  startedAt: number;
  total: number;
};

const MULTIPART_UPLOAD_THRESHOLD_BYTES = 64 * 1024 * 1024;

export function SongsApp({
  initialRecordings,
  userEmail,
  userId,
}: {
  initialRecordings: Recording[];
  userEmail: string;
  userId: string;
}) {
  const [recordings, setRecordings] = useState(initialRecordings);
  const [activeId, setActiveId] = useState(initialRecordings[0]?.id ?? null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [activeAnnotation, setActiveAnnotation] =
    useState<LessonAnnotation | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);

  const activeRecording = useMemo(
    () => recordings.find((recording) => recording.id === activeId) ?? recordings[0] ?? null,
    [activeId, recordings],
  );

  useEffect(() => {
    setNotesDraft(activeRecording?.notes_markdown ?? "");
    setActiveAnnotation(activeRecording?.annotations[0] ?? null);
    setChatMessages([]);
    setChatQuestion("");
    setChatOpen(false);
    setEditingNotes(false);
    setPlaying(false);
  }, [
    activeRecording?.annotations,
    activeRecording?.id,
    activeRecording?.notes_markdown,
  ]);

  async function handleUpload(file: File | undefined) {
    if (!file) {
      return;
    }

    if (uploading) {
      setUploadError("An upload is already running. Let this one finish first.");
      return;
    }

    if (!isSupportedMediaFile(file)) {
      setUploadError("Choose an audio recording, MP4, QuickTime, or M4V file.");
      return;
    }

    const recordingId = crypto.randomUUID();
    const startedAt = Date.now();
    const fileName = file.name || "recording";
    const contentType = getMediaContentType(file);

    setUploadError(null);
    setUploading(true);
    setUploadState({
      etaSeconds: null,
      fileName,
      fileSize: file.size,
      loaded: 0,
      message: "Preparing secure upload",
      percentage: 0,
      speedBps: null,
      stage: "preparing",
      startedAt,
      total: file.size,
    });

    let noProgressTimeoutId: number | null = null;

    try {
      noProgressTimeoutId = window.setTimeout(() => {
        setUploadState((current) =>
          current && current.stage === "preparing"
            ? {
                ...current,
                message: "Still connecting to Blob. Waiting for the first bytes.",
              }
            : current,
        );
      }, 15000);

      const blob = await upload(
        `${userId}/${recordingId}/${safeFileName(fileName)}`,
        file,
        {
          access: "private",
          contentType,
          handleUploadUrl: "/api/recordings/blob",
          multipart: file.size >= MULTIPART_UPLOAD_THRESHOLD_BYTES,
          onUploadProgress: (event) => {
            const progress = getUploadProgress(event, file.size, startedAt);

            if (progress.loaded > 0 && noProgressTimeoutId) {
              window.clearTimeout(noProgressTimeoutId);
              noProgressTimeoutId = null;
            }

            setUploadState((current) =>
              current
                ? {
                    ...current,
                    ...progress,
                    message: "Uploading to Willow Songs",
                    stage: "uploading",
                  }
                : current,
            );
          },
        },
      );
      setUploadState((current) =>
        current
          ? {
              ...current,
              etaSeconds: null,
              loaded: current.total,
              message: "Upload complete. Transcribing and writing notes.",
              percentage: 100,
              stage: "processing",
            }
          : current,
      );

      const analysis = await analyzeAudio(file);
      const optimisticRecording = createOptimisticRecording({
        analysis,
        file,
        recordingId,
        title: stripExtension(fileName),
        userId,
      });

      setRecordings((current) => [
        optimisticRecording,
        ...current.filter((recording) => recording.id !== optimisticRecording.id),
      ]);
      setActiveId(optimisticRecording.id);
      setMobileDetailOpen(true);

      const response = await fetch("/api/recordings", {
        body: JSON.stringify({
          blob_pathname: blob.pathname,
          duration_seconds: analysis.durationSeconds,
          file_name: fileName || null,
          mime_type: contentType,
          recording_id: recordingId,
          title: stripExtension(fileName),
          waveform_peaks: analysis.peaks,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await readJsonResponse<{
        error?: string;
        recording?: Recording;
      }>(response);

      if (payload.recording) {
        setRecordings((current) => [
          payload.recording!,
          ...current.filter((recording) => recording.id !== payload.recording!.id),
        ]);
        setActiveId(payload.recording.id);
        setMobileDetailOpen(true);
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "Upload failed.");
      }

      if (!payload.recording) {
        throw new Error("Upload finished, but the recording was not returned.");
      }

      setUploadState((current) =>
        current
          ? {
              ...current,
              etaSeconds: null,
              message: "Notes are ready.",
              percentage: 100,
              stage: "complete",
            }
          : current,
      );
      window.setTimeout(() => {
        setUploadState((current) =>
          current?.stage === "complete" ? null : current,
        );
      }, 2400);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      setUploadError(message);
      setUploadState((current) =>
        current
          ? {
              ...current,
              etaSeconds: null,
              message,
              stage: "error",
            }
          : current,
      );
    } finally {
      if (noProgressTimeoutId) {
        window.clearTimeout(noProgressTimeoutId);
      }

      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handleDragEnter(event: React.DragEvent<HTMLElement>) {
    if (!hasFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setDraggingFile(true);
  }

  function handleDragOver(event: React.DragEvent<HTMLElement>) {
    if (!hasFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = uploading ? "none" : "copy";
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!hasFileDrag(event)) {
      return;
    }

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

    if (dragDepthRef.current === 0) {
      setDraggingFile(false);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    if (!hasFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = 0;
    setDraggingFile(false);

    const droppedFile =
      Array.from(event.dataTransfer.files).find(isSupportedMediaFile) ??
      event.dataTransfer.files[0];

    void handleUpload(droppedFile);
  }

  async function saveNotes() {
    if (!activeRecording) {
      return;
    }

    setSavingNotes(true);
    try {
      const response = await fetch(`/api/recordings/${activeRecording.id}/notes`, {
        body: JSON.stringify({ notes_markdown: notesDraft }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = await readJsonResponse<{
        error?: string;
        recording?: Recording;
      }>(response);

      if (!response.ok || !payload.recording) {
        throw new Error(payload.error ?? "Unable to save notes.");
      }

      setRecordings((current) =>
        current.map((recording) =>
          recording.id === payload.recording!.id ? payload.recording! : recording,
        ),
      );
      setEditingNotes(false);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Unable to save notes.");
    } finally {
      setSavingNotes(false);
    }
  }

  async function askQuestion() {
    if (!activeRecording || !chatQuestion.trim()) {
      return;
    }

    const question = chatQuestion.trim();
    setChatQuestion("");
    setChatLoading(true);
    setChatMessages((current) => [
      ...current,
      { content: question, id: crypto.randomUUID(), role: "user" },
    ]);

    try {
      const response = await fetch(`/api/recordings/${activeRecording.id}/chat`, {
        body: JSON.stringify({ question }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await readJsonResponse<{ answer?: string; error?: string }>(
        response,
      );

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to answer.");
      }

      setChatMessages((current) => [
        ...current,
        {
          content: payload.answer ?? "I could not answer that yet.",
          id: crypto.randomUUID(),
          role: "assistant",
        },
      ]);
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        {
          content:
            error instanceof Error ? error.message : "Unable to answer that question.",
          id: crypto.randomUUID(),
          role: "assistant",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  function chooseRecording(recording: Recording) {
    setActiveId(recording.id);
    setMobileDetailOpen(true);
  }

  function playAnnotation(annotation: LessonAnnotation) {
    setActiveAnnotation(annotation);

    if (audioRef.current) {
      audioRef.current.currentTime = annotation.start_seconds;
      void audioRef.current.play();
    }
  }

  function togglePlay() {
    if (!audioRef.current) {
      return;
    }

    if (audioRef.current.paused) {
      void audioRef.current.play();
    } else {
      audioRef.current.pause();
    }
  }

  return (
    <main
      className="relative min-h-screen bg-[#0c0c0b] text-white"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {draggingFile && <DropOverlay uploading={uploading} />}
      <div className="mx-auto flex min-h-screen w-full max-w-[1560px] flex-col px-3 py-3 sm:px-4 lg:px-6">
        <header className="rounded-lg border border-[#1f2228] bg-[#111214]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 lg:px-5">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#0c0c0b]">
                <Waves aria-hidden="true" size={22} />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-xs text-[#7d8187]">Willow Songs</p>
                <h1 className="truncate text-xl font-medium leading-tight sm:text-2xl">
                  Song lesson workspace
                </h1>
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-2">
              <label className="hidden h-10 min-w-56 max-w-sm flex-1 items-center gap-2 rounded-full border border-[#1f2228] bg-[#0c0c0b] px-4 text-sm text-[#7d8187] md:flex">
                <Search aria-hidden="true" size={17} />
                <span className="truncate">Titles, notes, transcripts</span>
              </label>
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept="audio/*,video/mp4,video/quicktime,video/x-m4v"
                onChange={(event) => void handleUpload(event.target.files?.[0])}
              />
              <button
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="flex h-10 items-center gap-2 rounded-full border border-white/15 bg-white px-4 text-sm font-medium text-[#0c0c0b] transition hover:bg-white/90 disabled:opacity-60"
              >
                {uploading ? (
                  <Loader2 aria-hidden="true" size={17} className="animate-spin" />
                ) : (
                  <Upload aria-hidden="true" size={17} />
                )}
                <span className="hidden sm:inline">
                  {uploading && uploadState?.stage === "uploading"
                    ? `${Math.round(uploadState.percentage)}%`
                    : uploading
                      ? "Working"
                      : "Upload"}
                </span>
              </button>
              <form action="/auth/sign-out" method="post">
                <button
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-[#1f2228] bg-[#0c0c0b] text-white transition hover:border-white/25"
                  aria-label={`Signed in as ${userEmail}. Sign out`}
                  title={`Signed in as ${userEmail}. Sign out`}
                >
                  <UserRound aria-hidden="true" size={18} />
                </button>
              </form>
            </div>
          </div>
        </header>

        {uploadState && <UploadProgressPanel upload={uploadState} />}

        {uploadError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#2563eb]/60 bg-[#151923] px-4 py-3 text-sm leading-6 text-white">
            <AlertCircle aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
            <p className="flex-1">{uploadError}</p>
            <button onClick={() => setUploadError(null)} aria-label="Dismiss">
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        )}

        <section className="grid flex-1 gap-3 py-4 lg:grid-cols-[330px_minmax(0,1fr)] lg:py-5">
          <div className={mobileDetailOpen ? "hidden lg:block" : "block"}>
            <RecordingList
              activeId={activeRecording?.id ?? null}
              recordings={recordings}
              uploading={uploading}
              onSelect={chooseRecording}
              onUpload={() => fileInputRef.current?.click()}
            />
          </div>

          <div className={mobileDetailOpen ? "block" : "hidden lg:block"}>
            {activeRecording ? (
              <LessonDetail
                activeAnnotation={activeAnnotation}
                chatLoading={chatLoading}
                chatMessages={chatMessages}
                chatOpen={chatOpen}
                chatQuestion={chatQuestion}
                editingNotes={editingNotes}
                notesDraft={notesDraft}
                playing={playing}
                recording={activeRecording}
                savingNotes={savingNotes}
                audioRef={audioRef}
                onAsk={askQuestion}
                onBack={() => setMobileDetailOpen(false)}
                onChangeChatQuestion={setChatQuestion}
                onChangeNotes={setNotesDraft}
                onCloseChat={() => setChatOpen(false)}
                onEditNotes={() => setEditingNotes(true)}
                onPlayAnnotation={playAnnotation}
                onSaveNotes={saveNotes}
                onSetPlaying={setPlaying}
                onToggleChat={() => setChatOpen((value) => !value)}
                onTogglePlay={togglePlay}
              />
            ) : (
              <EmptyState onUpload={() => fileInputRef.current?.click()} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function RecordingList({
  activeId,
  recordings,
  uploading,
  onSelect,
  onUpload,
}: {
  activeId: string | null;
  recordings: Recording[];
  uploading: boolean;
  onSelect: (recording: Recording) => void;
  onUpload: () => void;
}) {
  return (
    <aside className="overflow-hidden rounded-lg border border-[#1f2228] bg-[#111214]">
      <div className="flex items-center justify-between border-b border-[#1f2228] px-4 py-4">
        <div>
          <h2 className="text-lg font-medium">Songs</h2>
          <p className="text-sm text-[#7d8187]">
            {recordings.length} lesson {recordings.length === 1 ? "recording" : "recordings"}
          </p>
        </div>
        <button
          onClick={onUpload}
          disabled={uploading}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white text-[#0c0c0b] transition hover:bg-white/90 disabled:opacity-60"
          aria-label="Upload recording"
          title="Upload recording"
        >
          {uploading ? (
            <Loader2 aria-hidden="true" size={18} className="animate-spin" />
          ) : (
            <Plus aria-hidden="true" size={18} />
          )}
        </button>
      </div>

      {recordings.length === 0 ? (
        <div className="p-4">
          <button
            onClick={onUpload}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#1f2228] px-4 py-10 text-sm text-[#a8abb0] transition hover:border-white/25 hover:text-white"
          >
            <Upload aria-hidden="true" size={18} />
            Upload your first lesson
          </button>
        </div>
      ) : (
        <div className="divide-y divide-white/10">
          {recordings.map((recording) => {
            const isSelected = recording.id === activeId;

            return (
              <button
                key={recording.id}
                onClick={() => onSelect(recording)}
                className={`w-full px-4 py-4 text-left transition ${
                  isSelected
                    ? "bg-[#2563eb] text-white"
                    : "bg-transparent text-white hover:bg-white/[0.04]"
                }`}
              >
                <span className="flex items-center gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${
                      isSelected
                        ? "border-white/25 bg-white/15"
                        : "border-[#1f2228] bg-[#0c0c0b]"
                    }`}
                  >
                    {recording.status === "processing" ? (
                      <Loader2 aria-hidden="true" size={18} className="animate-spin" />
                    ) : (
                      <FileAudio aria-hidden="true" size={18} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{recording.title}</span>
                    <span
                      className={`block truncate text-sm ${
                        isSelected ? "text-white/75" : "text-[#7d8187]"
                      }`}
                    >
                      {recording.status === "error"
                        ? "Processing failed"
                        : recording.status === "processing"
                          ? "Transcribing and writing notes"
                          : recording.file_name ?? "Lesson recording"}
                    </span>
                  </span>
                  <span
                    className={`font-mono text-xs ${
                      isSelected ? "text-white/75" : "text-[#7d8187]"
                    }`}
                  >
                    {secondsToTimestamp(recording.duration_seconds)}
                  </span>
                </span>
                <span
                  className={`mt-3 flex items-center justify-between text-xs ${
                    isSelected ? "text-white/75" : "text-[#7d8187]"
                  }`}
                >
                  <span>{formatDate(recording.created_at)}</span>
                  <span>{recording.annotations.length} notes</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function DropOverlay({ uploading }: { uploading: boolean }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[#0c0c0b]/72 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-dashed border-[#2563eb] bg-[#111214] p-6 text-center shadow-2xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-[#2563eb]/50 bg-[#151923]">
          <Upload aria-hidden="true" size={24} />
        </div>
        <h2 className="mt-4 text-xl font-medium">
          {uploading ? "Upload already running" : "Drop recording"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#a8abb0]">
          {uploading
            ? "Let the current file finish before adding another lesson."
            : "Release to upload this lesson into Willow Songs."}
        </p>
      </div>
    </div>
  );
}

function UploadProgressPanel({ upload }: { upload: UploadState }) {
  const percentage =
    upload.stage === "processing" || upload.stage === "complete"
      ? 100
      : Math.max(0, Math.min(100, upload.percentage));
  const statusLabel = getUploadStageLabel(upload.stage);
  const progressDetail =
    upload.stage === "uploading"
      ? `${formatBytes(upload.loaded)} of ${formatBytes(upload.total || upload.fileSize)}`
      : upload.message;

  return (
    <section
      className="mt-3 rounded-lg border border-[#1f2228] bg-[#111214] px-4 py-4"
      aria-live="polite"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${
              upload.stage === "error"
                ? "border-[#2563eb]/60 bg-[#151923]"
                : "border-white/10 bg-[#0c0c0b]"
            }`}
          >
            {upload.stage === "complete" ? (
              <CheckCircle2 aria-hidden="true" size={20} className="text-[#2563eb]" />
            ) : upload.stage === "error" ? (
              <AlertCircle aria-hidden="true" size={20} />
            ) : (
              <Upload aria-hidden="true" size={20} />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-white">{upload.fileName}</p>
            <p className="mt-1 text-sm text-[#7d8187]">
              {statusLabel} / {progressDetail}
            </p>
          </div>
        </div>

        <div className="min-w-0 lg:w-[420px]">
          <div className="h-2 overflow-hidden rounded-full bg-[#1f2228]">
            <div
              className={`h-full rounded-full bg-[#2563eb] transition-[width] duration-300 ${
                upload.stage === "processing" ? "animate-pulse" : ""
              }`}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-xs text-[#7d8187]">
            <span>{Math.round(percentage)}%</span>
            <span>{formatUploadRate(upload.speedBps)}</span>
            <span>{formatEta(upload.etaSeconds)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function LessonDetail({
  activeAnnotation,
  audioRef,
  chatLoading,
  chatMessages,
  chatOpen,
  chatQuestion,
  editingNotes,
  notesDraft,
  onAsk,
  onBack,
  onChangeChatQuestion,
  onChangeNotes,
  onCloseChat,
  onEditNotes,
  onPlayAnnotation,
  onSaveNotes,
  onSetPlaying,
  onToggleChat,
  onTogglePlay,
  playing,
  recording,
  savingNotes,
}: {
  activeAnnotation: LessonAnnotation | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  chatLoading: boolean;
  chatMessages: ChatMessage[];
  chatOpen: boolean;
  chatQuestion: string;
  editingNotes: boolean;
  notesDraft: string;
  onAsk: () => void;
  onBack: () => void;
  onChangeChatQuestion: (value: string) => void;
  onChangeNotes: (value: string) => void;
  onCloseChat: () => void;
  onEditNotes: () => void;
  onPlayAnnotation: (annotation: LessonAnnotation) => void;
  onSaveNotes: () => void;
  onSetPlaying: (playing: boolean) => void;
  onToggleChat: () => void;
  onTogglePlay: () => void;
  playing: boolean;
  recording: Recording;
  savingNotes: boolean;
}) {
  const duration =
    recording.duration_seconds ||
    Math.max(...recording.annotations.map((annotation) => annotation.end_seconds), 1);
  const peaks = recording.waveform_peaks.length ? recording.waveform_peaks : fallbackPeaks();
  const ready = recording.status === "ready";

  return (
    <section className="relative min-h-[720px] overflow-hidden rounded-lg border border-[#1f2228] bg-[#111214]">
      <div className="border-b border-[#1f2228] bg-[#0c0c0b] px-3 py-3 lg:hidden">
        <button
          onClick={onBack}
          className="flex h-10 items-center gap-2 rounded-full border border-[#1f2228] bg-[#111214] px-4 text-sm font-medium text-white"
        >
          <ArrowLeft aria-hidden="true" size={16} />
          Songs
        </button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#1f2228] px-3 py-4 sm:px-4 lg:px-5">
        <div className="min-w-0">
          <p className="font-mono text-xs text-[#7d8187]">
            {formatDate(recording.created_at)} / {secondsToTimestamp(recording.duration_seconds)}
          </p>
          <h2 className="mt-2 truncate text-2xl font-medium leading-tight sm:text-3xl">
            {recording.title}
          </h2>
          <p className="mt-1 text-sm text-[#7d8187]">
            {recording.status === "processing"
              ? "Transcribing audio and generating lesson notes."
              : recording.status === "error"
                ? recording.error_message ?? "Processing failed."
                : "Transcript, notes, and generated hot timestamps are ready."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={recording.status} />
          <button
            onClick={onToggleChat}
            disabled={!ready}
            className="flex h-10 items-center gap-2 rounded-full border border-[#1f2228] bg-[#0c0c0b] px-4 text-sm font-medium text-white transition hover:border-white/25 disabled:opacity-40"
          >
            <MessageCircle aria-hidden="true" size={17} />
            Ask
          </button>
        </div>
      </div>

      <div className="space-y-4 px-3 pb-4 sm:px-4 lg:px-5">
        <section className="mt-4 overflow-hidden rounded-lg border border-[#1f2228] bg-[#0c0c0b]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-mono text-xs text-[#7d8187]">Waveform</p>
              <h3 className="text-lg font-medium">Annotated lesson audio</h3>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-[#1f2228] px-3 py-2 text-sm text-[#7d8187]">
              <span className="h-2 w-2 rounded-full bg-[#2563eb]" />
              {activeAnnotation
                ? `${secondsToTimestamp(activeAnnotation.start_seconds)} / ${activeAnnotation.title}`
                : "No annotation selected"}
            </div>
          </div>

          <div className="relative h-[320px] overflow-hidden border-y border-[#1f2228] bg-[#2f3033] sm:h-[380px]">
            <div className="absolute inset-x-3 top-10 bottom-16 flex items-center gap-[3px]">
              {peaks.map((peak, index) => (
                <span
                  key={`${peak}-${index}`}
                  className="block flex-1 rounded-full bg-white/80"
                  style={{ height: `${Math.max(12, Math.min(96, peak * 100))}%` }}
                />
              ))}
            </div>

            {recording.annotations.map((annotation) => {
              const isSelected = annotation.id === activeAnnotation?.id;
              const left = Math.max(0, (annotation.start_seconds / duration) * 100);
              const width = Math.max(
                1.5,
                ((annotation.end_seconds - annotation.start_seconds) / duration) * 100,
              );

              return (
                <button
                  key={annotation.id}
                  type="button"
                  onClick={() => onPlayAnnotation(annotation)}
                  className={`absolute top-0 h-full border-x transition ${
                    isSelected
                      ? "border-[#2563eb] bg-[#2563eb]/15"
                      : "border-transparent bg-white/[0.03] hover:border-[#2563eb]/70 hover:bg-[#2563eb]/10"
                  }`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  aria-label={`Play ${annotation.title}`}
                  title={`${secondsToTimestamp(annotation.start_seconds)} / ${annotation.title}`}
                >
                  <span
                    className={`absolute left-1/2 top-5 hidden -translate-x-1/2 whitespace-nowrap rounded-full border px-2 py-1 text-xs sm:block ${
                      isSelected
                        ? "border-[#2563eb] bg-[#0c0c0b] text-white"
                        : "border-white/10 bg-[#111214] text-[#7d8187]"
                    }`}
                  >
                    {annotation.title}
                  </span>
                </button>
              );
            })}

            <div className="absolute inset-x-0 bottom-0 flex justify-between border-t border-white/10 bg-[#111214]/85 px-4 py-3 font-mono text-xs text-[#7d8187]">
              <span>0:00</span>
              <span>{secondsToTimestamp(duration / 3)}</span>
              <span>{secondsToTimestamp((duration / 3) * 2)}</span>
              <span>{secondsToTimestamp(duration)}</span>
            </div>
          </div>

          <div className="space-y-4 px-4 py-4">
            <audio
              ref={audioRef}
              src={`/api/recordings/${recording.id}/audio`}
              preload="metadata"
              onPause={() => onSetPlaying(false)}
              onPlay={() => onSetPlaying(true)}
            />
            <div className="relative h-14 overflow-hidden rounded-lg bg-[#1f2228]">
              <div className="absolute inset-x-3 top-2 bottom-2 flex items-center gap-[2px]">
                {peaks.slice(0, 96).map((peak, index) => (
                  <span
                    key={`mini-${peak}-${index}`}
                    className="block flex-1 rounded-full bg-white/45"
                    style={{ height: `${Math.max(12, Math.min(80, peak * 65))}%` }}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#1f2228] bg-[#0c0c0b] px-4 py-3">
              <div>
                <p className="font-mono text-xs text-[#7d8187]">Current reference</p>
                <p className="mt-1 text-sm text-white">
                  {activeAnnotation
                    ? `${secondsToTimestamp(activeAnnotation.start_seconds)} / ${activeAnnotation.summary}`
                    : "Select a generated section to replay it."}
                </p>
              </div>
              <button
                onClick={onTogglePlay}
                disabled={recording.status === "processing"}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-[#0c0c0b] transition hover:bg-white/90 disabled:opacity-50"
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? (
                  <Pause aria-hidden="true" size={22} />
                ) : (
                  <Play aria-hidden="true" size={22} fill="currentColor" />
                )}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-[#1f2228] bg-[#0c0c0b] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-xs text-[#7d8187]">Hot timestamps</p>
              <h3 className="text-lg font-medium">Generated sections</h3>
            </div>
            <span className="hidden text-sm text-[#7d8187] sm:inline">
              From lesson notes
            </span>
          </div>
          <div className="grid gap-2 xl:grid-cols-3">
            {recording.annotations.length ? (
              recording.annotations.map((annotation) => (
                <button
                  key={annotation.id}
                  onClick={() => onPlayAnnotation(annotation)}
                  className={`rounded-lg border p-3 text-left transition ${
                    annotation.id === activeAnnotation?.id
                      ? "border-[#2563eb] bg-[#151923]"
                      : "border-[#1f2228] bg-[#111214] hover:border-white/20"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{annotation.title}</span>
                    <span className="font-mono text-xs text-[#7d8187]">
                      {secondsToTimestamp(annotation.start_seconds)}
                    </span>
                  </span>
                  <span className="mt-2 block text-sm leading-6 text-[#7d8187]">
                    {annotation.summary}
                  </span>
                </button>
              ))
            ) : (
              <p className="rounded-lg border border-[#1f2228] bg-[#111214] p-4 text-sm text-[#7d8187] xl:col-span-3">
                Generated sections will appear after transcription finishes.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-[#1f2228] bg-[#0c0c0b]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#1f2228] px-4 py-4">
            <div>
              <p className="font-mono text-xs text-[#7d8187]">Lesson notes</p>
              <h3 className="mt-1 text-xl font-medium">What to work on this week</h3>
            </div>
            {editingNotes ? (
              <button
                onClick={onSaveNotes}
                disabled={savingNotes}
                className="flex h-9 items-center gap-2 rounded-full border border-white/15 bg-white px-3 text-sm font-medium text-[#0c0c0b] transition hover:bg-white/90 disabled:opacity-60"
              >
                {savingNotes ? (
                  <Loader2 aria-hidden="true" size={15} className="animate-spin" />
                ) : (
                  <Save aria-hidden="true" size={15} />
                )}
                Save
              </button>
            ) : (
              <button
                onClick={onEditNotes}
                disabled={!ready}
                className="flex h-9 items-center gap-2 rounded-full border border-[#1f2228] px-3 text-sm font-medium text-white transition hover:border-white/25 disabled:opacity-40"
              >
                <Pencil aria-hidden="true" size={15} />
                Edit
              </button>
            )}
          </div>

          {editingNotes ? (
            <textarea
              value={notesDraft}
              onChange={(event) => onChangeNotes(event.target.value)}
              className="min-h-[520px] w-full resize-y bg-[#0c0c0b] p-4 font-mono text-sm leading-7 text-white outline-none placeholder:text-[#7d8187]"
              placeholder="Generated notes will appear here."
            />
          ) : (
            <NotesView recording={recording} />
          )}
        </section>
      </div>

      <ChatPanel
        loading={chatLoading}
        messages={chatMessages}
        open={chatOpen}
        question={chatQuestion}
        onAsk={onAsk}
        onChangeQuestion={onChangeChatQuestion}
        onClose={onCloseChat}
      />
    </section>
  );
}

function NotesView({ recording }: { recording: Recording }) {
  const notes = recording.notes_json;

  if (recording.status === "processing") {
    return (
      <div className="flex min-h-[360px] items-center justify-center p-6 text-center text-[#7d8187]">
        <div>
          <Loader2 aria-hidden="true" className="mx-auto animate-spin" size={28} />
          <p className="mt-4 text-sm">Generating notes from the transcript.</p>
        </div>
      </div>
    );
  }

  if (!notes) {
    return (
      <div className="p-4 text-sm leading-6 text-[#7d8187]">
        {recording.error_message ?? "No notes are available yet."}
      </div>
    );
  }

  return (
    <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4 p-4">
        <div className="rounded-lg border border-[#1f2228] bg-[#111214] p-4">
          <p className="font-mono text-xs text-[#7d8187]">Overall note</p>
          <p className="mt-2 text-base leading-7 text-white">{notes.overall_note}</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {notes.sections.map((section, index) => (
            <article
              key={`${section.title}-${index}`}
              className="rounded-lg border border-[#1f2228] bg-[#111214] p-4"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#2563eb]/60 bg-[#2563eb]/10 font-mono text-xs text-white">
                  {index + 1}
                </span>
                <div>
                  <h4 className="font-medium text-white">{section.title}</h4>
                  <p className="mt-2 text-sm leading-6 text-[#c6c8cc]">
                    {section.body}
                  </p>
                  <p className="mt-3 rounded-lg border border-[#1f2228] bg-[#0c0c0b] px-3 py-2 text-sm leading-6 text-white">
                    {section.cue}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <aside className="border-t border-[#1f2228] p-4 xl:border-l xl:border-t-0">
        <div className="rounded-lg border border-[#1f2228] bg-[#111214] p-4">
          <p className="font-mono text-xs text-[#7d8187]">Practice stack</p>
          <div className="mt-4 space-y-3">
            {notes.practice_steps.map((step) => (
              <div key={`${step.duration}-${step.task}`} className="grid grid-cols-[52px_minmax(0,1fr)] gap-3">
                <span className="font-mono text-xs text-[#7d8187]">
                  {step.duration}
                </span>
                <span className="text-sm leading-6 text-white">{step.task}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-[#2563eb]/60 bg-[#151923] p-4">
          <p className="font-mono text-xs text-[#7d8187]">Listen here</p>
          <div className="mt-2 space-y-3 text-sm leading-6 text-white">
            {notes.listen_references.map((reference) => (
              <p key={`${reference.time_seconds}-${reference.reason}`}>
                <span className="font-mono text-[#7d8187]">
                  {secondsToTimestamp(reference.time_seconds)}
                </span>{" "}
                {reference.reason}
              </p>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function ChatPanel({
  loading,
  messages,
  onAsk,
  onChangeQuestion,
  onClose,
  open,
  question,
}: {
  loading: boolean;
  messages: ChatMessage[];
  onAsk: () => void;
  onChangeQuestion: (value: string) => void;
  onClose: () => void;
  open: boolean;
  question: string;
}) {
  return (
    <aside
      className={`absolute inset-y-0 right-0 z-20 flex w-full max-w-[420px] flex-col border-l border-[#1f2228] bg-[#0c0c0b] transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between border-b border-[#1f2228] px-4 py-4">
        <div>
          <p className="font-mono text-xs text-[#7d8187]">Transcript chat</p>
          <h3 className="text-lg font-medium">Ask about the lesson</h3>
        </div>
        <button
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[#1f2228] text-white"
          aria-label="Close chat"
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>

      {open ? (
        <>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="rounded-lg border border-[#1f2228] bg-[#111214] p-3 text-sm leading-6 text-[#c6c8cc]">
                Ask what to replay, how to practice a section, or what the
                teacher meant by a cue.
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-lg border p-3 text-sm leading-6 ${
                  message.role === "assistant"
                    ? "border-[#2563eb]/50 bg-[#151923] text-white"
                    : "border-[#1f2228] bg-[#111214] text-white"
                }`}
              >
                {message.content}
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-sm text-[#7d8187]">
                <Loader2 aria-hidden="true" size={15} className="animate-spin" />
                Reading transcript
              </div>
            )}
          </div>
          <div className="border-t border-[#1f2228] p-3">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onAsk();
              }}
              className="flex min-h-12 items-center gap-2 rounded-full border border-[#1f2228] bg-[#0c0c0b] px-4 text-sm text-[#7d8187] focus-within:border-[#2563eb]"
            >
              <input
                value={question}
                onChange={(event) => onChangeQuestion(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-[#7d8187]"
                placeholder="Ask about this lesson"
              />
              <button disabled={loading || !question.trim()} aria-label="Send">
                <Send aria-hidden="true" size={16} className="text-white" />
              </button>
            </form>
          </div>
        </>
      ) : (
        <div className="flex-1" />
      )}
    </aside>
  );
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <section className="flex min-h-[720px] items-center justify-center rounded-lg border border-[#1f2228] bg-[#111214] p-6 text-center">
      <div className="max-w-md">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-[#1f2228] bg-[#0c0c0b]">
          <Waves aria-hidden="true" size={24} />
        </div>
        <h2 className="mt-5 text-2xl font-medium">Upload a lesson recording</h2>
        <p className="mt-3 text-sm leading-6 text-[#7d8187]">
          Willow Songs will transcribe it, generate notes, and turn lesson
          sections into clickable waveform markers.
        </p>
        <button
          onClick={onUpload}
          className="mt-6 flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-[#0c0c0b]"
        >
          <Upload aria-hidden="true" size={17} />
          Upload recording
        </button>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: Recording["status"] }) {
  if (status === "processing") {
    return (
      <span className="flex h-10 items-center gap-2 rounded-full border border-[#1f2228] bg-[#0c0c0b] px-3 text-sm text-[#7d8187]">
        <Loader2 aria-hidden="true" size={15} className="animate-spin" />
        Processing
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="flex h-10 items-center gap-2 rounded-full border border-[#2563eb]/60 bg-[#151923] px-3 text-sm text-white">
        <AlertCircle aria-hidden="true" size={15} />
        Error
      </span>
    );
  }

  return (
    <span className="flex h-10 items-center gap-2 rounded-full border border-[#1f2228] bg-[#0c0c0b] px-3 text-sm text-[#7d8187]">
      <CheckCircle2 aria-hidden="true" size={15} className="text-[#2563eb]" />
      Ready
    </span>
  );
}

async function analyzeAudio(file: File): Promise<{
  durationSeconds: number | null;
  peaks: number[];
}> {
  if (typeof window === "undefined") {
    return { durationSeconds: null, peaks: fallbackPeaks() };
  }

  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const finish = (durationSeconds: number | null) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(objectUrl);
      resolve({
        durationSeconds,
        peaks: fallbackPeaks(),
      });
    };

    const timeoutId = window.setTimeout(() => finish(null), 3000);

    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      finish(Number.isFinite(audio.duration) ? audio.duration : null);
    };
    audio.onerror = () => finish(null);
    audio.src = objectUrl;
  });
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, "") || "Untitled lesson";
}

function safeFileName(fileName: string) {
  const cleaned = fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned || "recording";
}

function getMediaContentType(file: File) {
  const type = file.type.trim().toLowerCase();

  if (type && type !== "application/octet-stream") {
    return type;
  }

  const extension = file.name.toLowerCase().split(".").pop();
  const contentTypes: Record<string, string> = {
    aac: "audio/aac",
    aif: "audio/aiff",
    aiff: "audio/aiff",
    flac: "audio/flac",
    m4a: "audio/mp4",
    m4v: "video/x-m4v",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    wav: "audio/wav",
    webm: "audio/webm",
  };

  return extension
    ? (contentTypes[extension] ?? "application/octet-stream")
    : "application/octet-stream";
}

function createOptimisticRecording({
  analysis,
  file,
  recordingId,
  title,
  userId,
}: {
  analysis: { durationSeconds: number | null; peaks: number[] };
  file: File;
  recordingId: string;
  title: string;
  userId: string;
}): Recording {
  const now = new Date().toISOString();

  return {
    annotations: [],
    created_at: now,
    duration_seconds: analysis.durationSeconds,
    error_message: null,
    file_name: file.name || null,
    id: recordingId,
    mime_type: file.type || null,
    notes_json: null,
    notes_markdown: null,
    status: "processing",
    title: title || "Untitled lesson",
    transcript_segments: [],
    transcript_text: null,
    transcript_words: [],
    updated_at: now,
    user_id: userId,
    waveform_peaks: analysis.peaks,
  };
}

function getUploadProgress(
  event: { loaded?: number; percentage?: number; total?: number },
  fileSize: number,
  startedAt: number,
) {
  const total = event.total && event.total > 0 ? event.total : fileSize;
  const loaded =
    event.loaded ??
    Math.round(((event.percentage ?? 0) / 100) * Math.max(total, fileSize));
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.25);
  const speedBps = loaded > 0 ? loaded / elapsedSeconds : null;
  const etaSeconds =
    speedBps && total > loaded ? Math.max(0, (total - loaded) / speedBps) : null;

  return {
    etaSeconds,
    loaded,
    percentage:
      event.percentage ??
      (total > 0 ? Number(((loaded / total) * 100).toFixed(2)) : 0),
    speedBps,
    total,
  };
}

function hasFileDrag(event: React.DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function isSupportedMediaFile(file: File) {
  const type = getMediaContentType(file);
  const name = file.name.toLowerCase();

  return (
    type.startsWith("audio/") ||
    ["video/mp4", "video/quicktime", "video/x-m4v"].includes(type) ||
    /\.(aac|aif|aiff|flac|m4a|m4v|mp3|mp4|ogg|opus|wav|webm)$/.test(name)
  );
}

function getUploadStageLabel(stage: UploadStage) {
  switch (stage) {
    case "preparing":
      return "Preparing";
    case "uploading":
      return "Uploading";
    case "processing":
      return "Transcribing";
    case "complete":
      return "Ready";
    case "error":
      return "Needs attention";
  }
}

function formatUploadRate(speedBps: number | null) {
  if (!speedBps || !Number.isFinite(speedBps)) {
    return "calculating";
  }

  return `${formatBytes(speedBps)}/s`;
}

function formatEta(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) {
    return "estimating";
  }

  if (seconds <= 1) {
    return "finishing";
  }

  if (seconds < 60) {
    return `${Math.ceil(seconds)}s left`;
  }

  return `${Math.ceil(seconds / 60)}m left`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  const precision = value >= 10 || exponent === 0 ? 0 : 1;

  return `${value.toFixed(precision)} ${units[exponent]}`;
}

async function readJsonResponse<T extends { error?: string }>(
  response: Response,
): Promise<T> {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {
      error: text.slice(0, 300) || response.statusText || "Request failed.",
    } as T;
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
