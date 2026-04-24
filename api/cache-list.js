// api/cache-list.js
// Returns the sheet library index from Vercel Blob
// Reads sheets/index.json via the SDK

import { list } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { blobs } = await list({
      prefix: 'sheets/index.json',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    if (!blobs || blobs.length === 0) {
      // No index yet — library is empty
      return res.status(200).json({ sheets: [] });
    }

    const indexRes = await fetch(blobs[0].url);
    if (!indexRes.ok) {
      return res.status(200).json({ sheets: [] });
    }

    const sheets = await indexRes.json();
    return res.status(200).json({ sheets: Array.isArray(sheets) ? sheets : [] });
  } catch (err) {
    console.error('cache-list error:', err);
    return res.status(200).json({ sheets: [] }); // return empty rather than crashing the UI
  }
}
