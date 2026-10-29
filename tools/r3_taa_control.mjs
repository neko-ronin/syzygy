#!/usr/bin/env node
/**
 * TAA on/off control — does the temporal pass change the image, and how?
 *
 * This is the control that found R3's real defect: the TAA history textures are
 * never written, so `post.wgsl` blends `mix(centerY, hist, 0.82)` against an
 * always-zero texture and the "temporal" pass is a per-frame edge crush that
 * darkens with local contrast. It was written by a reviewer inside `shots/`,
 * which is gitignored (D22) and gets pruned, so it now lives here.
 *
 * What it does, in one frozen scene:
 *
 *   A11 / A12   TAA on,  grain 0.10, ~30 frames apart   (grain-only floor)
 *   A21 / A22   TAA on,  grain 0,    ~60 frames apart   (must be md5-identical)
 *   B01 / B02   TAA off, grain 0,    ~60 frames apart   (must be md5-identical)
 *   A31         TAA back on
 *
 * A21 vs A22 and B01 vs B02 being *identical* proves the world is really frozen
 * and the frame is deterministic; A21 vs B01 is then the pass's whole effect.
 *
 *   node tools/r3_taa_control.mjs                    -> shots/r3-taa-control/<ts>/
 *   node tools/r3_taa_control.mjs --port=4185 --out=/tmp/taa
 *
 * Then measure with the same instrument as the probe:
 *
 *   node tools/measure_far_field.mjs --diff=<A21>,<B01>
 *   node tools/measure_far_field.mjs --contrast=<A21>,<B01>
 *
 * Boots its own `vite dev` and always tears it down. The capture harness uses
 * the dev server for a reason (PROCEDURES.md §1): a stale `preview` build
 * produces screenshots that look valid and are wrong.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const say = (m) => process.stdout.write(`${m}\n`);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
if (argv.includes('--help') || argv.includes('-h')) {
  say('usage: node tools/r3_taa_control.mjs [--port=4185] [--out=shots/r3-taa-control/<ts>]');
  process.exit(0);
}
const PORT = Number(arg('port', process.env.SYZYGY_TAA_PORT || 4185));
const OUT = resolve(ROOT, arg('out', join('shots', 'r3-taa-control', stamp())));
const BASE = `http://127.0.0.1:${PORT}`;

const portFree = () =>
  new Promise((res) => {
    const s = createConnection({ port: PORT, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); res(false); });
    s.once('error', () => res(true));
  });

if (!(await portFree())) {
  say(`  FAIL  something already answers on ${BASE}`);
  say(`        a control run must be this build; pass --port=<free port>`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
say(`  out       ${OUT}`);

// ---------------------------------------------------------------- server

const server = spawn(
  join(ROOT, 'node_modules', '.bin', 'vite'),
  ['dev', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } },
);
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const stopServer = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stopServer);

const up = await (async () => {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (await portFree().then((f) => !f)) return true;
    if (server.exitCode !== null) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
})();
if (!up) {
  stopServer();
  say(`  FAIL  vite dev did not come up on ${BASE}`);
  say(`        ${serverLog.trim().split('\n').slice(-4).join('\n        ')}`);
  process.exit(1);
}
say(`  server    dev on ${BASE}`);

// ---------------------------------------------------------------- browser

const { chromium } = await import('playwright');
const browser = await chromium.launch({
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
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().split('\n')[0]); });

await page.goto(`${BASE}/?seed=6191639&chunks=64&warm=400`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForFunction(() => window.__syzygy?.ready === true, null, { timeout: 60_000 });

const call = (m, ...a) =>
  page.evaluate(async ({ m, a }) => {
    const g = window.__syzygy;
    if (typeof g[m] !== 'function') return { skip: m };
    try { return { ok: await g[m](...a) }; } catch (e) { return { err: String(e.message) }; }
  }, { m, a });

/** Drive presented frames through rAF; the GPU must actually paint them. */
const frames = (n) =>
  page.evaluate(async (n) => {
    const g = window.__syzygy, start = g.frameCount;
    const deadline = Date.now() + Math.max(4000, n * 400);
    while (Date.now() < deadline && g.frameCount < start + n) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    return g.frameCount - start;
  }, n);

