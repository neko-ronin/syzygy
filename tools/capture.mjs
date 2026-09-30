#!/usr/bin/env node
/**
 * Headless screenshot harness for SYZYGY.
 *
 *   node tools/capture.mjs                      one shot -> shots/<ts>.png
 *   node tools/capture.mjs --sequence           ~8 named poses -> shots/<ts>/*.png
 *   node tools/capture.mjs --quality high       set the app's quality tier
 *   node tools/capture.mjs --eval "expr"        run an expression in the page
 *
 * Boots vite preview (or dev with --dev) on port 4173, waits for
 * `window.__syzygy.ready`, drives the app, screenshots, and always tears the
 * server down. Every failure is reported as one readable line, never a stack.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'shots');
const PORT = Number(process.env.SYZYGY_PORT || 4173);
const BASE = `http://localhost:${PORT}`;
const GLOBAL_TIMEOUT_MS = Number(process.env.SYZYGY_TIMEOUT || 120_000);

// ---------------------------------------------------------------- cli

function parseArgs(argv) {
  const opts = { sequence: false, poses: [], debug: 0, debugseq: false, grab: null, query: '', quality: '', eval: null, dev: false, timeout: GLOBAL_TIMEOUT_MS, keepOpen: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sequence' || a === '-s') opts.sequence = true;
    else if (a === '--dev') opts.dev = true;
    else if (a.startsWith('--pose=')) opts.poses.push(a.slice(7));
    else if (a.startsWith('--debug=')) opts.debug = Number(a.slice(8));
    else if (a === '--debugseq') opts.debugseq = true;
    else if (a.startsWith('--grab=')) opts.grab = a.slice(7);
    else if (a.startsWith('--query=')) opts.query = a.slice(8);
    else if (a === '--keep-open') opts.keepOpen = true;
    else if (a === '--quality' || a === '-q') opts.quality = argv[++i] ?? '';
    else if (a === '--eval' || a === '-e') opts.eval = argv[++i] ?? null;
    else if (a === '--timeout') opts.timeout = Number(argv[++i]) * 1000;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('--eval=')) opts.eval = a.slice(7);
    else if (a.startsWith('--quality=')) opts.quality = a.slice(10);
    else if (a.startsWith('--timeout=')) opts.timeout = Number(a.slice(10)) * 1000;
  }
  if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) opts.timeout = GLOBAL_TIMEOUT_MS;
  return opts;
}

const HELP = `
syzygy capture harness

  node tools/capture.mjs                       capture one shot
  node tools/capture.mjs --sequence            capture the 8 curated poses
  node tools/capture.mjs --quality high        set quality tier (low|med|high)
  node tools/capture.mjs --eval "expr"         run a JS expression, print JSON
  node tools/capture.mjs --pose=canyon           only shoot poses whose name contains 'canyon'
  node tools/capture.mjs --dev                 use ` + '`vite dev`' + ` instead of preview
  node tools/capture.mjs --timeout 180         global budget in seconds (default 120)
`;

// ---------------------------------------------------------------- poses

/** Curated camera poses. `name` is used for the file name and the index. */
const POSES = [
  {
    name: '01-wide-skyline',
    label: 'wide skyline, tower tops in haze',
    position: [900, 120, 1400], lookAt: [0, 200, 0], fov: 1.12, roll: 0,
    weather: { sky: 'clear', cloudCover: 0.34, haze: 0.22, aerialHaze: 0.4, godRays: 0.55 },
    lens: { tiltShift: 0.62, focusWidth: 0.34, fov: 1.12 },
    settle: 30,
  },
  {
    // Ground-contact check. Every other pose is aerial or looking upward, so
    // none of them can show whether a building actually meets the ground --
    // which is how a tier loop that started at the building's centre survived
    // several reviews. This one sits at facade height in a populated chunk.
    name: '01a-building-base',
    label: 'street-level facade base — do buildings meet the ground?',
    position: [-1400, 7, -1340], lookAt: [-1352, 9, -1400], fov: 1.15, roll: 0,
    weather: { sky: 'clear', haze: 0.16 },
    lens: { tiltShift: 0, focusWidth: 1, bokeh: 0, chroma: 0, grain: 0, saturation: 1.1, vignette: 0.15 },
    settle: 40,
  },
  {
    name: '01b-crowd-closeup',
    label: 'street-level crowd close-up — are pedestrians actually drawn?',
    position: [0, 2.4, -40], lookAt: [30, 1.2, -180], fov: 0.95, roll: 0,
    weather: { sky: 'clear', haze: 0.2, godRays: 0.4 },
    lens: { tiltShift: 0, focusWidth: 1, bokeh: 0, chroma: 0.05, grain: 0, saturation: 1.1, vignette: 0.2 },
    settle: 40,
  },
  {
    name: '01c-street-crowd',
    label: 'street level looking down an avenue — crowd density check',
    position: [0, 4.5, -30], lookAt: [6, 2, -300], fov: 0.9, roll: 0,
    weather: { sky: 'clear', haze: 0.15, godRays: 0.3 },
    lens: { tiltShift: 0, focusWidth: 1, bokeh: 0, chroma: 0, grain: 0, saturation: 1.1, vignette: 0.15 },
    settle: 45,
  },
  {
    name: '02-canyon-up',
    label: 'deep in the canyon looking straight up',
    position: [190, 9, 330], lookAt: [230, 150, 150], fov: 1.43, roll: 0.08,
    weather: { sky: 'clear', haze: 0.5, godRays: 0.8 },
    lens: { tiltShift: 0.55, focusWidth: 0.3, fov: 1.43, warp: 0.28 },
    settle: 24,
  },
  {
    name: '03-tram-level',
    label: 'street level, tram perspective',
    position: [0, 2.2, -60], lookAt: [40, 4, -260], fov: 0.95, roll: -0.05,
    weather: { haze: 0.3, wetness: 0.3 },
    lens: { tiltShift: 0.72, bokeh: 0.7, focusWidth: 0.2, fov: 0.95 },
    settle: 24,
  },
  {
    name: '04-canal-level',
    label: 'canal water level, reflections',
    position: [900, 3, 260], lookAt: [1400, 6, 340], fov: 0.8, roll: 0.04,
    weather: { haze: 0.42, wetness: 0.75, motes: 0.5 },
    lens: { fov: 0.8, saturation: 1.25, tiltShift: 0.4, focusWidth: 0.5 },
    settle: 24,
  },
  {
    name: '05-aerial-top',
    label: 'aerial, near top-down over the grid',
    position: [300, 1400, 700], lookAt: [0, 0, 0], fov: 1.05, roll: 0,
    weather: { cloudCover: 0.5, aerialHaze: 0.7 },
    lens: { fov: 1.05, horizonBend: 0.34, tiltShift: 0.6, focusWidth: 0.24 },
    settle: 24,
  },
  {
    name: '06-low-vertigo',
    label: 'low over the void, wide and banking',
    position: [-420, 14, -560], lookAt: [180, 260, 120], fov: 1.62, roll: -0.35,
    weather: { haze: 0.34, cloudCover: 0.45, aerialHaze: 0.5 },
    lens: { fov: 1.62, roll: -0.35, warp: 0.4, speedFov: 0.5, distortion: 0.1 },
    settle: 24,
  },
  {
    name: '07-sunset-gorge',
    label: 'sunset over the gorge, long light',
    position: [640, 120, 980], lookAt: [-200, 60, -300], fov: 1.0, roll: 0.06,
    time: 'dusk',
    weather: { sky: 'dusk', cloudCover: 0.4, haze: 0.4, godRays: 0.9, bloomStrength: 0.6 },
    lens: { fov: 1.0, saturation: 1.2, bloom: 0.8, vignette: 0.5 },
    settle: 36,
  },
  {
    name: '08-night-lanterns',
    label: 'night, lanterns and window light',
    position: [180, 60, 340], lookAt: [40, 120, -260], fov: 1.18, roll: 0.02,
    time: 'night',
    weather: { sky: 'night', cloudCover: 0.3, haze: 0.45, godRays: 0.1, motes: 0.4 },
    lens: { fov: 1.18, bloom: 0.85, exposure: 1.25, saturation: 1.15, vignette: 0.55 },
    settle: 36,
  },
];

