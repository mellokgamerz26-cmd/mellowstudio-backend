import fs from 'node:fs/promises';
import path from 'node:path';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';

export function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-proxy-token');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

export function handleCors(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function getProvidedProxyToken(req) {
  const auth = req.headers?.authorization;
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const headerToken = req.headers?.['x-proxy-token'];
  return typeof headerToken === 'string' ? headerToken.trim() : '';
}

export function requireProxyAuth(req, res) {
  const expected = (process.env.PROXY_TOKEN || '').trim();
  if (!expected) {
    res.status(500).json({
      error: 'Server misconfiguration',
      message: 'PROXY_TOKEN is not configured. Set a strong PROXY_TOKEN in server environment variables. Unauthenticated requests are not allowed.',
    });
    return false;
  }

  const provided = getProvidedProxyToken(req);
  if (!provided || provided !== expected) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid proxy token. Provide x-proxy-token or Authorization: Bearer <token>.',
    });
    return false;
  }
  return true;
}

export function getElevenLabsApiKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  return typeof key === 'string' ? key.trim() : '';
}

export function requireElevenLabsApiKey(res) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    res.status(500).json({
      error: 'Server misconfiguration',
      message: 'ELEVENLABS_API_KEY is missing. Configure it in server-side environment variables only.',
    });
    return '';
  }
  return apiKey;
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    const trimmed = req.body.trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (req.readableEnded && !req.body) {
    return {};
  }

  const chunks = [];
  try {
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } catch {
    // If body stream is unavailable, fall back to parsed body if any.
    if (req.body && typeof req.body === 'object') return req.body;
    return {};
  }

  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getClientIp(req) {
  const xff = req.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  if (Array.isArray(xff) && xff.length) {
    return String(xff[0]).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

export async function ensureDirForFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export { ELEVENLABS_BASE_URL };