Willow Songs is a Next.js app for turning voice lesson recordings into
transcripts, notes, generated timestamp sections, and transcript chat.

## Setup

Required environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
DATABASE_URL=
BLOB_READ_WRITE_TOKEN=
ELEVENLABS_API_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```

Supabase is used only for Google OAuth. Recording rows live in Neon Postgres,
using the schema in `db/schema.sql`. Audio files live in a private Vercel Blob
store.

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Flow

1. Sign in with Google through Supabase Auth.
2. Upload a lesson recording.
3. The API stores the audio in Vercel Blob, saves lesson metadata in Neon,
   transcribes with ElevenLabs, and generates notes and annotations with OpenAI.
4. The app renders a Voice Memos-style waveform with generated notes and
   secondary transcript chat.

## Verification

```bash
npm run lint
npm run build
```
