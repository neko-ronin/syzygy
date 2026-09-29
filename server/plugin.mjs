/**
 * Vite plugin: dev/preview API for SYZYGY.
 *
 *   POST /api/chat     proxy to the Anthropic Messages API, SSE out.
 *                      Answers {needsKey:true} when no key is configured.
 *   GET  /api/health   {ok, hasKey, model}
 *   POST /api/state     save a world snapshot to docs/saves/<name>.json
 *   GET  /api/state     list saved snapshots
 *   GET  /api/state/:n  load one
 *
 * No dependencies beyond Node's built-in fetch. Never throws, never hangs:
 * every path returns JSON and every socket gets closed.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SAVE_DIR = join(ROOT, 'docs', 'saves');

const DEFAULT_MODEL = 'claude-sonnet-4-5';
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MAX_BODY = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 120_000;

const model = () => process.env.SYZYGY_MODEL || DEFAULT_MODEL;
const apiKey = () => process.env.ANTHROPIC_API_KEY || process.env.SYZYGY_ANTHROPIC_API_KEY || '';

// ---------------------------------------------------------------- io helpers

function json(res, status, body) {
  if (res.headersSent || res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        rejectPromise(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolvePromise({});
      try {
        resolvePromise(JSON.parse(raw));
      } catch {
        rejectPromise(new Error('body was not valid JSON'));
      }
    });
    req.on('error', rejectPromise);
  });
}

/** Strict save-name validation. Returns '' for anything not a bare safe slug. */
function safeName(n) {
  const s = String(n ?? '');
  if (!s || s.length > 64) return '';
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : '';
}

/**
 * Compact one-paragraph grounding block appended to the system prompt, so the
 * model never has to call describe_world on the first turn.
 */
function worldSummary(world) {
  if (!world || typeof world !== 'object') return '';
  const w = world.weather || {};
  const s = world.sun || {};
  const l = world.lens || {};
  const r = (x, d = 2) => (typeof x === 'number' ? Math.round(x * 100 ** d) / 100 ** d : '?');
  const events = Array.isArray(world.events) ? world.events.slice(0, 5) : [];
  const lines = [
    `time ${r(world.time, 0)}s, day phase ${r(world.dayPhase)}, timeScale ${r(world.timeScale)}`,
    `sky=${w.sky} precip=${w.precip} cloud=${r(w.cloudCover)} storm=${r(w.storminess)} haze=${r(w.haze)} wind=${r(w.windSpeed, 1)} wet=${r(w.wetness)} godRays=${r(w.godRays)} motes=${r(w.motes)}`,
    `sun az=${r(s.azimuth)} el=${r(s.elevation)} intensity=${r(s.intensity, 1)} dayLength=${s.dayLength}`,
    `lens fov=${Math.round((l.fov || 0) * 57.2958)}deg roll=${r(l.roll)} tiltShift=${r(l.tiltShift)} bokeh=${r(l.bokeh)} warp=${r(l.warp)}`,
    `crowds ${world.crowds?.count ?? '?'} density=${r(world.crowds?.density)} agitation=${r(world.crowds?.agitation)} traffic ${world.traffic?.count ?? '?'}`,
    events.length ? `active events: ${events.map((e) => `${e.kind}(ttl=${e.ttl})`).join(', ')}` : 'active events: none',
  ];
  return `\n\n<world>\n${lines.join('\n')}\n</world>`;
}

// ---------------------------------------------------------------- chat

function sse(res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders?.();
  return (event) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

/**
 * Translate one Anthropic stream event into our normalized SSE vocabulary.
 * Returns the emitted events (possibly none).
 */
function translate(evt, state) {
  const out = [];
  if (!evt || typeof evt !== 'object') return out;
  switch (evt.type) {
    case 'message_start':
      state.usage = evt.message?.usage ?? state.usage;
      return out;
    case 'content_block_start':
      state.block = evt.content_block?.type ?? null;
      state.toolId = evt.content_block?.id ?? null;
      state.toolName = evt.content_block?.name ?? null;
      state.toolJson = '';
      if (state.block === 'text') out.push({ type: 'text', delta: evt.content_block?.text ?? '' });
      return out;
    case 'content_block_delta': {
      const d = evt.delta;
      if (d?.type === 'text_delta') out.push({ type: 'text', delta: d.text ?? '' });
      else if (d?.type === 'input_json_delta') state.toolJson = (state.toolJson || '') + (d.partial_json ?? '');
      else if (d?.type === 'thinking_delta') out.push({ type: 'text', delta: '' });
      return out;
    }
    case 'content_block_stop':
      if (state.block === 'tool_use') {
        let input = {};
        try { input = state.toolJson ? JSON.parse(state.toolJson) : {}; } catch { input = {}; }
        out.push({ type: 'tool', id: state.toolId ?? `tu_${Date.now()}`, name: state.toolName ?? 'unknown', input });
        state.toolJson = '';
      }
      state.block = null;
      return out;
    case 'message_delta':
      state.stopReason = evt.delta?.stop_reason ?? state.stopReason;
      if (evt.usage) state.usage = { ...state.usage, ...evt.usage };
      return out;
    case 'message_stop':
      out.push({ type: 'done', stopReason: state.stopReason ?? null, usage: state.usage ?? null });
      return out;
    case 'error':
      out.push({ type: 'error', message: evt.error?.message || 'upstream error' });
      return out;
    default:
      return out;
  }
}

/** Split a byte stream into SSE frames. */
async function* sseFrames(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        yield frame;
      }
    }
    if (buf.trim()) yield buf;
  } finally {
    reader.cancel().catch(() => {});
  }
}

