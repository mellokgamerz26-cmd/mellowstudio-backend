import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

const rootDir = process.cwd();
const storePath = path.join(rootDir, '.data', 'test-usage.json');
await fs.mkdir(path.dirname(storePath), { recursive: true });
await fs.rm(storePath, { force: true });

process.env.PROXY_TOKEN = 'test-proxy-token';
process.env.ELEVENLABS_API_KEY = 'test-elevenlabs-key';
process.env.RATE_LIMIT_STORE_PATH = storePath;
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_MAX_REQUESTS = '10';
process.env.DAILY_CHAR_LIMIT = '5000';
process.env.MONTHLY_CHAR_LIMIT = '10000';

const originalFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  const u = String(url);
  const okJson = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

  if (u === 'https://api.elevenlabs.io/v1/voices') {
    return okJson({ voices: [{ voice_id: 'voice-1', name: 'Test Voice' }] });
  }
  if (u === 'https://api.elevenlabs.io/v1/user') {
    return okJson({ subscription: { tier: 'test', character_count: 123, character_limit: 10000 } });
  }
  if (u.includes('/v1/text-to-speech/') && u.includes('/with-timestamps')) {
    return okJson({
      audio_base64: 'ZmFrZS1tcDM=',
      alignment: {
        characters: ['H', 'i'],
        character_start_times_seconds: [0, 0.1],
        character_end_times_seconds: [0.1, 0.2],
      },
    });
  }
  if (u.includes('/v1/text-to-speech/')) {
    return new Response(Buffer.from('ID3FAKE-MP3-DATA'), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    });
  }
  if (u === 'https://api.elevenlabs.io/v1/sound-generation') {
    return new Response(Buffer.from('ID3FAKE-SFX-DATA'), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    });
  }
  return new Response(JSON.stringify({ error: 'unexpected upstream', url: u, options }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
};

function createResRecorder() {
  const headers = new Map();
  let body;
  const res = {
    statusCode: 200,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      body = Buffer.from(JSON.stringify(payload));
      this.setHeader('content-type', 'application/json');
      this.end(body);
      return this;
    },
    send(payload) {
      body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
      this.end(body);
      return this;
    },
    end(payload) {
      if (payload !== undefined) {
        body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
      }
      this.finished = true;
      return this;
    },
  };
  return {
    res,
    headers,
    result() {
      return { status: res.statusCode, headers, body: body || Buffer.alloc(0) };
    },
  };
}

function createReq({ method = 'GET', headers = {}, body, url = '/' } = {}) {
  let payload;
  if (body === undefined) payload = null;
  else if (Buffer.isBuffer(body)) payload = body;
  else if (typeof body === 'string') payload = Buffer.from(body);
  else payload = Buffer.from(JSON.stringify(body));

  const req = payload ? Readable.from([payload]) : Readable.from([]);
  req.method = method;
  req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  req.url = url;
  req.socket = { remoteAddress: '127.0.0.1' };
  if (body !== undefined && typeof body === 'object' && !Buffer.isBuffer(body)) {
    req.body = body; // simulate Vercel parsed body
  }
  return req;
}

async function invoke(handlerPath, reqInit) {
  const mod = await import(new URL(`../${handlerPath}`, import.meta.url).href + `?t=${Date.now()}-${Math.random()}`);
  const { res, result } = createResRecorder();
  await mod.default(createReq(reqInit), res);
  const out = result();
  const text = out.body.toString('utf8');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { ...out, text, json };
}

