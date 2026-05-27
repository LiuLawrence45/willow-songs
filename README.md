Willow Songs is a Next.js app for turning voice lesson recordings into
transcripts, notes, generated timestamp sections, and transcript chat.

## Setup

Required environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
ELEVENLABS_API_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```

The Supabase schema used by the app is saved in `supabase/schema.sql`. It
creates a private `recordings` storage bucket and an RLS-protected `recordings`
table.

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Flow

1. Sign in with Google through Supabase Auth.
2. Upload a lesson recording.
3. The API stores the audio in Supabase Storage, transcribes with ElevenLabs,
   generates notes and annotations with OpenAI, and saves everything per user.
4. The app renders a Voice Memos-style waveform with generated notes and
   secondary transcript chat.

## Verification

```bash
npm run lint
npm run build
```
