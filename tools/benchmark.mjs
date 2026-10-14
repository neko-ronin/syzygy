#!/usr/bin/env node
/** Sustained raw-frame benchmark. Dev server only; same fail-closed preflight and GPU lock as captures. */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, preflight, releaseLock } from './orchestrate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TIERS = ['potato', 'low', 'medium', 'high', 'ultra'];
const ROUTES = ['hero', 'skyline', 'flight'];
// Held cameras outside `all`, so earlier `--route=all` reports stay comparable.
// garden: pose 13's camera in the green belt, where sheet D's terrace foliage is near (D30 session).
const EXTRA_ROUTES = ['garden'];
const FRAME_BUDGET_MS = 1000 / 60;

export function parseArgs(argv) {
  const opts = { route: 'all', quality: 'high', adaptive: false, headless: true,
    seconds: 30, warmSeconds: 20, port: 4174, seed: 6191639, chrome: '', output: '', plan: false, help: false,
    set: null, crowd: null, gpuPasses: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--adaptive') { opts.adaptive = true; continue; }
    if (arg === '--headed') { opts.headless = false; continue; }
    if (arg === '--plan') { opts.plan = true; continue; }
    if (arg === '--gpu-passes') { opts.gpuPasses = true; continue; }
    if (arg === '--help' || arg === '-h') { opts.help = true; continue; }
    const match = arg.match(/^--(route|quality|seconds|warm-seconds|port|seed|chrome|output|set|crowd)(?:=(.*))?$/);
    if (!match) throw new Error(`unknown benchmark option: ${arg}`);
    const value = match[2] ?? argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for --${match[1]}`);
    const key = { 'warm-seconds': 'warmSeconds' }[match[1]] ?? match[1];
    // `set`: quality-field overrides (A/B attribution), e.g. --set='{"cascades":2}'.
    opts[key] = ['seconds', 'warmSeconds', 'port', 'seed', 'crowd'].includes(key) ? Number(value)
      : key === 'set' ? JSON.parse(value) : value;
  }
  if (opts.crowd !== null && !(Number.isSafeInteger(opts.crowd) && opts.crowd >= 0)) throw new Error('crowd must be a nonnegative integer');
  if (opts.set !== null && (typeof opts.set !== 'object' || Array.isArray(opts.set))) throw new Error('set must be a JSON object of quality fields');
  if (!['all', ...ROUTES, ...EXTRA_ROUTES].includes(opts.route)) throw new Error('route must be hero, skyline, flight, garden or all');
  if (!TIERS.includes(opts.quality)) throw new Error(`quality must be ${TIERS.join('|')}`);
  if (!Number.isFinite(opts.seconds) || opts.seconds < 5 || opts.seconds > 60) throw new Error('seconds must be 5..60 per leg');
  if (!Number.isFinite(opts.warmSeconds) || opts.warmSeconds < 0 || opts.warmSeconds > 60) throw new Error('warm-seconds must be 0..60');
  if (!Number.isSafeInteger(opts.port) || opts.port < 1024 || opts.port > 65535) throw new Error('port must be an integer 1024..65535');
  if (!Number.isSafeInteger(opts.seed) || opts.seed < 0 || opts.seed > 2147483647) throw new Error('seed must be a nonnegative signed 32-bit decimal integer');
  return opts;
}

export function distribution(values) {
  if (values.some((v) => !Number.isFinite(v) || v < 0)) throw new Error('invalid raw timing sample');
  if (!values.length) return { count: 0, min: null, mean: null, p50: null, p95: null, p99: null, max: null };
  const sorted = values.slice().sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return { count: values.length, min: sorted[0], mean: values.reduce((a, b) => a + b, 0) / values.length,
    p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: sorted.at(-1) };
}

/** Validate monotonic accounting rather than accepting a plausible FPS field. */
export function summarize(snapshot) {
  if (snapshot.schemaVersion !== 1 || !Number.isFinite(snapshot.window?.durationMs) || snapshot.window.durationMs <= 0 ||
      !Number.isFinite(snapshot.window.start) || !Number.isFinite(snapshot.window.end) || snapshot.window.start < 0 ||
      snapshot.window.end - snapshot.window.start !== snapshot.window.durationMs) {
    throw new Error('missing or invalid raw performance window');
  }
  const { base, counters, counts, samples, dropped } = snapshot;
  for (const key of ['raf', 'submitted', 'completed', 'failed']) {
    if (![base?.[key], counters?.[key]].every((v) => Number.isSafeInteger(v) && v >= 0) || counters[key] < base[key]) {
      throw new Error(`non-monotonic ${key} counter`);
    }
  }
  if (counters.completed > counters.submitted || base.completed > base.submitted || counts.submitted !== counters.submitted - base.submitted ||
      counts.raf !== counters.raf - base.raf || counts.failed !== counters.failed - base.failed ||
      counts.completed !== Math.min(counts.submitted, Math.max(0, counters.completed - base.submitted)) ||
      counts.outstanding !== counters.submitted - counters.completed) throw new Error('inconsistent frame accounting');
  if (!dropped || Object.values(dropped).some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error('invalid dropped-sample accounting');
  const completeRaw = Object.values(dropped).every((n) => n === 0);
  if (snapshot.completeRawWindow !== completeRaw) throw new Error('incorrect raw-window completeness claim');
  for (const key of ['raf', 'submitted']) {
    if (!Array.isArray(samples[key]) || (completeRaw && samples[key].length !== counts[key])) throw new Error(`incomplete ${key} samples`);
    for (let i = 0; i < samples[key].length; i++) {
      const sample = samples[key][i];
      if (!Number.isFinite(sample.at) || sample.at < snapshot.window.start || sample.at > snapshot.window.end) throw new Error('sample outside window');
      if (completeRaw && i === 0 && sample.intervalMs !== null) throw new Error('first event must not borrow an interval from before the window');
      if (i > 0 && (sample.at < samples[key][i - 1].at || sample.intervalMs !== sample.at - samples[key][i - 1].at)) {
        throw new Error('interval does not match raw event clocks');
      }
    }
  }
  const validateDuration = (sample, field) => {
    if (!Number.isFinite(sample.at) || sample.at < snapshot.window.start || sample.at > snapshot.window.end ||
        (sample[field] !== null && (!Number.isFinite(sample[field]) || sample[field] < 0))) throw new Error('invalid duration or sample outside window');
  };
  for (const key of ['simulation', 'stream', 'encode']) {
    if (!Array.isArray(samples.cpu?.[key])) throw new Error('missing CPU scope samples');
    for (const sample of samples.cpu[key]) { validateDuration(sample, 'ms'); if (sample.ms === null) throw new Error('unknown CPU duration'); }
  }
  if (!Array.isArray(samples.completed) || !Array.isArray(samples.gpu)) throw new Error('missing completion/GPU samples');
  for (const sample of samples.completed) {
    validateDuration(sample, 'latencyMs');
    if (!Number.isSafeInteger(sample.serial) || sample.serial < 1 || sample.serial > counters.submitted) throw new Error('invalid completed submission serial');
  }
  for (const sample of samples.gpu) {
    validateDuration(sample, 'ms');
    if (sample.ms === null || !Number.isSafeInteger(sample.serial) || sample.serial <= base.submitted || sample.serial > counters.submitted) throw new Error('invalid GPU timestamp sample');
  }
  const intervals = (key) => samples[key].map((s) => s.intervalMs).filter((v) => v !== null);
  const submitIntervals = intervals('submitted');
  const elapsedSeconds = snapshot.window.durationMs / 1000;
  return {
    durationSeconds: elapsedSeconds, counts, completeRawWindow: completeRaw,
    callbacksPerSecond: counts.raf / elapsedSeconds,
    submittedFramesPerSecond: counts.submitted / elapsedSeconds,
    completedFramesObservedPerSecond: counts.completed / elapsedSeconds,
    presentationFramesPerSecond: null,
    rafIntervalMs: distribution(intervals('raf')), submissionIntervalMs: distribution(submitIntervals),
    submissionIntervalsOver16_67ms: submitIntervals.filter((v) => v > FRAME_BUDGET_MS).length,
    submissionIntervalsOver33_33ms: submitIntervals.filter((v) => v > FRAME_BUDGET_MS * 2).length,
    cpuMs: Object.fromEntries(['simulation', 'stream', 'encode'].map((key) => [key, distribution(samples.cpu[key].map((s) => s.ms))])),
    completionNotificationLatencyMs: distribution(samples.completed.map((s) => s.latencyMs).filter((v) => v !== null)),
    gpuTimestampMs: samples.gpu.length ? distribution(samples.gpu.map((s) => s.ms)) : null,
    limitations: [
      'Queue retirement is not display presentation. No presentation FPS is measured.',
      'Fence notification latency includes queue wait and callback scheduling; it is not GPU execution time.',
      ...(samples.gpu.length ? ['GPU timestamps cover only the explicitly bracketed pass range.'] : ['GPU timestamp timing unavailable; no frame-minus-CPU estimate is used.']),
      ...(!completeRaw ? ['Bounded raw buffers overflowed: this window is incomplete.'] : []),
      ...(counts.failed ? ['Queue completion rejected; this run cannot establish successful rendering throughput.'] : []),
    ],
  };
}

export function runControls(run, opts) {
  const reasons = [];
  const metadata = [run.start?.metadata, ...run.observations.map((s) => s.metadata), run.end?.metadata];
  if (metadata.some((m) => !m || m.viewport?.width !== 1600 || m.viewport?.height !== 900 || m.viewport?.dpr !== 1)) reasons.push('viewport/DPR target changed or unavailable');
  if (metadata.some((m) => !m || !Number.isSafeInteger(m.internal?.width) || !Number.isSafeInteger(m.internal?.height) || m.internal.width <= 0 || m.internal.height <= 0 || !m.adapter)) reasons.push('internal resolution/adapter unavailable');
  if (metadata.some((m) => /swiftshader|llvmpipe|software|unknown adapter/i.test(m?.adapter ?? ''))) reasons.push('target hardware adapter not established');
  if (!opts.adaptive && metadata.some((m) => m?.qualityOverride !== opts.quality || m?.settings?.tier !== opts.quality)) reasons.push('fixed quality changed');
  if (!opts.adaptive) {
    const start = metadata[0];
    const expected = { width: Math.round(1600 * start?.settings?.renderScale), height: Math.round(900 * start?.settings?.renderScale) };
    if (metadata.some((m) => m?.internal?.width !== expected.width || m?.internal?.height !== expected.height ||
        m?.canvas?.width !== expected.width || m?.canvas?.height !== expected.height ||
        m?.settings?.renderScale !== start?.settings?.renderScale)) reasons.push('fixed internal resolution changed or differs from declared scale');
  }
  if (run.errors.length) reasons.push('browser/GPU error reported');
  if (!run.summary.completeRawWindow || run.summary.counts.failed) reasons.push('raw accounting incomplete or queue completion failed');
  if (run.summary.counts.submitted < 2) reasons.push('no sustained frame submissions');
  if (run.route === 'flight' && run.observations.every((s) => s.chunk === run.start.chunk)) reasons.push('flight did not demonstrate a chunk boundary crossing');
  return { valid: reasons.length === 0, reasons, target: '60 frames/second, 16.67 ms budget; presentation rate remains unmeasured' };
}

export function sourceProvenance(repoRoot = ROOT, runGit) {
  const git = runGit ?? ((args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const modules = ['src/render/perf.ts', 'tools/benchmark.mjs', 'tools/__selftest_benchmark.mjs'];
  const runtimePaths = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
    'src', 'server', 'tools/benchmark.mjs', 'tools/orchestrate.mjs', 'index.html',
    'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts']).split('\0').filter(Boolean))].sort();
  return { revision: git(['rev-parse', 'HEAD']).trim(), status: git(['status', '--porcelain=v1']),
    trackedDiffSHA256: hash(git(['diff', 'HEAD', '--no-ext-diff', '--binary'])),
    relevantModuleSHA256: Object.fromEntries(modules.map((path) => [path, existsSync(join(repoRoot, path)) ? hash(readFileSync(join(repoRoot, path))) : null])),
    runtimeContentSHA256: Object.fromEntries(runtimePaths.map((path) => [path, existsSync(join(repoRoot, path)) ? hash(readFileSync(join(repoRoot, path))) : null])) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A failed/timeout close is not evidence that owned Chrome exited: retain the GPU claim. */
export async function cleanupOwnedResources({ closeBrowser, stopServer, release }, timeoutMs = 10000) {
  const bounded = async (operation, name) => {
    let timer;
    try {
      await Promise.race([operation(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} cleanup timed out`)), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  };
  const errors = [];
  try { await bounded(closeBrowser, 'browser'); } catch (error) { errors.push(String(error)); }
  try { await bounded(stopServer, 'server'); } catch (error) { errors.push(String(error)); }
  if (errors.length) throw new Error(`Cleanup incomplete; GPU lock retained. ${errors.join(' | ')}`);
  release();
}

