import {
  handleCors,
  requireProxyAuth,
  requireElevenLabsApiKey,
  readJsonBody,
  ELEVENLABS_BASE_URL,
} from './_utils.js';
import { enforceGenerationProtection } from './_protection.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (!requireProxyAuth(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed', message: 'Use POST for /api/sfx.' });
  }

  const apiKey = requireElevenLabsApiKey(res);
  if (!apiKey) return;

  const body = await readJsonBody(req);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { text, duration_seconds = 1.0, prompt_influence = 0.3 } = body;

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Missing or invalid "text"', message: 'Provide a sound effect prompt as a non-empty string.' });
  }

  if (text.length > 1000) {
    return res.status(400).json({ error: 'Prompt too long', message: 'Sound effect prompt must be 1000 characters or fewer.' });
  }

  const duration = Number(duration_seconds);
  const safeDuration = Number.isFinite(duration) ? Math.min(22, Math.max(0.5, duration)) : 1.0;
  const influence = Number(prompt_influence);
  const safeInfluence = Number.isFinite(influence) ? Math.min(1, Math.max(0, influence)) : 0.3;

  const allowed = await enforceGenerationProtection(req, res, { units: text.length });
  if (!allowed) return;

  try {
    const upstream = await fetch(`${ELEVENLABS_BASE_URL}/v1/sound-generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        duration_seconds: safeDuration,
        prompt_influence: safeInfluence,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      let details;
      try {
        details = errText ? JSON.parse(errText) : {};
      } catch {
        details = errText;
      }
      return res.status(upstream.status).json({
        error: 'ElevenLabs sound generation request failed',
        status: upstream.status,
        details,
      });
    }

    const audioBuffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(audioBuffer.byteLength));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(audioBuffer);
  } catch (err) {
    return res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  }
}