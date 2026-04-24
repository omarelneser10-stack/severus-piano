// api/cache-save.js
// Saves a parsed sheet to Vercel Blob storage
// Two blobs are written:
//   sheets/{hash}.json  — full entry (beats + sheetInfo + metadata)
//   sheets/index.json   — library index (metadata only, no beats)

import { put, list } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { hash, name, beats, sheetInfo, thumbnail } = req.body;

  if (!hash || !beats || !Array.isArray(beats)) {
    return res.status(400).json({ error: 'Missing required fields: hash, beats' });
  }

  try {
    const now = Date.now();
    const displayName = name || sheetInfo?.keySignature || 'Untitled Sheet';

    const noteCount = beats.reduce((acc, b) =>
      acc + (b.rightHand?.length || 0) + (b.leftHand?.length || 0), 0);
    const totalDuration = beats.reduce((acc, b) => acc + (b.duration || 0), 0);

    // 1 — Save the full sheet entry
    const entry = {
      hash,
      name: displayName,
      beats,
      sheetInfo: sheetInfo || null,
      thumbnail: thumbnail || null,
      savedAt: now,
      noteCount,
      beatCount: beats.length,
      totalDuration,
    };

    await put(`sheets/${hash}.json`, JSON.stringify(entry), {
      access: 'public',
      contentType: 'application/json',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
    });

    // 2 — Read existing index and update it
    let existingIndex = [];
    try {
      const { blobs } = await list({
        prefix: 'sheets/index.json',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      if (blobs && blobs.length > 0) {
        const indexRes = await fetch(blobs[0].url);
        if (indexRes.ok) {
          existingIndex = await indexRes.json();
        }
      }
    } catch {
      existingIndex = [];
    }

    const indexEntry = {
      hash,
      name: displayName,
      sheetInfo: sheetInfo || null,
      thumbnail: thumbnail || null,
      savedAt: now,
      noteCount,
      beatCount: beats.length,
      totalDuration,
    };

    const filtered = existingIndex.filter(e => e.hash !== hash);
    filtered.unshift(indexEntry); // newest first

    await put('sheets/index.json', JSON.stringify(filtered), {
      access: 'public',
      contentType: 'application/json',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
    });

    return res.status(200).json({ saved: true, name: displayName });
  } catch (err) {
    console.error('cache-save error:', err);
    return res.status(500).json({ error: err.message });
  }
}
