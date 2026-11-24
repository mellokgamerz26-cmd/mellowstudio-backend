import { handleCors, requireProxyAuth, getElevenLabsApiKey } from './_utils.js';
import { getProtectionSnapshot } from './_protection.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (!requireProxyAuth(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed', message: 'Use GET for /api/health.' });
  }

  const apiKeyConfigured = Boolean(getElevenLabsApiKey());
  let protection = null;
  try {
    protection = await getProtectionSnapshot();
  } catch (err) {
    protection = { error: 'Unable to read protection state', message: err.message };
  }

  return res.status(200).json({
    status: 'ok',
    service: 'MELLOW BLOX ElevenLabs Serverless Proxy',
    timestamp: new Date().toISOString(),
    apiKeyConfigured,
    proxyAuthRequired: true,
    protection,
    version: '1.0.0',
  });
}