// ---------------------------------------------------------------- helpers

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => process.stdout.write(`${m}\n`);

/** A readable one-line error. Never a stack trace. */
class CaptureError extends Error {}

function fail(msg, hint) {
  throw new CaptureError(hint ? `${msg}\n  ↳ ${hint}` : msg);
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  return false;
}

// ---------------------------------------------------------------- server

async function startServer(opts) {
  // Always use the dev server. A `preview` build is a stale build, and a
  // screenshot of a stale build is worse than no screenshot: it looks valid.
  const useDev = true;
  const args = useDev ? ['vite', 'dev', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1']
                      : ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'];
  const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  let child;
  try {
    child = spawn(bin, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
  } catch (err) {
    fail(`could not spawn \`${bin} ${args.join(' ')}\`: ${err?.message || err}`, 'is vite installed? try `npm install`');
  }

  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });

  let exited = null;
  child.on('exit', (code) => { exited = code; });

  const up = await waitForHttp(BASE + '/', Math.min(30_000, Math.max(5_000, opts.timeout / 2)));
  if (!up) {
    stopServer(child);
    if (exited !== null) {
      fail(`vite ${useDev ? 'dev' : 'preview'} exited with code ${exited} before serving`, tail(log));
    }
    fail(`vite ${useDev ? 'dev' : 'preview'} did not answer on ${BASE}`, tail(log));
  }
  say(`  server    ${useDev ? 'dev' : 'preview'} on ${BASE}`);
  return { child, useDev };
}

