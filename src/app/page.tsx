import { redirect } from "next/navigation";

import { SongsApp } from "@/components/songs-app";
import { listRecordingsForUser } from "@/lib/db";
import { hasDatabaseConfig, hasSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const missingConfig = [
    !hasSupabaseConfig() ? "Supabase Auth env" : null,
    !hasDatabaseConfig() ? "Neon DATABASE_URL" : null,
  ].filter(Boolean);

  if (missingConfig.length) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0c0c0b] px-4 text-white">
        <section className="max-w-xl rounded-lg border border-[#1f2228] bg-[#111214] p-6">
          <p className="font-mono text-xs text-[#7d8187]">Setup needed</p>
          <h1 className="mt-2 text-2xl font-medium">Environment is missing</h1>
          <p className="mt-3 text-sm leading-6 text-[#a8abb0]">
            Add {missingConfig.join(" and ")} to run the app.
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

  const recordings = await listRecordingsForUser(user.id);

  return (
    <SongsApp
      initialRecordings={recordings}
      userEmail={user.email ?? "account"}
    />
  );
}
