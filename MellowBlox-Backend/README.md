# MELLOW BLOX Studio — ElevenLabs Vercel Serverless Proxy Backend

Secure Node.js serverless proxy for **ElevenLabs** narration (TTS), sound effects, voices, and account usage. Designed for use with Google Flow / MELLOW BLOX Studio clients without exposing your ElevenLabs API key in the browser.

## Features

- **Narration (TTS):** `POST /api/tts`
  - Standard mode returns **real MP3 audio** (`audio/mpeg`).
  - Timestamp mode (`with_timestamps: true`) returns **JSON** containing `audio_base64` and `alignment` (and any additional upstream fields).
- **Sound effects:** `POST /api/sfx` returns **MP3 audio**.
- **Voices:** `GET /api/voices` proxies ElevenLabs voices.
- **Account usage:** `GET /api/usage` proxies ElevenLabs user/account usage info.
- **Health:** `GET /api/health` reports proxy status and protection state.
- **Security:** `PROXY_TOKEN` is **required** on every `/api/*` request (including OPTIONS-exempt auth checks on non-preflight requests; CORS preflight `OPTIONS` is handled correctly). Unauthenticated generation requests are never allowed.
- **Secrets:** `ELEVENLABS_API_KEY` is read **only** from server-side environment variables.
- **Protection:** Persistent **rate limiting** and **credit protection** (character/unit quotas) backed by a JSON store (local file or `/tmp` on Vercel) with optional Vercel KV / Upstash-compatible REST persistence when `KV_REST_API_URL` and `KV_REST_API_TOKEN` are configured.
- **CORS:** Configured for browser clients, including `OPTIONS` preflight handling.

## Project structure

```text
.
+- api/
¦  +- _utils.js        # CORS, auth, env-only key access, request helpers
¦  +- _protection.js   # Persistent rate limiting & credit protection
¦  +- health.js        # GET /api/health
¦  +- tts.js           # POST /api/tts
¦  +- sfx.js           # POST /api/sfx
¦  +- voices.js        # GET /api/voices
¦  +- usage.js         # GET /api/usage
+- public/
¦  +- index.html       # Diagnostic UI (no hardcoded secrets)
+- scripts/
¦  +- local-server.js  # Local dev server for /api and /public
¦  +- test-local.js    # Local automated checks
+- .env.example
+- vercel.json
+- package.json
+- README.md
```

## Prerequisites