function stopServer(child) {
  if (!child || child.killed) return;
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 2500).unref?.();
}

const tail = (s, n = 6) => s.trim().split('\n').slice(-n).join('\n          ');

// ---------------------------------------------------------------- browser

async function launchBrowser() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    fail('playwright is not installed', 'run `npm install`');
  }
  try {
    return await chromium.launch({
      headless: true,
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan',
        '--use-angle=metal',
        '--ignore-gpu-blocklist',
        '--enable-gpu',
        '--disable-dev-shm-usage',
        '--mute-audio',
      ],
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (/Executable doesn't exist|browserType.launch/i.test(msg)) {
      fail('chromium is not installed for playwright', 'run `npx playwright install chromium` once');
    }
    fail(`could not launch chromium: ${msg.split('\n')[0]}`);
  }
}

/** Wait for `window.__syzygy` and its readiness signal. */
async function waitForApp(page, timeoutMs) {
  const present = await page
    .waitForFunction(() => typeof window.__syzygy !== 'undefined' && window.__syzygy !== null, null, { timeout: Math.min(15_000, timeoutMs) })
    .then(() => true)
    .catch(() => false);

  if (!present) {
    fail('window.__syzygy is missing 15s after load', 'the app must set `window.__syzygy = {ready, readyPromise, ...}` before the first frame');
  }

  // resolve readyPromise if the app provides one, then wait for the flag
  await page.evaluate(async () => {
    const g = window.__syzygy;
    if (g && typeof g.readyPromise?.then === 'function') {
      await Promise.race([g.readyPromise, new Promise((r) => setTimeout(r, 30_000))]);
    }
  }).catch(() => {});

  const ready = await page
    .waitForFunction(() => window.__syzygy?.ready === true, null, { timeout: Math.min(45_000, timeoutMs) })
    .then(() => true)
    .catch(() => false);

  if (!ready) {
    const boot = await page.evaluate(() => document.getElementById('boot-status')?.textContent ?? '').catch(() => '');
    fail('window.__syzygy.ready never became true', boot ? `boot screen says: "${boot}"` : 'the app never signalled readiness (WebGPU adapter missing?)');
  }
}

