#!/usr/bin/env node
/** No browser/GPU: exercise real counters, asynchronous readback lifecycle and benchmark evidence guards. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { cleanupOwnedResources, distribution, parseArgs, runControls, sourceProvenance, summarize } from './benchmark.mjs';

const source = readFileSync(new URL('../src/render/perf.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { FramePerf, GpuTimestampRing, accountEntityTriangles } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

// A fast callback loop cannot masquerade as rendered/submitted FPS.
const perf = new FramePerf(8192, 0);
for (let i = 0; i < 60; i++) perf.raf(i * (1000 / 60));
for (let i = 0; i < 15; i++) perf.submitted(i * (1000 / 15));
perf.completed(10, 990);
perf.cpu('simulation', 5, 991); perf.cpu('stream', 7, 992); perf.cpu('encode', 2, 993);
const snapshot = perf.snapshot(1000);
const summary = summarize(snapshot);
assert.equal(summary.callbacksPerSecond, 60);
assert.equal(summary.submittedFramesPerSecond, 15);
assert.equal(summary.completedFramesObservedPerSecond, 10);
assert.equal(summary.presentationFramesPerSecond, null);
assert.equal(summary.gpuTimestampMs, null, 'frame minus CPU must never appear as measured GPU time');
assert.equal(summary.cpuMs.simulation.mean, 5);
assert.equal(summary.cpuMs.stream.mean, 7);
assert.equal(summary.cpuMs.encode.mean, 2);
assert.equal(summary.completionNotificationLatencyMs.mean, 390,
  'completion notification includes queue wait and is separate from GPU duration');
assert.deepEqual(snapshot.samples.raf[0], { at: 0, intervalMs: null });
assert.equal('fps' in summary, false, 'no ambiguous rendered-FPS field');

// Completion promises may notify in a different callback order. A successful
// fence for N proves earlier submissions retired, and duplicate notifications
// must never count them again.
perf.completed(12, 1001); perf.completed(11, 1002); perf.completed(12, 1003);
assert.equal(perf.snapshot(1004).counters.completed, 12);
perf.failed(13); perf.failed(13);
assert.equal(perf.snapshot(1004).counters.failed, 1);
assert.equal(perf.snapshot(1004).counters.completed, 12, 'failed fence is not a completion');
const lifetime = perf.snapshot(1005).counters;
perf.reset(1010);
assert.deepEqual(perf.snapshot(1010).counters, lifetime, 'reset never rewinds lifetime counters');
perf.completed(15, 1011);
assert.equal(perf.snapshot(1012).counts.completed, 0,
  'retirement of old in-flight frames cannot inflate the new window throughput');
const id = perf.submitted(1020); assert.equal(id, 16);
perf.completed(id, 1030); perf.gpu(id, 2, 1031);
const resetWindow = perf.snapshot(1040);
assert.equal(resetWindow.counts.submitted, 1); assert.equal(resetWindow.counts.completed, 1);
assert.equal(resetWindow.samples.submitted[0].intervalMs, null);
assert.equal(resetWindow.samples.gpu[0].ms, 2);
perf.gpu(15, 4, 1032);
assert.equal(perf.snapshot(1040).samples.gpu.length, 1, 'old timestamp readback stays outside the new window');
assert.throws(() => perf.completed(99, 1040), /unknown frame/);
assert.throws(() => perf.submitted(1019), /backwards/);
assert.throws(() => perf.cpu('encode', -1, 1040), /duration/);
assert.throws(() => perf.snapshot(1009), /predates/);

// Bounded buffers report data loss rather than making an incomplete histogram
// look like a full traversal. Exported snapshots do not alias live samples.
const bounded = new FramePerf(2, 0);
for (const time of [10, 20, 30, 40]) bounded.raf(time);
const clipped = bounded.snapshot(50);
assert.deepEqual(clipped.samples.raf.map((s) => s.at), [30, 40]);
assert.equal(clipped.dropped.raf, 2); assert.equal(clipped.completeRawWindow, false);
clipped.samples.raf[0].at = 999;
assert.equal(bounded.snapshot(50).samples.raf[0].at, 30, 'snapshot mutation cannot rewrite stored evidence');
assert.equal(summarize(bounded.snapshot(50)).completeRawWindow, false);

// Simulate the real pacing defect: the last frame's entity totals must stay
// unchanged through arbitrarily many skipped attempts, even with stale counts.
for (const entityTriangles of [0, 12, 153600, 260400]) {
  const stats = { triangles: 100, entityTriangles: 0 };
  assert.equal(accountEntityTriangles(stats, entityTriangles, 10, 11), true);
  const once = { ...stats };
  for (let i = 0; i < 100; i++) assert.equal(accountEntityTriangles(stats, entityTriangles, 11, 11), false);
  assert.deepEqual(stats, once, 'skipped ticks cannot accumulate stale triangles');
  stats.triangles = 100; stats.entityTriangles = 0; // next encoded frame publishes fresh pass totals
  accountEntityTriangles(stats, entityTriangles, 11, 12);
  assert.deepEqual(stats, once, 'identical submitted scene reports identical per-frame totals');
}
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
assert.match(mainSource, /accountEntityTriangles\(this\.renderer\.stats, this\.pendingEntityTris, beforeSubmission, this\.renderer\.submittedFrames\)/,
  'the application must use the property-tested accounting boundary');
// Callback entry time: the rAF frame timestamp can predate a window reset.
assert.match(mainSource, /if \(isAnimationFrame\) this\.renderer\.perf\.raf\(performance\.now\(\)\)/);
assert.match(mainSource, /app\.tick\(performance\.now\(\), false\)/,
  'manual automation ticks must not be recorded as raw browser callbacks');

// Optional GPU timer uses one fixed ring, no extra submits, no synchronous
// waits, and never reuses a buffer while its mapAsync is pending.
globalThis.GPUBufferUsage = { QUERY_RESOLVE: 512, COPY_SRC: 4, COPY_DST: 8, MAP_READ: 1 };
globalThis.GPUMapMode = { READ: 1 };
const buffers = [], queries = [], calls = [];
const fakeDevice = {
  features: new Set(['timestamp-query']),
  createQuerySet(desc) { const query = { ...desc, destroyed: false, destroy() { this.destroyed = true; } }; queries.push(query); return query; },
  createBuffer(desc) {
    const buffer = { ...desc, data: new ArrayBuffer(desc.size), mapped: false, unmapped: false, destroyed: false,
      mapAsync() { this.mapped = true; return new Promise((resolve, reject) => { this.resolveMap = resolve; this.rejectMap = reject; }); },
      getMappedRange() { return this.data; }, unmap() { this.unmapped = true; }, destroy() { this.destroyed = true; } };
    buffers.push(buffer); return buffer;
  },
};
const encoder = { resolveQuerySet(...args) { calls.push(['resolve', ...args]); }, copyBufferToBuffer(...args) { calls.push(['copy', ...args]); } };
const gpuPerf = new FramePerf(8192, 0);
const timer = new GpuTimestampRing(fakeDevice, gpuPerf, 2);
assert.equal(timer.available, true); assert.equal(queries.length, 1); assert.equal(buffers.length, 3);
const a = timer.reserve(), b = timer.reserve();
assert.equal(timer.reserve(), null); assert.equal(timer.skipped, 1);
assert.throws(() => timer.resolve(encoder, a), /begin and end/);
assert.throws(() => timer.submitted(a, 1), /not resolved/);
assert.equal(timer.writes(a, 'begin').beginningOfPassWriteIndex, 0);
assert.equal(timer.writes(a, 'end').endOfPassWriteIndex, 1);
timer.resolve(encoder, a);
assert.throws(() => timer.resolve(encoder, a), /exactly once/);
assert.equal(timer.writes(b, 'both').beginningOfPassWriteIndex, 2);
timer.resolve(encoder, b);
assert.deepEqual(calls.filter((c) => c[0] === 'resolve').map((c) => c.at(-1)), [0, 256], 'query resolution offsets satisfy WebGPU 256-byte alignment');
const serialA = gpuPerf.submitted(0), serialB = gpuPerf.submitted(1);
assert.equal(timer.submitted(a, serialA), undefined, 'submission hook returns without awaiting GPU readback');
timer.submitted(b, serialB);
assert.equal(timer.reserve(), null, 'mapping slots remain unavailable');
gpuPerf.raf(2); // ordinary rendering can continue while readbacks wait
assert.equal(gpuPerf.snapshot(3).counters.raf, 1);
new BigUint64Array(buffers[1].data).set([1000000n, 3000000n]); buffers[1].resolveMap();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(buffers[1].unmapped, true);
assert.equal(gpuPerf.snapshot().samples.gpu[0].ms, 2, 'only actual timestamp difference produces GPU duration');
const reused = timer.reserve(); assert.equal(reused.slot, a.slot);
assert.throws(() => timer.writes(a, 'both'), /stale/);
timer.cancel(reused);
buffers[2].rejectMap(new Error('fixture device lost'));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(timer.failed, 1); assert.equal(gpuPerf.snapshot().samples.gpu.length, 1, 'failed readback cannot fabricate zero GPU time');
timer.destroy(); assert.equal(timer.reserve(), null);
assert.ok(buffers.every((b) => b.destroyed)); assert.ok(queries.every((q) => q.destroyed));
const unsupported = new GpuTimestampRing({ features: new Set() }, gpuPerf);
assert.equal(unsupported.available, false); assert.equal(unsupported.reserve(), null);

// Reject plausible-looking but inconsistent reports; preserve all raw tails.
assert.deepEqual(distribution([]), { count: 0, min: null, mean: null, p50: null, p95: null, p99: null, max: null });
assert.equal(distribution([1, 1, 1, 100]).max, 100);
assert.throws(() => distribution([NaN]), /invalid/);
for (const mutate of [
  (s) => { s.counters.completed = 999; },
  (s) => { s.window.durationMs = 100; },
  (s) => { s.counts.submitted = 60; },
  (s) => { s.dropped.raf = -1; },
  (s) => { s.dropped.raf = NaN; },
  (s) => { s.samples.cpu.stream[0].ms = -1; },
  (s) => { s.samples.cpu.encode[0].at = s.window.end + 1; },
  (s) => { s.samples.raf[0].intervalMs = 16.67; },
  (s) => { s.samples.raf[1].intervalMs = 1; },
  (s) => { s.completeRawWindow = false; },
]) {
  const broken = structuredClone(snapshot); mutate(broken);
  assert.throws(() => summarize(broken), Error, 'corrupt evidence cannot become a performance result');
}
const metadata = { adapter: 'fixture Apple M2', viewport: { width: 1600, height: 900, dpr: 1 },
  internal: { width: 1600, height: 900 }, canvas: { width: 1600, height: 900 },
  qualityOverride: 'high', settings: { tier: 'high', renderScale: 1, viewDistance: 7 } };
const run = { route: 'hero', start: { metadata }, end: { metadata }, observations: [{ metadata }], errors: [], summary };
assert.equal(runControls(run, { quality: 'high', adaptive: false }).valid, true);
const changed = structuredClone(run); changed.end.metadata.internal.width = 1200;
assert.equal(runControls(changed, { quality: 'high', adaptive: false }).valid, false);
changed.end.metadata.internal.width = 1600; changed.end.metadata.settings.tier = 'low';
assert.equal(runControls(changed, { quality: 'high', adaptive: false }).valid, false);
assert.equal(runControls(changed, { quality: 'high', adaptive: true }).valid, true, 'adaptive tier changes are disclosed, not mislabeled fixed');
assert.throws(() => parseArgs(['--force']), /unknown/);
assert.throws(() => parseArgs(['--seconds=0']), /5..60/);
assert.throws(() => parseArgs(['--quality=med']), /quality/);
assert.equal(parseArgs(['--plan', '--adaptive', '--headed']).headless, false);

const provenanceDir = mkdtempSync(join(tmpdir(), 'syzygy-runtime-hashes-'));
try {
  mkdirSync(join(provenanceDir, 'src'));
  const path = join(provenanceDir, 'src/new-worker.ts');
  writeFileSync(path, 'export const detail = 1;\n');
  const gitCalls = [];
  const gitFixture = (args) => {
    gitCalls.push(args);
    if (args[0] === 'ls-files') return 'src/new-worker.ts\0';
    if (args[0] === 'rev-parse') return 'fixed-revision\n';
    if (args[0] === 'status') return '?? src/new-worker.ts\n';
    if (args[0] === 'diff') return '';
    throw new Error('unexpected provenance command');
  };
  const before = sourceProvenance(provenanceDir, gitFixture);
  writeFileSync(path, 'export const detail = 2;\n');
  const after = sourceProvenance(provenanceDir, gitFixture);
  assert.equal(before.status, after.status, 'untracked filename/status can remain identical');
  assert.equal(before.trackedDiffSHA256, after.trackedDiffSHA256, 'tracked diff cannot see this untracked content mutation');
  assert.notEqual(before.runtimeContentSHA256['src/new-worker.ts'], after.runtimeContentSHA256['src/new-worker.ts'],
    'same-path untracked runtime edits must change end provenance');
  const enumeration = gitCalls.find((args) => args[0] === 'ls-files');
  for (const option of ['--cached', '--others', '--exclude-standard', '-z']) assert.ok(enumeration.includes(option),
    'runtime enumeration must include both tracked and non-ignored untracked files');
  for (const scope of ['src', 'server', 'tools/benchmark.mjs', 'tools/orchestrate.mjs', 'vite.config.ts']) assert.ok(enumeration.includes(scope));
} finally { rmSync(provenanceDir, { recursive: true, force: true }); }

const cleanupEvents = [];
let releaseBrowser, releaseServer;
const cleanup = cleanupOwnedResources({
  closeBrowser: () => { cleanupEvents.push('browser-close-start'); return new Promise((resolve) => { releaseBrowser = () => { cleanupEvents.push('browser-closed'); resolve(); }; }); },
  stopServer: () => { cleanupEvents.push('server-stop-start'); return new Promise((resolve) => { releaseServer = () => { cleanupEvents.push('server-exited'); resolve(); }; }); },
  release: () => cleanupEvents.push('lock-released'),
}, 1000);
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(cleanupEvents, ['browser-close-start'], 'signal cleanup must retain lock while Chrome is alive');
releaseBrowser(); await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(cleanupEvents, ['browser-close-start', 'browser-closed', 'server-stop-start']);
releaseServer(); await cleanup;
assert.deepEqual(cleanupEvents, ['browser-close-start', 'browser-closed', 'server-stop-start', 'server-exited', 'lock-released']);
for (const fail of ['browser', 'server']) {
  let released = false, stopped = false;
  await assert.rejects(cleanupOwnedResources({
    closeBrowser: async () => { if (fail === 'browser') throw new Error('fixture Chrome close rejected'); },
    stopServer: async () => { stopped = true; if (fail === 'server') throw new Error('fixture server exit unknown'); },
    release: () => { released = true; },
  }, 50), /GPU lock retained/);
  assert.equal(released, false, 'unknown resource shutdown cannot release the serialization claim');
  assert.equal(stopped, true, 'server shutdown is attempted even after browser close failure');
}
let timeoutReleased = false;
await assert.rejects(cleanupOwnedResources({ closeBrowser: () => new Promise(() => {}), stopServer: async () => {},
  release: () => { timeoutReleased = true; } }, 5), /timed out/);
assert.equal(timeoutReleased, false, 'bounded cleanup timeout fails closed');
console.log('ALL PASS: raw frame telemetry + benchmark evidence + nonblocking timestamp ring');