async function handleChat(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return json(res, 400, { error: err?.message || 'bad request' });
  }

  const key = apiKey();
  if (!key) {
    // Client falls back to the local brain. 200 so it is not read as a failure.
    return json(res, 200, { needsKey: true, model: model(), reason: 'no ANTHROPIC_API_KEY or SYZYGY_ANTHROPIC_API_KEY in the dev server env' });
  }

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) return json(res, 400, { error: 'messages[] required' });

  const system = `${typeof body.system === 'string' ? body.system : 'You are the Conductor of SYZYGY, a dreamscape city.'}${worldSummary(body.world)}`;
  const payload = {
    model: body.model || model(),
    max_tokens: body.max_tokens ?? 1200,
    stream: true,
    system,
    messages,
    ...(Array.isArray(body.tools) && body.tools.length ? { tools: body.tools } : {}),
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  const send = sse(res);

  try {
    const upstream = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
        accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      let parsed = null;
      try { parsed = JSON.parse(detail); } catch { /* not json */ }
      send({ type: 'error', message: `anthropic ${upstream.status}: ${parsed?.error?.message || detail.slice(0, 400) || upstream.statusText}` });
      return res.end();
    }

    const state = {};
    for await (const frame of sseFrames(upstream.body)) {
      const payloadLine = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!payloadLine) continue;
      const raw = payloadLine.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      let evt;
      try { evt = JSON.parse(raw); } catch { continue; }
      for (const e of translate(evt, state)) send(e);
    }
    if (!state.stopReason) send({ type: 'done', stopReason: 'end_turn', usage: state.usage ?? null });
  } catch (err) {
    if (!res.writableEnded) {
      send({ type: 'error', message: ac.signal.aborted ? 'conductor: upstream timed out' : `conductor: ${err?.message || err}` });
    }
  } finally {
    clearTimeout(timer);
    if (!res.writableEnded) res.end();
  }
}

// ---------------------------------------------------------------- saves

async function handleState(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/api/state') {
      if (!existsSync(SAVE_DIR)) return json(res, 200, { saves: [] });
      const files = (await readdir(SAVE_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
      return json(res, 200, { saves: files.sort() });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/state/')) {
      const name = safeName(url.pathname.slice('/api/state/'.length));
      if (!name) return json(res, 400, { error: 'bad save name' });
      const file = join(SAVE_DIR, `${name}.json`);
      if (!existsSync(file)) return json(res, 404, { error: `no save named "${name}"` });
      const state = JSON.parse(await readFile(file, 'utf8'));
      return json(res, 200, { name, state });
    }

    if (req.method === 'POST' && url.pathname === '/api/state') {
      let body;
      try { body = await readBody(req); } catch (err) { return json(res, 400, { error: err?.message || 'bad request' }); }
      const name = safeName(body.name);
      if (!name) return json(res, 400, { error: 'name required (a-z A-Z 0-9 _ -)' });
      if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state object required' });
      await mkdir(SAVE_DIR, { recursive: true });
      const file = join(SAVE_DIR, `${name}.json`);
      await writeFile(file, JSON.stringify(body.state, null, 2), 'utf8');
      return json(res, 200, { ok: true, name, path: `docs/saves/${name}.json`, bytes: Buffer.byteLength(JSON.stringify(body.state)) });
    }

    return json(res, 405, { error: `${req.method} not allowed on /api/state` });
  } catch (err) {
    return json(res, 500, { error: `state: ${err?.message || err}` });
  }
}

// ---------------------------------------------------------------- plugin

/** The middleware, exported so it can be unit-tested or reused outside Vite. */
export function syzygyApi() {
  return {
    name: 'syzygy-api',
    configureServer(server) {
      server.middlewares.use(middleware());
      logOnce('dev');
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware());
      logOnce('preview');
    },
  };
}

let logged = false;
function logOnce(where) {
  if (logged) return;
  logged = true;
  const key = apiKey();
  // eslint-disable-next-line no-console
  console.log(`\n  \x1b[2msyzygy\x1b[0m  conductor: ${key ? `LLM on \x1b[36m${model()}\x1b[0m` : '\x1b[33mlocal brain (no API key)\x1b[0m'}  ·  ${where} server\n`);
}

function middleware() {
  return function syzygyMiddleware(req, res, next) {
    const url = req.url ? new URL(req.url, 'http://localhost') : null;
    const pathname = url?.pathname ?? '';

    if (!pathname.startsWith('/api/')) return next();

    // Keep-alive safety: the client must never hang on a dead server.
    const guard = setTimeout(() => {
      if (!res.writableEnded) json(res, 504, { error: 'conductor: handler timed out' });
    }, UPSTREAM_TIMEOUT_MS + 5_000);
    res.on('close', () => clearTimeout(guard));

    Promise.resolve()
      .then(() => {
        if (pathname === '/api/health') return json(res, 200, { ok: true, hasKey: Boolean(apiKey()), model: model() });
        if (pathname === '/api/chat' && req.method === 'POST') return handleChat(req, res);
        if (pathname === '/api/chat') return json(res, 405, { error: 'POST /api/chat' });
        if (pathname.startsWith('/api/state')) return handleState(req, res, url);
        return json(res, 404, { error: `no such endpoint: ${pathname}` });
      })
      .catch((err) => {
        try { json(res, 500, { error: `syzygy-api: ${err?.message || err}` }); }
        catch { if (!res.writableEnded) res.end(); }
      })
      .finally(() => clearTimeout(guard));
  };
}

export default syzygyApi;