/** Feature-detected call into the app surface; never throws. */
async function callApp(page, method, ...args) {
  return page.evaluate(async ({ method, args }) => {
    const g = window.__syzygy;
    if (!g || typeof g[method] !== 'function') return { ok: false, skipped: true, reason: `${method}() not implemented` };
    try {
      const v = await g[method](...args);
      return { ok: true, value: v === undefined ? null : v };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { method, args });
}

/** Drive the app forward a fixed number of frames, falling back to rAF waits. */
async function settle(page, frames) {
  // Wait for the streaming city to populate first: a shot taken on frame 1 is
  // of an empty world and tells you nothing about the render.
  await page.evaluate(async () => {
    const g = window.__syzygy;
    if (!g || typeof g.stats !== 'function') return;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const s = g.stats();
      if ((s.residentChunks ?? 0) >= 40) return;
      await new Promise((r) => requestAnimationFrame(r));
    }
  }).catch(() => {});

  const stepped = await callApp(page, 'step', frames);
  if (stepped.ok) return;
  // No `step()`: wait for real frames so animated content has advanced.
  await page.evaluate(async (n) => {
    const g = window.__syzygy;
    const start = g?.frameCount ?? 0;
    const deadline = Date.now() + Math.max(600, n * 40);
    while (Date.now() < deadline && (g?.frameCount ?? 0) < start + n) {
      await new Promise((r) => requestAnimationFrame(r));
    }
  }, frames).catch(() => {});
}

/** Screenshot, preferring an in-page canvas capture when available. */
async function shoot(page, path) {
  let saved = false;
  const cap = await callApp(page, 'capture');
  if (cap.ok && typeof cap.value === 'string' && cap.value.startsWith('data:image/')) {
    const b64 = cap.value.slice(cap.value.indexOf(',') + 1);
    writeFileSync(path, Buffer.from(b64, 'base64'));
    if (Buffer.from(b64, 'base64').length > 0) saved = true;
  }
  if (!saved) {
    await page.screenshot({ path, type: 'png', animations: 'allow', timeout: 20_000 });
    saved = existsSync(path);
  }
  return saved;
}

async function contactSheet(dir, out) {
  const { spawnSync } = await import('node:child_process');
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (probe.error) return null;
  const r = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-pattern_type', 'glob', '-framerate', '1', '-i', join(dir, '*.png'),
    '-filter_complex', 'scale=480:-1,tile=4x2:padding=6:color=0x05080b',
    '-frames:v', '1', out,
  ], { stdio: 'ignore' });
  return r.status === 0 && existsSync(out) ? out : null;
}