async function stopOwnedServer(child) {
  if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    let killTimer, deadline;
    const done = (error) => {
      clearTimeout(killTimer); clearTimeout(deadline);
      child.off('exit', onExit); child.off('error', onError);
      error ? reject(error) : resolve();
    };
    const onExit = () => done(); const onError = (error) => done(error);
    child.once('exit', onExit); child.once('error', onError);
    child.kill('SIGTERM');
    killTimer = setTimeout(() => { child.kill('SIGKILL'); }, 3000);
    deadline = setTimeout(() => done(new Error('owned Vite process did not exit')), 6000);
  });
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer(); probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

async function startServer(port) {
  await assertPortFree(port);
  const child = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; let error = null;
  child.on('error', (e) => { error = e; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { log = (log + data).slice(-8000); });
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (error || child.exitCode !== null) throw new Error(`Vite failed: ${error ?? log}`);
      try { const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }); if (response.ok) return child; } catch { /* starting */ }
      await sleep(250);
    }
    throw new Error(`Vite did not become ready: ${log}`);
  } catch (e) { await stopOwnedServer(child); throw e; }
}

async function state(page) {
  return page.evaluate(() => {
    const app = window.__syzygy;
    const stats = app.stats(); const metadata = app.performanceMetadata();
    const size = metadata.city.chunkSize;
    return { at: performance.now(), metadata, camera: stats.camera, chunk: `${Math.floor(stats.camera.position[0] / size)},${Math.floor(stats.camera.position[2] / size)}`,
      residency: { count: stats.residentChunks, lod: stats.lodHistogram, rebakePending: stats.rebakePending },
      actors: { visibleCrowd: stats.crowd, population: stats.pop, crowdInstances: stats.crowdDebug?.instancesCount,
        activeTraffic: stats.traffic, trafficInstances: stats.trafficDraw?.instances },
      drawCalls: stats.drawCalls, triangles: stats.triangles, entityTriangles: stats.entityTriangles };
  });
}

