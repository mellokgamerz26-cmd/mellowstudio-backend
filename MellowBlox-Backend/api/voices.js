import {
  handleCors,
  requireProxyAuth,
  requireElevenLabsApiKey,
  ELEVENLABS_BASE_URL,
} from './_utils.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (!requireProxyAuth(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed', message: 'Use GET for /api/voices.' });
  }

  const apiKey = requireElevenLabsApiKey(res);
  if (!apiKey) return;

  try {
    const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/voices`, {
      method: 'GET',
      headers: {
        'xi-api-key': apiKey,
        Accept: 'application/json',
      },
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'ElevenLabs API error',
        status: response.status,
        details: data,
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to fetch voices',
      message: err.message,
    });
  }
}