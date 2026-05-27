import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAppOrigin, hasSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

async function signInWithGoogle() {
  "use server";

  const requestHeaders = await headers();
  const origin = getAppOrigin(requestHeaders.get("origin") ?? undefined);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    options: {
      redirectTo: `${origin}/auth/callback`,
    },
    provider: "google",
  });

  if (error || !data.url) {
    redirect("/login?error=oauth");
  }

  redirect(data.url);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!hasSupabaseConfig()) {
    return <MissingConfig />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0c0c0b] px-4 py-8 text-white">
      <section className="grid w-full max-w-5xl overflow-hidden rounded-lg border border-[#1f2228] bg-[#111214] lg:grid-cols-[1.1fr_0.9fr]">
        <div className="border-b border-[#1f2228] p-6 sm:p-8 lg:border-b-0 lg:border-r">
          <p className="font-mono text-xs text-[#7d8187]">Willow Songs</p>
          <h1 className="mt-3 text-4xl font-medium leading-tight">
            Turn every voice lesson into practice notes.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-[#a8abb0]">
            Upload a recording, get a transcript, review generated lesson notes,
            replay the hot timestamps, and ask questions when you need context.
          </p>
          <div className="mt-8 h-56 rounded-lg border border-[#1f2228] bg-[#2f3033] p-5">
            <div className="flex h-full items-center gap-[5px]">
              {Array.from({ length: 48 }, (_, index) => (
                <span
                  key={index}
                  className="block flex-1 rounded-full bg-white/70"
                  style={{
                    height: `${28 + Math.abs(Math.sin(index * 0.48)) * 62}%`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center p-6 sm:p-8">
          <h2 className="text-2xl font-medium">Sign in</h2>
          <p className="mt-2 text-sm leading-6 text-[#7d8187]">
            Google OAuth only. Your recordings and notes stay scoped to your
            account.
          </p>

          {params.error && (
            <p className="mt-5 rounded-lg border border-[#2563eb]/60 bg-[#151923] px-4 py-3 text-sm text-white">
              Sign-in did not complete. Try Google again.
            </p>
          )}

          <form action={signInWithGoogle} className="mt-6">
            <button className="flex h-12 w-full items-center justify-center rounded-full bg-white px-5 text-sm font-medium text-[#0c0c0b] transition hover:bg-white/90">
              Continue with Google
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function MissingConfig() {
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