- Node.js **18+** (Node 20+ recommended for Vercel)
- An [ElevenLabs API key](https://elevenlabs.io/app/settings/api-keys)
- A strong random `PROXY_TOKEN` value you control

## Environment variables

Configure these in **Vercel ? Project Settings ? Environment Variables** (and locally in `.env` for testing; never commit `.env`).

| Variable | Required | Description |
| --- | --- | --- |
| `ELEVENLABS_API_KEY` | Yes | ElevenLabs API key. **Server-side only.** |
| `PROXY_TOKEN` | Yes | Secret token required on every API request. |
| `DEFAULT_VOICE_ID` | No | Default voice ID when client omits `voice_id`. |
| `RATE_LIMIT_WINDOW_MS` | No | Rate limit window in ms (default `60000`). |
| `RATE_LIMIT_MAX_REQUESTS` | No | Max generation requests per window per client IP (default `30`). |
| `DAILY_CHAR_LIMIT` | No | Daily character/unit quota for generation (default `100000`). |
| `MONTHLY_CHAR_LIMIT` | No | Monthly character/unit quota for generation (default `1000000`). |
| `RATE_LIMIT_STORE_PATH` | No | Override JSON store path (local/custom). |
| `KV_REST_API_URL` | No | Optional Vercel KV / Upstash REST URL for shared persistence. |
| `KV_REST_API_TOKEN` | No | Optional token for the KV REST API. |

> **Note:** `PROXY_TOKEN` is mandatory. If missing, the API returns `500 Server misconfiguration` and refuses requests. No actual keys are hardcoded in this project.

## Local testing (before deployment)

1. **Install dependencies** (none required beyond Node; this project has no npm packages):
   ```bash
   npm install
   ```
2. **Create a local env file** (do not commit it):
   - Copy `.env.example` to `.env` and set at least:
     - `ELEVENLABS_API_KEY=...`
     - `PROXY_TOKEN=...` (choose a strong secret for local testing)
3. **Run automated local checks** (auth, CORS/OPTIONS, validation, protection, routing):
   ```bash
   npm run test:local
   ```
   These tests mock upstream ElevenLabs calls and verify MP3/timestamp JSON behavior without needing to spend credits.
4. **Start the local server** (PowerShell example):
   ```powershell
   # Load .env in your shell/session, then:
   npm start
   ```
   Or set variables inline for the process as appropriate in your environment, then open [http://localhost:3000](http://localhost:3000) for the diagnostic UI.
5. **Manual endpoint checks** (replace token/URL as needed):
   - `OPTIONS /api/tts` should return CORS/preflight success.
   - Requests without a valid `x-proxy-token` / `Authorization: Bearer <token>` should be rejected.
   - `POST /api/tts` with `{"text":"Hello","with_timestamps":false}` should return `audio/mpeg` when configured with a valid ElevenLabs key.
   - `POST /api/tts` with `{"text":"Hello","with_timestamps":true}` should return JSON containing `audio_base64` and `alignment`.

> Optional: if you have the Vercel CLI installed, you can also run `npm run dev` (`vercel dev`) for a Vercel-like environment.

## Deploy to Vercel

1. Push this folder to a Git repository (GitHub/GitLab/Bitbucket).
2. In [Vercel](https://vercel.com/new), import the repository.
3. Framework preset: **Other** (no build step required). Root directory: this project folder.
4. Add environment variables:
   - `ELEVENLABS_API_KEY` (secret)
   - `PROXY_TOKEN` (secret)
   - Optional: `DEFAULT_VOICE_ID`, rate/credit limits, KV REST settings
5. Deploy. Your base URL will look like `https://your-project.vercel.app`.
6. Open `https://your-project.vercel.app/` to use the diagnostic page (enter your `PROXY_TOKEN` manually; it is never prefilled).

## API reference

All `/api/*` endpoints require proxy authentication:
- Header: `x-proxy-token: <PROXY_TOKEN>` **or** `Authorization: Bearer <PROXY_TOKEN>`
- CORS preflight: `OPTIONS` requests are handled with appropriate CORS headers.

### `GET /api/health`
Returns service status, API key configuration flag, and protection snapshot.

### `GET /api/voices`
Proxies `GET https://api.elevenlabs.io/v1/voices`.

### `GET /api/usage`
Proxies `GET https://api.elevenlabs.io/v1/user` (account/subscription/usage info).

### `POST /api/tts`
Request body (JSON):
```json
{
  "text": "Narration text",
  "voice_id": "optional-voice-id",
  "model_id": "eleven_flash_v2_5",
  "with_timestamps": false,
  "output_format": "mp3_44100_128",
  "voice_settings": {
    "stability": 0.4,
    "similarity_boost": 0.8,
    "style": 0.5,
    "use_speaker_boost": true
  }
}
```
- **Standard (`with_timestamps: false`)**: returns `audio/mpeg` binary MP3.
- **Timestamps (`with_timestamps: true`)**: returns JSON with `audio_base64` and `alignment` (pass-through from ElevenLabs).

### `POST /api/sfx`
Request body (JSON):
```json
{
  "text": "Footsteps on gravel",
  "duration_seconds": 1.5,
  "prompt_influence": 0.3
}
```
Returns `audio/mpeg` binary MP3.

## Connecting an existing Google Flow application

Do **not** modify the Google Flow animation engine. Configure your app's ElevenLabs/audio settings to call this backend instead of ElevenLabs directly:

1. **Proxy/Base URL:** set to your deployed Vercel URL, e.g. `https://your-project.vercel.app` (no trailing slash required).
2. **Authentication:** send your `PROXY_TOKEN` on every request:
   - Preferred header: `x-proxy-token: <PROXY_TOKEN>`
   - Also supported: `Authorization: Bearer <PROXY_TOKEN>`
3. **Endpoints to use:**
   - Narration: `POST {BASE_URL}/api/tts`
   - Sound effects: `POST {BASE_URL}/api/sfx`
   - Voices list: `GET {BASE_URL}/api/voices`
   - Account usage: `GET {BASE_URL}/api/usage`
   - Health check: `GET {BASE_URL}/api/health`
4. **Client-side API key field:** if your app asks for an "API key" for proxy mode, provide the **PROXY_TOKEN** (not the ElevenLabs key). The ElevenLabs key must remain only in Vercel server environment variables.
5. **Response handling:**
   - Standard TTS/SFX: expect binary MP3 (`audio/mpeg`) — create a blob/object URL or decode as audio.
   - Timestamp TTS: expect JSON; decode `audio_base64` to audio bytes and use `alignment` for timing/animation sync.
6. **CORS:** the proxy responds with CORS headers and handles `OPTIONS` preflight, so browser-based Google Flow clients can call it directly.

## Rate limiting and credit protection notes

- Generation requests (`/api/tts`, `/api/sfx`) are checked against a request-rate window and daily/monthly character/unit quotas before calling ElevenLabs.
- State is persisted to a JSON store:
  - **Local:** `.data/usage.json` by default (or `RATE_LIMIT_STORE_PATH`)
  - **Vercel:** `/tmp/mellowblox-usage.json` by default (instance-local persistence)
  - **Shared persistence:** configure `KV_REST_API_URL` and `KV_REST_API_TOKEN` to use a Vercel KV / Upstash-compatible REST backend for consistent limits across serverless instances.
- Tune limits via environment variables to match your ElevenLabs plan and risk tolerance.

## Security checklist

- Keep `ELEVENLABS_API_KEY` and `PROXY_TOKEN` in server environment variables only.
- Rotate `PROXY_TOKEN` if it is exposed.
- Do not commit `.env` files or real secrets.
- Monitor usage via `/api/usage` and adjust credit protection limits.