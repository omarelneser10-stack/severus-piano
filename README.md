# SEVERUS Piano Tool

A piano learning aid that reads sheet music and plays it back on an interactive 88-key virtual piano.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env
# Edit .env and add your Anthropic API key

# 3. Start dev server
npm run dev
```

## Usage

1. Upload a PDF or image of piano sheet music
2. Click "Extract Notes via AI" — the Claude Vision API parses all notes
3. Use the playback controls to play, pause, step through, or loop
4. Watch the piano keys light up in real time (green = right hand, blue = left hand)
5. Use [A] and [B] buttons to set loop points for practice

## Requirements

- Node.js 16+
- An Anthropic API key with access to `claude-sonnet-4-20250514`
- Modern browser with Web Audio API support
