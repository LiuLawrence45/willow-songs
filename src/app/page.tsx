import { redirect } from "next/navigation";

import { SongsApp } from "@/components/songs-app";
import { hasSupabaseConfig } from "@/lib/env";
import { normalizeRecordings, RECORDING_SELECT } from "@/lib/recordings";
import { createClient } from "@/lib/supabase/server";
import type { RecordingRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!hasSupabaseConfig()) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0c0c0b] px-4 text-white">
        <section className="max-w-xl rounded-lg border border-[#1f2228] bg-[#111214] p-6">
          <p className="font-mono text-xs text-[#7d8187]">Setup needed</p>
          <h1 className="mt-2 text-2xl font-medium">Supabase env is missing</h1>
          <p className="mt-3 text-sm leading-6 text-[#a8abb0]">
            Add `NEXT_PUBLIC_SUPABASE_URL` and
            `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to run the app.
          </p>
        </section>
      </main>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("recordings")
    .select(RECORDING_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (
    <SongsApp
      initialRecordings={normalizeRecordings(data as RecordingRow[])}
      userEmail={user.email ?? "account"}
    />
  );
}
