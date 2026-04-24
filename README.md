# SEVERUS Piano Tool

A piano learning aid that reads sheet music and plays it back on an interactive
88-key virtual piano.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env
# Edit .env and add your Anthropic API key (line is ANTHROPIC_API_KEY=...)

# 3. Start dev server
npm run dev
```

## Deploy (Vercel)

1. Push the repo to GitHub.
2. In Vercel → Project → Settings → **Environment Variables**, add:
   - `ANTHROPIC_API_KEY` = your key (Production, Preview, Development)
   - `BLOB_READ_WRITE_TOKEN` = auto-provisioned if you enable Vercel Blob
3. Redeploy.

**Important:** the Anthropic API key is a *server-only* variable. Do **not**
prefix it with `VITE_` — that would embed the key in the public JS bundle.
The `/api/parse-sheet` serverless function reads the key on the server and
proxies the model call, so the browser never sees it.

## Usage

1. Upload a PDF or image of piano sheet music.
2. Click "Extract Notes via AI" — the server calls Claude Vision and returns
   the parsed notes.
3. Use the playback controls to play, pause, step through, or loop.
4. Watch the piano keys light up in real time (green = right hand, blue = left).
5. Use [A] and [B] buttons to set loop points for practice.

## Requirements

- Node.js 18+
- An Anthropic API key
- Modern browser with Web Audio API support