function assertCors(headers) {
  assert.equal(headers.get('access-control-allow-origin'), '*');
  assert.ok(String(headers.get('access-control-allow-methods') || '').includes('OPTIONS'));
  assert.ok(String(headers.get('access-control-allow-headers') || '').includes('x-proxy-token'));
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

const auth = { 'x-proxy-token': 'test-proxy-token', 'content-type': 'application/json' };

await test('CORS preflight handled for TTS', async () => {
  const out = await invoke('api/tts.js', { method: 'OPTIONS', headers: {} });
  assert.equal(out.status, 204);
  assertCors(out.headers);
});

await test('Missing or invalid proxy token is rejected', async () => {
  const out = await invoke('api/health.js', { method: 'GET', headers: {} });
  assert.equal(out.status, 401);
  assertCors(out.headers);
});

await test('Health succeeds with valid proxy auth', async () => {
  const out = await invoke('api/health.js', { method: 'GET', headers: { 'x-proxy-token': 'test-proxy-token' } });
  assert.equal(out.status, 200);
  assert.equal(out.json.status, 'ok');
  assert.equal(out.json.proxyAuthRequired, true);
  assert.equal(out.json.apiKeyConfigured, true);
});

await test('Voices endpoint returns proxied data', async () => {
  const out = await invoke('api/voices.js', { method: 'GET', headers: { 'x-proxy-token': 'test-proxy-token' } });
  assert.equal(out.status, 200);
  assert.equal(out.json.voices[0].voice_id, 'voice-1');
});

await test('Usage endpoint returns proxied data', async () => {
  const out = await invoke('api/usage.js', { method: 'GET', headers: { 'x-proxy-token': 'test-proxy-token' } });
  assert.equal(out.status, 200);
  assert.equal(out.json.subscription.tier, 'test');
});

await test('Standard TTS returns real MP3 audio', async () => {
  const out = await invoke('api/tts.js', { method: 'POST', headers: auth, body: { text: 'Hello world', with_timestamps: false } });
  assert.equal(out.status, 200);
  assert.equal(out.headers.get('content-type'), 'audio/mpeg');
  assert.ok(out.body.length > 0);
  assert.equal(out.text, 'ID3FAKE-MP3-DATA');
});

await test('Timestamp TTS returns JSON with audio_base64 and alignment', async () => {
  const out = await invoke('api/tts.js', { method: 'POST', headers: auth, body: { text: 'Hello world', with_timestamps: true } });
  assert.equal(out.status, 200);
  assert.match(String(out.headers.get('content-type') || ''), /application\/json/);
  assert.equal(typeof out.json.audio_base64, 'string');
  assert.ok(out.json.alignment);
});

await test('SFX returns MP3 audio', async () => {
  const out = await invoke('api/sfx.js', { method: 'POST', headers: auth, body: { text: 'Soft wind', duration_seconds: 1 } });
  assert.equal(out.status, 200);
  assert.equal(out.headers.get('content-type'), 'audio/mpeg');
  assert.ok(out.body.length > 0);
});

await test('Rate limiting and credit protection block excessive requests', async () => {
  process.env.RATE_LIMIT_MAX_REQUESTS = '1';
  await fs.rm(storePath, { force: true });
  const first = await invoke('api/tts.js', { method: 'POST', headers: auth, body: { text: 'First', with_timestamps: false } });
  assert.equal(first.status, 200);
  const second = await invoke('api/tts.js', { method: 'POST', headers: auth, body: { text: 'Second', with_timestamps: false } });
  assert.equal(second.status, 429);
  assert.ok(second.json.error);
});

await test('Missing PROXY_TOKEN rejects requests (no unauthenticated access)', async () => {
  const saved = process.env.PROXY_TOKEN;
  delete process.env.PROXY_TOKEN;
  try {
    const out = await invoke('api/health.js', { method: 'GET', headers: {} });
    assert.equal(out.status, 500);
    assert.match(String(out.json.message || ''), /PROXY_TOKEN/);
  } finally {
    process.env.PROXY_TOKEN = saved;
  }
});

await test('ELEVENLABS_API_KEY is required from server environment only', async () => {
  const saved = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    const out = await invoke('api/voices.js', { method: 'GET', headers: { 'x-proxy-token': 'test-proxy-token' } });
    assert.equal(out.status, 500);
    assert.match(String(out.json.message || ''), /ELEVENLABS_API_KEY/);
  } finally {
    process.env.ELEVENLABS_API_KEY = saved;
  }
});

global.fetch = originalFetch;

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} tests passed`);
if (failed.length) {
  for (const f of failed) console.error(`- ${f.name}: ${f.err?.message || f.err}`);
  process.exit(1);
}

await fs.rm(storePath, { force: true });
console.log('Local backend tests completed successfully.');