// ---------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { say(HELP); return 0; }

  mkdirSync(SHOTS, { recursive: true });
  const runStamp = stamp();
  const started = Date.now();
  const notes = [];

  let server = null;
  let browser = null;
  let page = null;
  const results = [];
  let failed = false;

  // Hard global budget — the one thing that must never be missed.
  const watchdog = setTimeout(() => {
    process.stderr.write(`\nFAIL  global timeout of ${Math.round(opts.timeout / 1000)}s exceeded\n`);
    try { browser?.close(); } catch { /* noop */ }
    stopServer(server?.child);
    process.exit(1);
  }, opts.timeout + 5000);
  watchdog.unref?.();

  try {
    if (opts.eval && !existsSync(join(ROOT, 'dist', 'index.html')) && !opts.dev) opts.dev = true;
    server = await startServer(opts);
    say(`  browser   chromium (webgpu)`);
    browser = await launchBrowser();

    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).split('\n')[0]));
    page.on('console', (m) => { if (m.type() === 'error' && pageErrors.length < 6) pageErrors.push(m.text().split('\n')[0]); });

    await page.goto(BASE + '/' + (opts.query ? `?seed=0x5e7a17&${opts.query}` : ''), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitForApp(page, opts.timeout);
    say(`  app       ready (frameCount=${await page.evaluate(() => window.__syzygy?.frameCount ?? 0)})`);

    if (opts.quality) {
      const r = await callApp(page, 'setQuality', opts.quality);
      if (!r.ok) {
        notes.push(`--quality ${opts.quality} ignored (${r.skipped ? r.reason : r.error})`);
      } else {
        say(`  quality   ${opts.quality}`);
      }
      await settle(page, 12);
    }

    // ---- --eval short-circuits: no screenshots.
    if (opts.grab) {
      // `grab` is "name:sat=0" or "name:key=v,key=v" — apply overrides to the
      // first matching pose and save exactly one frame. Bisecting a single
      // parameter should not cost a 5-minute sequence.
      mkdirSync(join(SHOTS, runStamp), { recursive: true });
      const [name, over] = opts.grab.split(':');
      const pose = POSES.find((p) => p.name.includes(name)) ?? POSES[0];
      await callApp(page, 'setPose', pose).catch(() => {});
      await settle(page, pose.settle ?? 30);
      for (const variant of over.split('|')) {
        const [k, patch] = variant.split('=');
        const target = k === 'lens' ? 'setLens' : k === 'weather' ? 'setWeather' : k;
        const obj = {};
        for (const pair of (patch ?? '').split(',')) {
          if (!pair) continue;
          const [kk, vv] = pair.split(':');
          obj[kk] = Number.isNaN(Number(vv)) ? vv : Number(vv);
        }
        await callApp(page, target, obj).catch((e) => say(`    ! ${target}: ${e.message}`));
        await settle(page, 4);
        const out = join(SHOTS, runStamp, `${name}__${variant.replace(/[^a-z0-9]+/gi, '_')}.png`);
        await shoot(page, out);
        say(`    ✓ ${variant}`);
        results.push({ name: variant, file: out });
      }
      writeIndex(runStamp, results, notes, opts);
      return;
    }

    if (opts.eval !== null) {
      const out = await page.evaluate(async (expr) => {
        try {
          // eslint-disable-next-line no-new-func
          const v = await new Function(`return (async () => (${expr}))()`)();
          return { ok: true, value: v === undefined ? null : v };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }, opts.eval);
      say(`\n  eval: ${opts.eval}`);
      say(`  result: ${JSON.stringify(out.ok ? out.value : { error: out.error }, null, 2)}\n`);
      if (!out.ok) { failed = true; notes.push(`eval threw: ${out.error}`); }
    } else if (opts.sequence) {
      // ---- curated sequence
      const dir = join(SHOTS, runStamp);
      mkdirSync(dir, { recursive: true });
      say(`  shots     ${POSES.length} poses -> shots/${runStamp}/`);

      let wanted = opts.poses.length ? POSES.filter((p) => opts.poses.some((w) => p.name.includes(w))) : POSES;
      if (opts.debugseq) {
        // One pose, every debug view, one run — strictly comparable, and it
        // rules out "the textures were empty that time" as an explanation.
        const pose = wanted[0];
        await callApp(page, 'setPose', pose).catch(() => {});
        await settle(page, pose.settle ?? 30);
        for (const mode of [0, 1, 2, 3, 4, 5]) {
          await callApp(page, 'setDebug', mode).catch(() => {});
          await settle(page, 3);
          const out = join(SHOTS, runStamp, `dbg-${mode}-${pose.name}.png`);
          await shoot(page, out);
          const names = ['full composite', 'resolved only', 'bloom only', 'dof only', 'tonemap no warp', 'no tonemap'];
          const r = await page.evaluate(async () => {
            const c = await window.__syzygy.capture();
            return c.length;
          }).catch(() => 0);
          say(`    ✓ dbg-${mode}  ${names[mode]}  (${(r / 1365).toFixed(0)}kB png)`);
          results.push({ name: `dbg-${mode}`, file: out });
        }
        await callApp(page, 'setDebug', 0).catch(() => {});
        wanted = [];
      }
      for (const pose of wanted) {
        const at = Date.now();
        try {
          if (pose.weather) {
            const r = await callApp(page, 'setWeather', pose.weather);
            if (!r.ok && !r.skipped) throw new Error(`setWeather: ${r.error}`);
          }
          if (pose.lens) await callApp(page, 'setLens', pose.lens);
          if (pose.time) await callApp(page, 'setTime', pose.time);

          const pr = await callApp(page, 'setPose', {
            position: pose.position, lookAt: pose.lookAt, fov: pose.fov, roll: pose.roll, name: pose.name,
          });
          if (!pr.ok) throw new Error(pr.skipped ? pr.reason : `setPose: ${pr.error}`);

          await settle(page, pose.settle ?? 24);
          const file = join(dir, `${pose.name}.png`);
          const ok = await shoot(page, file);
          if (!ok) throw new Error('screenshot produced no file');

          if (opts.debug) await callApp(page, 'setDebug', opts.debug).catch(() => {});
          const stats = await page.evaluate(() => (typeof window.__syzygy?.stats === 'function' ? window.__syzygy.stats() : null)).catch(() => null);
          results.push({ name: pose.name, label: pose.label, file: `shots/${runStamp}/${pose.name}.png`, ms: Date.now() - at, stats });
          say(`    ✓ ${pose.name.padEnd(18)} ${String(Date.now() - at).padStart(5)}ms  ${pose.label}`);
        } catch (err) {
          failed = true;
          results.push({ name: pose.name, label: pose.label, error: String(err?.message || err) });
          say(`    ✗ ${pose.name.padEnd(18)} ${String(err?.message || err).split('\n')[0]}`);
        }
      }

      const sheet = await contactSheet(dir, join(dir, '_contact-sheet.png'));
      if (sheet) { say(`    · contact sheet -> shots/${runStamp}/_contact-sheet.png`); results.push({ name: '_contact-sheet', file: `shots/${runStamp}/_contact-sheet.png` }); }
      else notes.push('ffmpeg unavailable — no contact sheet');

      writeIndex(runStamp, results, notes, opts);
    } else {
      // ---- single shot
      const file = join(SHOTS, `${runStamp}.png`);
      await settle(page, 45);
      const ok = await shoot(page, file);
      if (!ok) throw new CaptureError('screenshot produced no file');
      const stats = await page.evaluate(() => (typeof window.__syzygy?.stats === 'function' ? window.__syzygy.stats() : null)).catch(() => null);
      results.push({ name: runStamp, file: `shots/${runStamp}.png`, stats });
      writeIndex(runStamp, results, notes, opts);
      say(`\n  shot      shots/${runStamp}.png`);
      if (stats) say(`  stats     ${JSON.stringify(stats)}`);
    }

    if (pageErrors.length) notes.push(`page errors: ${pageErrors.slice(0, 3).join(' | ')}`);

    if (!opts.keepOpen) await ctx.close().catch(() => {});
  } catch (err) {
    failed = true;
    const msg = err instanceof CaptureError ? err.message : `${err?.name || 'Error'}: ${String(err?.message || err).split('\n')[0]}`;
    notes.push(msg);
    process.stderr.write(`\nFAIL  ${msg}\n`);
  } finally {
    try { await browser?.close(); } catch { /* noop */ }
  }

  // ---- summary
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  // Any GPU validation or WGSL compile error invalidates every screenshot in
  // the run — they will all be black or stale. Fail loudly instead of noting it
  // in the footer where it is easy to miss.
  const gpuErrors = notes.filter((n) => /webgpu|wgsl|ShaderModule|entry point/i.test(n));
  if (gpuErrors.length) {
    for (const g of gpuErrors) {
      say(`    !! ${g}`);
    }
    failed = true;
    notes.push(`run INVALIDATED by ${gpuErrors.length} GPU/shader error(s) — the shots above are not trustworthy`);
  }
  const okCount = results.filter((r) => !r.error).length;
  say('');
  say('─'.repeat(64));
  if (failed) {
    say(`  FAIL   ${okCount}/${results.length || 1} shot(s) · ${secs}s`);
    for (const n of notes) say(`    · ${String(n).split('\n').join('\n      ')}`);
  } else {
    say(`  PASS   ${okCount} shot(s) · ${secs}s`);
    for (const n of notes) say(`    · ${n}`);
  }
  say('─'.repeat(64));

  clearTimeout(watchdog);
  stopServer(server?.child);
  return failed ? 1 : 0;
}

function writeIndex(runStamp, results, notes, opts) {
  const stats = {};
  for (const r of results) if (r.stats && typeof r.stats === 'object') stats[r.name] = r.stats;
  const payload = {
    stamp: runStamp,
    when: new Date().toISOString(),
    mode: opts.sequence ? 'sequence' : 'single',
    quality: opts.quality || null,
    url: BASE,
    shots: results.map(({ name, file, ms, label, error }) => ({ name, file: file ?? null, ms: ms ?? null, label: label ?? null, error: error ?? null })),
    stats,
    notes,
  };
  writeFileSync(join(SHOTS, 'latest.json'), JSON.stringify(payload, null, 2), 'utf8');
}

process.exit(await main().catch((err) => {
  process.stderr.write(`\nFAIL  ${err?.message || err}\n`);
  return 1;
}));
