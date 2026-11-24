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
    return res.status(405).json({ error: 'Method Not Allowed', message: 'Use POST for /api/tts.' });
  }

  const apiKey = requireElevenLabsApiKey(res);
  if (!apiKey) return;

  const body = await readJsonBody(req);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const {
    text,
    voice_id,
    model_id = 'eleven_flash_v2_5',
    with_timestamps = false,
    output_format = 'mp3_44100_128',
    voice_settings = {
      stability: 0.4,
      similarity_boost: 0.8,
      style: 0.5,
      use_speaker_boost: true,
    },
  } = body;

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Missing or invalid "text"', message: 'Provide narration text as a non-empty string.' });
  }

  if (text.length > 5000) {
    return res.status(400).json({ error: 'Text too long', message: 'Narration text must be 5000 characters or fewer.' });
  }

  const voiceId = String(voice_id || process.env.DEFAULT_VOICE_ID || 'ErXwobaYiN019PkySvjV').trim();
  if (!voiceId) {
    return res.status(400).json({ error: 'Missing voice_id', message: 'Provide a voice_id or set DEFAULT_VOICE_ID on the server.' });
  }

  const allowed = await enforceGenerationProtection(req, res, { units: text.length });
  if (!allowed) return;

  const encodedVoiceId = encodeURIComponent(voiceId);
  const endpointUrl = with_timestamps
    ? `${ELEVENLABS_BASE_URL}/v1/text-to-speech/${encodedVoiceId}/with-timestamps?output_format=${encodeURIComponent(String(output_format))}`
    : `${ELEVENLABS_BASE_URL}/v1/text-to-speech/${encodedVoiceId}?output_format=${encodeURIComponent(String(output_format))}`;

  try {
    const upstream = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: with_timestamps ? 'application/json' : 'audio/mpeg',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id,
        voice_settings,
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
        error: 'ElevenLabs TTS request failed',
        status: upstream.status,
        details,
      });
    }

    if (with_timestamps) {
      const data = await upstream.json();
      if (!data || typeof data !== 'object') {
        return res.status(502).json({ error: 'Invalid upstream response', message: 'Expected JSON with audio_base64 and alignment.' });
      }
      if (!('audio_base64' in data) || !('alignment' in data)) {
        return res.status(502).json({
          error: 'Unexpected upstream response',
          message: 'Timestamp response must include audio_base64 and alignment.',
          details: data,
        });
      }
      return res.status(200).json(data);
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