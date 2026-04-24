// api/cache-delete.js
// Deletes a sheet from Vercel Blob storage and updates the index

import { list, del, put } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { hash } = req.query;
  if (!hash) {
    return res.status(400).json({ error: 'Missing hash parameter' });
  }

  try {
    // 1 — Find and delete the sheet blob
    const { blobs: sheetBlobs } = await list({
      prefix: `sheets/${hash}.json`,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    if (sheetBlobs && sheetBlobs.length > 0) {
      await del(sheetBlobs[0].url, { token: process.env.BLOB_READ_WRITE_TOKEN });
    }

    // 2 — Read the index, remove the entry, write it back
    let existingIndex = [];
    try {
      const { blobs: indexBlobs } = await list({
        prefix: 'sheets/index.json',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      if (indexBlobs && indexBlobs.length > 0) {
        const indexRes = await fetch(indexBlobs[0].url);
        if (indexRes.ok) {
          existingIndex = await indexRes.json();
        }
      }
    } catch {
      existingIndex = [];
    }

    const updated = existingIndex.filter(e => e.hash !== hash);

    await put('sheets/index.json', JSON.stringify(updated), {
      access: 'public',
      contentType: 'application/json',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
    });

    return res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('cache-delete error:', err);
    return res.status(500).json({ error: err.message });
  }
}
