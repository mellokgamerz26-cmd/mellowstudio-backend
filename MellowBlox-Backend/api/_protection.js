import fs from 'node:fs/promises';
import path from 'node:path';
import { getClientIp, ensureDirForFile } from './_utils.js';

const STORE_KEY = 'mellowblox:protection:v1';
let memoryState = createEmptyState();
let writeQueue = Promise.resolve();

function createEmptyState() {
  return { rate: {}, daily: {}, monthly: {} };
}

function now() {
  return Date.now();
}

function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function utcMonth(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function getStorePath() {
  if (process.env.RATE_LIMIT_STORE_PATH) {
    return path.resolve(process.cwd(), process.env.RATE_LIMIT_STORE_PATH);
  }
  if (process.env.VERCEL) {
    return '/tmp/mellowblox-usage.json';
  }
  return path.resolve(process.cwd(), '.data', 'usage.json');
}

function hasKvConfig() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvFetch(pathname, init = {}) {
  const base = String(process.env.KV_REST_API_URL).replace(/\/$/, '');
  const token = process.env.KV_REST_API_TOKEN;
  const res = await fetch(`${base}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`KV request failed (${res.status}): ${text}`);
  }
  return res;
}

async function loadState() {
  if (hasKvConfig()) {
    try {
      const res = await kvFetch(`/get/${encodeURIComponent(STORE_KEY)}`);
      const data = await res.json();
      if (!data || data.result == null) return createEmptyState();
      const raw = typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
      const parsed = JSON.parse(raw);
      return normalizeState(parsed);
    } catch {
      return createEmptyState();
    }
  }

  const filePath = getStorePath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return normalizeState(JSON.parse(raw));
  } catch {
    return createEmptyState();
  }
}

function normalizeState(state) {
  const base = createEmptyState();
  if (!state || typeof state !== 'object') return base;
  return {
    rate: state.rate && typeof state.rate === 'object' ? state.rate : {},
    daily: state.daily && typeof state.daily === 'object' ? state.daily : {},
    monthly: state.monthly && typeof state.monthly === 'object' ? state.monthly : {},
  };
}

async function saveState(state) {
  memoryState = state;
  if (hasKvConfig()) {
    const value = encodeURIComponent(JSON.stringify(state));
    await kvFetch(`/set/${encodeURIComponent(STORE_KEY)}/${value}`, { method: 'POST' });
    return;
  }
  const filePath = getStorePath();
  await ensureDirForFile(filePath);
  await fs.writeFile(filePath, JSON.stringify(state), 'utf8');
}

function pruneState(state) {
  const current = now();
  const dayKey = utcDay();
  const monthKey = utcMonth();

  for (const [key, entry] of Object.entries(state.rate || {})) {
    if (!entry || typeof entry.resetAt !== 'number' || entry.resetAt <= current) {
      delete state.rate[key];
    }
  }
  for (const key of Object.keys(state.daily || {})) {
    if (key !== dayKey) delete state.daily[key];
  }
  for (const key of Object.keys(state.monthly || {})) {
    if (key !== monthKey) delete state.monthly[key];
  }
  return state;
}

function getLimits() {
  const toInt = (value, fallback) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    maxRequests: toInt(process.env.RATE_LIMIT_MAX_REQUESTS, 30),
    dailyCharLimit: toInt(process.env.DAILY_CHAR_LIMIT, 100_000),
    monthlyCharLimit: toInt(process.env.MONTHLY_CHAR_LIMIT, 1_000_000),
  };
}

function queued(fn) {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

export async function enforceGenerationProtection(req, res, { units = 0 } = {}) {
  return queued(async () => {
    const limits = getLimits();
    const state = pruneState(await loadState());
    const current = now();
    const ip = getClientIp(req) || 'unknown';
    const bucket = Math.floor(current / limits.windowMs);
    const rateKey = `${ip}:${bucket}`;
    const rateEntry = state.rate[rateKey] || { count: 0, resetAt: (bucket + 1) * limits.windowMs };

    if (rateEntry.count >= limits.maxRequests) {
      await saveState(state);
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Too many requests. Limit is ${limits.maxRequests} requests per ${Math.ceil(limits.windowMs / 1000)} seconds.`,
        retryAfterMs: Math.max(0, rateEntry.resetAt - current),
      });
      return false;
    }

    const dayKey = utcDay();
    const monthKey = utcMonth();
    const dayEntry = state.daily[dayKey] || { chars: 0, requests: 0 };
    const monthEntry = state.monthly[monthKey] || { chars: 0, requests: 0 };
    const chargeUnits = Math.max(0, Number(units) || 0);

    if (dayEntry.chars + chargeUnits > limits.dailyCharLimit) {
      await saveState(state);
      res.status(429).json({
        error: 'Daily credit protection limit reached',
        message: `Daily usage limit reached (${limits.dailyCharLimit} units/day). Request blocked to protect credits.`,
        usage: { day: dayEntry, month: monthEntry },
      });
      return false;
    }

    if (monthEntry.chars + chargeUnits > limits.monthlyCharLimit) {
      await saveState(state);
      res.status(429).json({
        error: 'Monthly credit protection limit reached',
        message: `Monthly usage limit reached (${limits.monthlyCharLimit} units/month). Request blocked to protect credits.`,
        usage: { day: dayEntry, month: monthEntry },
      });
      return false;
    }

    rateEntry.count += 1;
    dayEntry.chars += chargeUnits;
    dayEntry.requests += 1;
    monthEntry.chars += chargeUnits;
    monthEntry.requests += 1;

    state.rate[rateKey] = rateEntry;
    state.daily[dayKey] = dayEntry;
    state.monthly[monthKey] = monthEntry;

    await saveState(state);
    return true;
  });
}

export async function getProtectionSnapshot() {
  return queued(async () => {
    const state = pruneState(await loadState());
    await saveState(state);
    return {
      limits: getLimits(),
      day: state.daily[utcDay()] || { chars: 0, requests: 0 },
      month: state.monthly[utcMonth()] || { chars: 0, requests: 0 },
      persistentStore: hasKvConfig() ? 'vercel-kv-rest' : 'file',
      storePath: hasKvConfig() ? null : getStorePath(),
    };
  });
}