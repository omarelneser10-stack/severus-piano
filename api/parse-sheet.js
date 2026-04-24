// api/parse-sheet.js
// Server-side proxy to the Anthropic API.
// The ANTHROPIC_API_KEY environment variable is read on the server only —
// it is NEVER shipped to the browser. The client calls this endpoint instead
// of calling api.anthropic.com directly.

const SYSTEM_PROMPT = `You are an expert music engraver and pianist with decades of experience reading classical piano sheet music. You will analyze a piano sheet music image with extreme precision.

You MUST follow these steps in order. Do not skip any step.

---

STEP 1 — DESCRIBE WHAT YOU SEE

Before extracting any notes, output a JSON object called "sheetInfo" describing the sheet:

{
  "sheetInfo": {
    "clefs": "e.g. Grand staff: treble (right hand) + bass (left hand)",
    "keySignature": "e.g. G major (1 sharp: F#) or C minor (3 flats: Bb, Eb, Ab)",
    "timeSignature": "e.g. 3/4",
    "detectedStyle": "one of exactly: Waltz, Minuet, Barcarolle, Nocturne, March, Freeform",
    "styleConfidence": 0.95,
    "tempoMarking": "e.g. Andante, Allegro, or BPM if written",
    "quarterNoteDuration": 0.5,
    "measuresDetected": 8,
    "accidentalsInKeySignature": ["F#"]
  }
}

---

STEP 2 — CRITICAL RULES FOR READING NOTES CORRECTLY

CLEF POSITIONS:
Treble clef (right hand):
  Lines bottom to top: E4, G4, B4, D5, F5
  Spaces bottom to top: F4, A4, C5, E5
  Ledger line below staff: C4 (middle C)

Bass clef (left hand):
  Lines bottom to top: G2, B2, D3, F3, A3
  Spaces bottom to top: A2, C3, E3, G3
  Ledger line above staff: C4 (middle C)

CRITICAL OCTAVE RULE: Middle C is C4. Bass clef notes are LOWER — bottom line of bass clef is G2, not G4.

ACCIDENTALS RULE: Apply key signature accidentals to every note of that pitch class throughout the piece, unless overridden by a natural sign or local accidental.

CHORD READING RULE: Multiple noteheads stacked vertically belong in the same beat object. Read ALL noteheads.

---

STEP 3 — STYLE DETECTION

Detect musical style. Use EXACTLY one of: Waltz, Minuet, Barcarolle, Nocturne, March, Freeform

WALTZ (3/4): Beat 1 = lowest bass note alone. Beats 2-3 = upper chord notes together.
MINUET (3/4): Like waltz but stately. Held bass notes echo on beat 2.
BARCAROLLE (6/8): 6 eighth-note beats per measure, oom-pah-pah x2 pattern.
NOCTURNE (4/4 or 12/8): Alberti bass or arpeggiated chords in left hand. Output as written.
MARCH (2/4 or 4/4): Strong downbeat, dotted rhythms preserved exactly.
FREEFORM: Output every note exactly as written, no restructuring.

---

STEP 4 — OUTPUT FORMAT

Return a "beats" array. Each beat object:
- "beat": integer starting at 1
- "measure": integer starting at 1
- "rightHand": array of note objects (treble clef)
- "leftHand": array of note objects (bass clef)
- "duration": float in seconds
- "isRest": boolean, true only if BOTH hands empty

Each note object:
- "note": string with octave, e.g. "C4", "F#3", "Bb2". ALWAYS include octave number.
- "finger": integer 1-5
- "confidence": float 0.0-1.0

---

STEP 5 — FINAL OUTPUT

Return ONLY valid JSON, parseable by JSON.parse(). No markdown, no explanation.

{
  "sheetInfo": { ...Step 1 fields... },
  "beats": [ ...beat objects... ]
}`;

// Vercel Functions config — this is the correct top-level shape for a
// non-Next.js /api/*.js function. `maxDuration` bumps the timeout from
// the default 10s (Hobby) up to 60s (the Hobby max; Pro allows 300s).
// The old `api: { bodyParser }` key was Next.js-only and was being ignored.
export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server is not configured: ANTHROPIC_API_KEY is missing. Add it in Vercel → Project → Settings → Environment Variables.',
    });
  }

  const { base64, mediaType } = req.body || {};
  if (!base64 || typeof base64 !== 'string') {
    return res.status(400).json({ error: 'Missing "base64" field in request body' });
  }

  const media_type = typeof mediaType === 'string' && mediaType.startsWith('image/')
    ? mediaType
    : 'image/png';

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        // Haiku 4.5 finishes within Vercel's Hobby 60s timeout on dense pages.
        // If you upgrade to Vercel Pro (300s max), you can switch this back to
        // 'claude-sonnet-4-5' for higher extraction accuracy.
        model: 'claude-haiku-4-5',
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type, data: base64 },
            },
            {
              type: 'text',
              text: 'Analyze this piano sheet music. Follow all 5 steps precisely. Return only valid JSON.',
            },
          ],
        }],
      }),
    });

    const payload = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      // Forward a sanitized error — never echo the API key or internal details.
      return res.status(upstream.status).json({
        error: payload?.error?.message || `Anthropic API error ${upstream.status}`,
      });
    }

    // Extract the model's text output and return it as a plain string.
    // The client is responsible for JSON-parsing it (same contract as before).
    const raw = Array.isArray(payload.content)
      ? payload.content.map(c => c.text || '').join('')
      : '';

    return res.status(200).json({ raw });
  } catch (err) {
    console.error('parse-sheet error:', err);
    return res.status(500).json({ error: 'Upstream request failed' });
  }
}
