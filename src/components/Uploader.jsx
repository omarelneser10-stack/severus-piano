import { useRef, useState } from 'react';

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

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

// ── Hashing ────────────────────────────────────────────────────────────────
// Generate a SHA-256 fingerprint of the base64 string to use as a cache key
async function hashBase64(base64) {
  const msgBuf = new TextEncoder().encode(base64.slice(0, 8192)); // first 8KB is enough for a fingerprint
  const hashBuf = await crypto.subtle.digest('SHA-256', msgBuf);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Thumbnail ──────────────────────────────────────────────────────────────
// Create a small 120px-wide thumbnail from a dataUrl for library display
function makeThumbnail(dataUrl, maxWidth = 120) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = maxWidth / img.width;
      const canvas = document.createElement('canvas');
      canvas.width = maxWidth;
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// ── PDF rendering ──────────────────────────────────────────────────────────
async function pdfToBase64(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdfjsLib = window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.5 });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  const dataUrl = canvas.toDataURL('image/png');
  return { base64: dataUrl.split(',')[1], dataUrl };
}

async function imageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      resolve({ base64: dataUrl.split(',')[1], dataUrl });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Cache helpers ──────────────────────────────────────────────────────────
async function checkCache(hash) {
  try {
    const res = await fetch(`/api/cache-get?hash=${hash}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.found ? data.data : null;
  } catch {
    return null; // cache unavailable (local dev without KV) — just proceed
  }
}

async function saveToCache(hash, name, beats, sheetInfo, thumbnail) {
  try {
    await fetch('/api/cache-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash, name, beats, sheetInfo, thumbnail }),
    });
  } catch {
    // Cache save failure is non-fatal — silently ignore
  }
}

// ── Component ──────────────────────────────────────────────────────────────
export default function Uploader({ onParsed }) {
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [fileData, setFileData] = useState(null);
  const [fileHash, setFileHash] = useState(null);
  const [sheetInfo, setSheetInfo] = useState(null);
  const [sheetName, setSheetName] = useState('');
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [pendingSave, setPendingSave] = useState(null); // { beats, info, thumbnail }
  const inputRef = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    setStatus(null);
    setSheetInfo(null);
    setShowNamePrompt(false);
    setPendingSave(null);
    setSheetName('');

    try {
      let data;
      if (file.type === 'application/pdf') {
        setStatus({ type: 'loading', message: 'Rendering PDF at high resolution…' });
        data = await pdfToBase64(file);
        setStatus(null);
      } else if (file.type.startsWith('image/')) {
        data = await imageToBase64(file);
      } else {
        setStatus({ type: 'error', message: 'Unsupported file. Use PDF, PNG, JPG, or WEBP.' });
        return;
      }

      setPreview(data.dataUrl);
      setFileData(data);

      // Compute hash immediately for cache lookup
      const hash = await hashBase64(data.base64);
      setFileHash(hash);

      // Check cache before user even clicks parse
      const cached = await checkCache(hash);
      if (cached) {
        setSheetInfo(cached.sheetInfo);
        const noteCount = cached.beats.reduce((acc, b) =>
          acc + (b.rightHand?.length || 0) + (b.leftHand?.length || 0), 0);
        const totalDuration = cached.beats.reduce((acc, b) => acc + (b.duration || 0), 0);
        setStatus({
          type: 'success',
          message: `⚡ Loaded from library — ${noteCount} notes across ${cached.beats.length} beats`,
          noteCount,
          beatCount: cached.beats.length,
          totalDuration,
          styleConfidence: cached.sheetInfo?.styleConfidence,
          fromCache: true,
        });
        onParsed(cached.beats, cached.sheetInfo);
      }
    } catch (err) {
      setStatus({ type: 'error', message: `Failed to load file: ${err.message}` });
    }
  };

  const handleParse = async () => {
    if (!fileData || !API_KEY) return;
    setParsing(true);
    setSheetInfo(null);
    setShowNamePrompt(false);
    setStatus({ type: 'loading', message: 'Analyzing sheet music with AI…' });

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 16000,
          system: SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: fileData.base64 },
              },
              {
                type: 'text',
                text: 'Analyze this piano sheet music. Follow all 5 steps precisely. Return only valid JSON.',
              },
            ],
          }],
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `API error ${response.status}`);
      }

      const data = await response.json();
      const raw = data.content.map(c => c.text || '').join('');
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);

      const beats = Array.isArray(parsed) ? parsed : (parsed.beats || []);
      const info = parsed.sheetInfo || null;

      if (!Array.isArray(beats) || beats.length === 0) {
        throw new Error('No beats found in the response.');
      }

      const noteCount = beats.reduce((acc, b) =>
        acc + (b.rightHand?.length || 0) + (b.leftHand?.length || 0), 0);
      const totalDuration = beats.reduce((acc, b) => acc + (b.duration || 0), 0);

      // Generate thumbnail for library card
      const thumbnail = await makeThumbnail(fileData.dataUrl);

      setSheetInfo(info);
      setStatus({
        type: 'success',
        message: `✓ Found ${noteCount} notes across ${beats.length} beats`,
        noteCount,
        beatCount: beats.length,
        totalDuration,
        styleConfidence: info?.styleConfidence,
        fromCache: false,
      });

      // Store pending save data and show name prompt
      setPendingSave({ beats, info, thumbnail });
      setShowNamePrompt(true);

      // Suggest a name from sheetInfo
      const suggestedName = [
        info?.tempoMarking,
        info?.detectedStyle,
        info?.keySignature ? `in ${info.keySignature}` : null,
      ].filter(Boolean).join(' ') || 'Untitled Sheet';
      setSheetName(suggestedName);

      onParsed(beats, info);
    } catch (err) {
      setStatus({ type: 'error', message: `Parse error: ${err.message}` });
    } finally {
      setParsing(false);
    }
  };

  const handleSaveToLibrary = async () => {
    if (!pendingSave || !fileHash) return;
    const name = sheetName.trim() || 'Untitled Sheet';
    await saveToCache(fileHash, name, pendingSave.beats, pendingSave.info, pendingSave.thumbnail);
    setShowNamePrompt(false);
    setPendingSave(null);
    setStatus(prev => ({
      ...prev,
      message: prev.message + ` — saved as "${name}"`,
    }));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  return (
    <div className="panel" style={{ borderBottom: 'none' }}>
      <div className="panel-header">
        <span className="panel-title">Sheet Music</span>
      </div>
      <div className="upload-section">
        <div>
          <div
            className={`dropzone${dragOver ? ' drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <div className="dropzone-icon">𝄞</div>
            <div className="dropzone-label">Drop sheet music here</div>
            <div className="dropzone-sub">PDF · PNG · JPG · WEBP</div>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf"
              onChange={(e) => handleFile(e.target.files[0])}
              style={{ display: 'none' }}
            />
          </div>

          {fileData && !status?.fromCache && (
            <button
              className="parse-btn"
              style={{ width: '100%', marginTop: '0.75rem' }}
              onClick={handleParse}
              disabled={parsing || !API_KEY}
            >
              {parsing ? 'Analyzing…' : 'Extract Notes via AI'}
            </button>
          )}

          {/* Name prompt — shown after successful parse */}
          {showNamePrompt && (
            <div className="name-prompt">
              <div className="name-prompt-label">Save to library as:</div>
              <input
                className="name-prompt-input"
                type="text"
                value={sheetName}
                onChange={e => setSheetName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveToLibrary()}
                placeholder="Sheet name…"
                autoFocus
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="parse-btn" style={{ flex: 1 }} onClick={handleSaveToLibrary}>
                  Save
                </button>
                <button
                  className="parse-btn"
                  style={{ flex: 1, background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)' }}
                  onClick={() => { setShowNamePrompt(false); setPendingSave(null); }}
                >
                  Skip
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="preview-area">
          {preview && (
            <img className="preview-thumbnail" src={preview} alt="Sheet music preview" />
          )}

          {status && (
            <div className={`parse-status ${status.type}`}>
              {status.type === 'loading' && <div className="spinner" />}
              {status.message}
            </div>
          )}

          {status?.type === 'success' &&
            status.styleConfidence != null &&
            status.styleConfidence < 0.75 && (
            <div className="parse-status" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
              ⚠ Style uncertain ({Math.round(status.styleConfidence * 100)}% confidence) — verify playback sounds correct
            </div>
          )}

          {sheetInfo && (
            <div className="info-card">
              <div className="info-item">Key<span>{sheetInfo.keySignature || '—'}</span></div>
              <div className="info-item">Time<span>{sheetInfo.timeSignature || '—'}</span></div>
              <div className="info-item">Style<span>{sheetInfo.detectedStyle || '—'}</span></div>
              <div className="info-item">Tempo<span>{sheetInfo.tempoMarking || '—'}</span></div>
              <div className="info-item">Measures<span>{sheetInfo.measuresDetected || '—'}</span></div>
              <div className="info-item">Duration<span>{formatTime(status?.totalDuration || 0)}</span></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