const shot = async (name) => {
  const r = await call('capture');
  if (typeof r.ok !== 'string') throw new Error(`${name}: capture returned ${JSON.stringify(r)}`);
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.ok.slice(r.ok.indexOf(',') + 1), 'base64'));
  const s = (await call('stats')).ok;
  const f = await page.evaluate(() => window.__syzygy.frameCount);
  say(`  shot      ${name.padEnd(24)} taa ${String(taaOn).padEnd(5)} frame ${String(f).padEnd(7)} ` +
      `tris ${s.triangles} starved ${s.lightDelivery.starved}`);
};

/**
 * `taaEnabled` is not in `stats()` and there is no `settings()` method; the
 * authoritative readout is the return value of `setQualityParams` itself, which
 * resolves to `renderer.settings`. Reading it back is what makes this a control
 * rather than an inference: a toggle that silently did not apply would leave
 * the "on" and "off" frames identical and the run would look like a null result.
 */
let taaOn = null;
const setTaa = async (enabled) => {
  const r = await call('setQualityParams', { taaEnabled: enabled });
  if (!r.ok || r.ok.taaEnabled !== enabled) {
    throw new Error(`taaEnabled:${enabled} did not take (${JSON.stringify(r)})`);
  }
  taaOn = r.ok.taaEnabled;
};

// ---------------------------------------------------------------- the pair

const POSE = { position: [323, 150, 506], lookAt: [-491, 280, -754], fov: 1.12, roll: 0 };

await call('setQuality', 'medium');
await setTaa(true);
await frames(12);
await call('setWeather', { sky: 'clear', cloudCover: 0.34, haze: 0.22, aerialHaze: 0.4, godRays: 0.55 });
await call('setLens', { tiltShift: 0.62, focusWidth: 0.34, fov: 1.12 });
const pr = await call('setPose', POSE);
if (pr.err) throw new Error(`setPose: ${pr.err}`);
await call('warm', 96, 400);
say(`  settle    pose ${await frames(30)} frames`);
await call('freezeCapture');
say(`  frozen    ${await frames(40)} extra frames`);

/**
 * `stats().camera.lookAt` is `position + forward * 400`, not the pose's lookAt,
 * so comparing the two vectors directly looks like a failed pose when the pose
 * is perfect. Compare the DIRECTION, as the capture harness does.
 */
const checkCamera = async () => {
  const c = (await call('stats')).ok.camera;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const dp = Math.hypot(...sub(c.position, POSE.position));
  const held = norm(sub(c.lookAt, c.position));
  const want = norm(sub(POSE.lookAt, POSE.position));
  const dot = Math.max(-1, Math.min(1, held[0] * want[0] + held[1] * want[1] + held[2] * want[2]));
  const deg = Math.acos(dot) * 180 / Math.PI;
  return { dp, deg, fov: c.fov, same: c.position.join() === POSE.position.join() };
};
const cam0 = await checkCamera();

await shot('A11-taa-on');
await frames(30);
await shot('A12-taa-on-plus30');
await call('setLens', { grain: 0 });
await frames(5);
await shot('A21-taa-on-grain0');
await frames(60);
await shot('A22-taa-on-grain0-plus60');
await setTaa(false);
await frames(5);
await shot('B01-taa-off-grain0');
await frames(60);
await shot('B02-taa-off-grain0-plus60');
await setTaa(true);
await frames(10);
await shot('A31-taa-back-on-grain0');

const cam1 = await checkCamera();
say('');
say(`  camera    position off ${cam0.dp.toFixed(3)}m, direction off ${cam0.deg.toFixed(3)} deg ` +
    `(fov ${cam0.fov.toFixed(4)}; speedFov biases it by design)`);
say(`  camera    identical start/end: ${cam0.dp === cam1.dp && cam0.deg === cam1.deg && cam0.fov === cam1.fov}`);
say(`  errors    ${errs.length ? errs.slice(0, 6).join(' | ') : 'none'}`);

await browser.close();
stopServer();

say('');
say('  measure now:');
say(`    node tools/measure_far_field.mjs --diff=${join(OUT, 'A21-taa-on-grain0.png')},${join(OUT, 'B01-taa-off-grain0.png')}`);
say(`    node tools/measure_far_field.mjs --contrast=${join(OUT, 'A21-taa-on-grain0.png')},${join(OUT, 'B01-taa-off-grain0.png')}`);
process.exit(errs.length ? 1 : 0);