async function runRoute(browser, route, opts, lifecycle) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  lifecycle.setContext(context);
  const watchdog = setTimeout(() => { void context.close(); }, 120000 + opts.warmSeconds * 1000 + opts.seconds * 2000);
  watchdog.unref();
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', (e) => { if (errors.length < 64) errors.push(String(e)); });
  page.on('console', (message) => { if (message.type() === 'error' && errors.length < 64) errors.push(`${message.text()} ${message.location()?.url ?? ''}`.trim()); });
  const bootStart = Date.now();
  try {
    lifecycle.throwIfCancelled();
    await page.goto(`http://127.0.0.1:${opts.port}/?seed=${opts.seed}&chunks=0&warm=0`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__syzygy?.ready === true, null, { timeout: 90000 });
    const readyMs = Date.now() - bootStart;
    await page.evaluate(({ quality, adaptive, set, crowd }) => {
      const app = window.__syzygy;
      for (const key of ['performanceSnapshot', 'performanceReset', 'performanceMetadata', 'setPaused', 'setPose', 'heroWalk']) {
        if (typeof app[key] !== 'function') throw new Error(`benchmark API missing: ${key}`);
      }
      app.setQuality(quality); if (adaptive) app.clearQualityOverride();
      if (set) app.setQualityParams(set);
      if (crowd !== null) app.setCrowdCount(crowd);
      app.setTime('noon');
      app.setWeather({ sky: 'clear', haze: 0.16, cloudCover: 0, wetness: 0 });
    }, opts);

    const from = [800, 220, 1200], to = [-800, 220, -1200];
    const setup = await page.evaluate(({ route, from }) => {
      const app = window.__syzygy; const setupStart = performance.now();
      let pose;
      if (route === 'hero') { pose = app.heroWalk(); if (!pose.ok) throw new Error(`hero unresolved: ${pose.reason}`); }
      else if (route === 'skyline') pose = { position: [900, 120, 1400], lookAt: [0, 200, 0], fov: 1.12, roll: 0 };
      else if (route === 'garden') pose = { position: [288.8, 14, 1013.0], lookAt: [243.9, 30, 1015.1], fov: 1.0, roll: 0 };
      else pose = { position: from, lookAt: [0, 180, 0], fov: 1.12, roll: 0 };
      app.setPose(pose); app.setPaused(false);
      return { pose, durationMs: performance.now() - setupStart };
    }, { route, from });
    // Natural streaming only. No manual ticks, synchronous warm(), or screenshot readbacks.
    const warmMs = route === 'flight' ? 0 : opts.warmSeconds * 1000;
    const warmStart = Date.now();
    // Cold boot: from the pose being set to nothing left to stream or re-bake,
    // under natural streaming, with the frame pacing of that window. Polled; the
    // measured window below is reset afterwards and is unaffected.
    let streamSettled = null;
    if (warmMs) {
      await page.evaluate(() => window.__syzygy.performanceReset());
      while (Date.now() - warmStart < warmMs) {
        lifecycle.throwIfCancelled();
        const st = await page.evaluate(() => { const s = window.__syzygy.stats(); return { resident: s.residentChunks, rebake: s.rebakePending, stream: s.streamPending }; });
        if (!streamSettled && st.resident > 0 && st.rebake === 0 && st.stream === 0) {
          const boot = summarize(await page.evaluate(() => window.__syzygy.performanceSnapshot()));
          streamSettled = { ms: Date.now() - warmStart, residentChunks: st.resident, submittedFramesPerSecond: boot.submittedFramesPerSecond,
            intervalsOver33ms: boot.submissionIntervalsOver33_33ms, simulationMaxMs: boot.cpuMs.simulation.max, streamMaxMs: boot.cpuMs.stream.max };
        }
        await page.waitForTimeout(200);
      }
    }
    const warmActualMs = Date.now() - warmStart;
    const start = await state(page);
    const observations = [];
    await page.evaluate((gpuPasses) => {
      window.__syzygy.performanceReset();
      if (gpuPasses && !window.__syzygy.gpuPassTiming(true)) throw new Error('gpu pass timing unavailable');
    }, opts.gpuPasses);
    const totalMs = opts.seconds * 1000 * (route === 'flight' ? 2 : 1);
    let flightPromise = null;
    if (route === 'flight') {
      // Wall-clock trajectory stays deterministic when the simulation's dt is
      // clamped. Positions are continuous; the second leg reverses at the endpoint.
      flightPromise = page.evaluate(({ from, to, legMs }) => new Promise((resolve) => {
        const app = window.__syzygy; app.setPaused(false);
        const started = performance.now();
        const frame = (now) => {
          const elapsed = Math.min(now - started, legMs * 2);
          const reverse = elapsed >= legMs;
          const t = reverse ? Math.max(0, 2 - elapsed / legMs) : elapsed / legMs;
          const position = from.map((v, i) => v + (to[i] - v) * t);
          const sign = reverse ? -1 : 1;
          const lookAt = position.map((v, i) => v + (to[i] - from[i]) * sign * 0.1);
          app.setPose({ position, lookAt, fov: 1.12, roll: 0 });
          if (elapsed < legMs * 2) requestAnimationFrame(frame);
          else resolve({ elapsedMs: now - started, position, reversed: true });
        };
        requestAnimationFrame(frame);
      }), { from, to, legMs: opts.seconds * 1000 });
      void flightPromise.catch(() => {}); // later await still reports failure; prevent an early unhandled rejection
    }
    const deadline = Date.now() + totalMs;
    while (Date.now() < deadline) {
      lifecycle.throwIfCancelled();
      await page.waitForTimeout(Math.min(1000, Math.max(1, deadline - Date.now())));
      observations.push(await state(page));
    }
    const trajectory = flightPromise ? await flightPromise : null;
    const raw = await page.evaluate(() => window.__syzygy.performanceSnapshot());
    // Instrumented runs carry their pass means and are marked as instrumented.
    const gpuPasses = opts.gpuPasses ? await page.evaluate(() => window.__syzygy.gpuPassTimes()) : null;
    const end = await state(page);
    const run = { route, setup: setup.pose, startup: { navigationToReadyMs: readyMs, setupDurationMs: setup.durationMs, bootPrewarmChunks: 0, warmMs, warmActualMs, streamSettled },
      routeDefinition: route === 'flight' ? { from, to, legSeconds: opts.seconds, reversal: true, metresPerSecond: Math.hypot(...from.map((v, i) => to[i] - v)) / opts.seconds,
        driver: 'wall-clock rAF pose trajectory; actor simulation active, no input or collision navigation', trajectory } : {
        stationaryCamera: true, normalHandheldMotion: true, simulationPaused: false, streamingActive: true },
      start, observations, end, raw, summary: summarize(raw), errors, gpuPasses, instrumented: opts.gpuPasses };
    run.controls = runControls(run, opts);
    return run;
  } finally { clearTimeout(watchdog); await context.close(); lifecycle.setContext(null); }
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log('node tools/benchmark.mjs [--route=all|hero|skyline|flight] [--quality=high] [--adaptive] [--seconds=30] [--warm-seconds=20] [--headed] [--chrome=/absolute/binary] [--output=/directory] [--plan]');
    return;
  }
  const routes = opts.route === 'all' ? ROUTES : [opts.route];
  if (opts.plan) { console.log(JSON.stringify({ ...opts, routes, viewport: [1600, 900], deviceScaleFactor: 1,
    target: { framesPerSecond: 60, frameBudgetMs: FRAME_BUDGET_MS }, requirements: ['known healthy preflight', 'exclusive shared GPU lock', 'dev server', 'installed browser, no downloads'], presentationFPS: 'unmeasured' }, null, 2)); return; }
  process.chdir(ROOT);
  const health = preflight();
  if (!health.ok) throw new Error(`benchmark preflight refused: ${health.problems.join(' | ')}`);
  if (!acquireLock('performance-benchmark')) throw new Error('benchmark refused: another GPU job holds the lock');
  let browser = null, server = null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = opts.output ? resolve(opts.output) : join(ROOT, 'benchmarks', stamp);
  const report = { schemaVersion: 1, createdAt: new Date().toISOString(), target: { machine: 'Apple M2, 16 GB, this Mac', viewport: [1600, 900], framesPerSecond: 60, frameBudgetMs: FRAME_BUDGET_MS },
    options: opts, health, browser: null, source: 'Vite dev server, no boot prewarm', sourceProvenance: null, runs: [], error: null };
  let cancelled = null, activeContext = null, signalInterruption = null;
  const throwIfCancelled = () => { if (cancelled) throw new Error(`benchmark cancelled by ${cancelled}`); };
  const onSignal = (signal) => {
    if (cancelled) return;
    cancelled = signal; process.exitCode = signal === 'SIGTERM' ? 143 : 130;
    // Close only the active page context to reject ongoing waits. The stored
    // promise is joined below; browser/server/lock cleanup has one final path.
    if (activeContext) signalInterruption = activeContext.close().catch(() => {});
  };
  const onSigint = () => onSignal('SIGINT'), onSigterm = () => onSignal('SIGTERM');
  process.once('SIGINT', onSigint); process.once('SIGTERM', onSigterm);
  try {
    report.sourceProvenance = sourceProvenance();
    const { chromium } = await import('playwright');
    const executablePath = opts.chrome ? resolve(opts.chrome) : chromium.executablePath();
    if (!existsSync(executablePath)) throw new Error(`installed browser not found: ${executablePath}; no browser will be downloaded`);
    const flags = ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--mute-audio'];
    server = await startServer(opts.port);
    throwIfCancelled();
    browser = await chromium.launch({ executablePath, headless: opts.headless, args: flags, timeout: 30000 });
    throwIfCancelled();
    const cdp = await browser.newBrowserCDPSession();
    const version = await cdp.send('Browser.getVersion'); await cdp.detach();
    report.browser = { executablePath, version: browser.version(), product: version.product, userAgent: version.userAgent, jsVersion: version.jsVersion,
      installedDistribution: executablePath.includes('Google Chrome for Testing') ? 'Google Chrome for Testing' : 'explicit installed executable; inspect path/product',
      headless: opts.headless, flags };
    mkdirSync(output, { recursive: true });
    for (const route of routes) {
      console.log(`benchmark ${route}: ${opts.adaptive ? 'adaptive from ' : 'fixed '}${opts.quality}, ${opts.headless ? 'headless' : 'headed'}`);
      const run = await runRoute(browser, route, opts, { setContext: (context) => { activeContext = context; }, throwIfCancelled }); report.runs.push(run);
      throwIfCancelled();
      writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
      console.log(`${route}: submitted ${run.summary.submittedFramesPerSecond.toFixed(2)}/s; p95 submission interval ${run.summary.submissionIntervalMs.p95?.toFixed(2) ?? 'unavailable'} ms; controls ${run.controls.valid ? 'valid' : 'INVALID'}`);
      if (!run.controls.valid) throw new Error(`invalid ${route} controls: ${run.controls.reasons.join(', ')}`);
    }
    report.sourceProvenanceEnd = sourceProvenance();
    report.sourceChanged = report.sourceProvenance.trackedDiffSHA256 !== report.sourceProvenanceEnd.trackedDiffSHA256 ||
      report.sourceProvenance.revision !== report.sourceProvenanceEnd.revision ||
      JSON.stringify(report.sourceProvenance.relevantModuleSHA256) !== JSON.stringify(report.sourceProvenanceEnd.relevantModuleSHA256) ||
      JSON.stringify(report.sourceProvenance.runtimeContentSHA256) !== JSON.stringify(report.sourceProvenanceEnd.runtimeContentSHA256);
    writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
    if (report.sourceChanged) throw new Error('source changed during benchmark; report is invalid for a fixed revision');
    console.log(`Saved ${join(output, 'report.json')}; presentation FPS unmeasured.`);
  } catch (error) {
    report.error = String(error?.stack ?? error); mkdirSync(output, { recursive: true });
    writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2)); throw error;
  } finally {
    try {
      await cleanupOwnedResources({ closeBrowser: async () => { if (browser) await browser.close(); await signalInterruption; },
        stopServer: () => stopOwnedServer(server), release: releaseLock });
    } catch (error) {
      report.cleanupError = String(error); mkdirSync(output, { recursive: true });
      writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2)); throw error;
    } finally {
      process.removeListener('SIGINT', onSigint); process.removeListener('SIGTERM', onSigterm);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error?.message ?? error); if (!process.exitCode) process.exitCode = 1; });
}
