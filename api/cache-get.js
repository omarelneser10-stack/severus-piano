// api/cache-get.js
// Looks up a previously parsed sheet by its file hash
// Uses @vercel/blob list() to find the blob, then fetches its content

import { list } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { hash } = req.query;
  if (!hash) {
    return res.status(400).json({ error: 'Missing hash parameter' });
  }

  try {
    // list() finds blobs by prefix — each sheet is stored as sheets/{hash}.json
    const { blobs } = await list({
      prefix: `sheets/${hash}.json`,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    if (!blobs || blobs.length === 0) {
      return res.status(404).json({ found: false });
    }

    // Fetch the blob content using its URL (provided by the SDK)
    const fetchRes = await fetch(blobs[0].url);
    if (!fetchRes.ok) {
      return res.status(404).json({ found: false });
    }

    const data = await fetchRes.json();
    return res.status(200).json({ found: true, data });
  } catch (err) {
    console.error('cache-get error:', err);
    return res.status(404).json({ found: false });
  }
}
