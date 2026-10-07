/** Raw, bounded measurements. A callback, a submission and a retired queue are different events. */
export type CpuScope = 'simulation' | 'stream' | 'encode';

/** Skipped render attempts must leave the last submitted frame's triangle totals unchanged. */
export function accountEntityTriangles(
  stats: { triangles: number; entityTriangles: number }, triangles: number, before: number, after: number,
): boolean {
  if (after <= before) return false;
  stats.triangles += triangles;
  stats.entityTriangles += triangles;
  return true;
}
interface Timed { at: number }
interface IntervalSample extends Timed { intervalMs: number | null }
interface CpuSample extends Timed { ms: number }
interface CompletionSample extends Timed { serial: number; latencyMs: number | null }
interface GpuSample extends Timed { serial: number; ms: number }

class Samples<T> {
  private values: T[] = [];
  private head = 0;
  dropped = 0;
  constructor(private readonly capacity: number) {}
  push(value: T): void {
    if (this.values.length < this.capacity) this.values.push(value);
    else { this.values[this.head] = value; this.head = (this.head + 1) % this.capacity; this.dropped++; }
  }
  all(): T[] { return this.values.slice(this.head).concat(this.values.slice(0, this.head)).map((value) => ({ ...value })); }
  clear(): void { this.values = []; this.head = 0; this.dropped = 0; }
}

export class FramePerf {
  private rafCount = 0;
  private submitCount = 0;
  private completeWatermark = 0;
  private failedCount = 0;
  private lastRaf: number | null = null;
  private lastSubmit: number | null = null;
  private windowAt: number;
  private base = { raf: 0, submitted: 0, completed: 0, failed: 0 };
  private pending = new Map<number, number>();
  private pendingTimingsDropped = 0;
  private readonly rafSamples: Samples<IntervalSample>;
  private readonly submitSamples: Samples<IntervalSample>;
  private readonly completionSamples: Samples<CompletionSample>;
  private readonly gpuSamples: Samples<GpuSample>;
  private readonly cpuSamples: Record<CpuScope, Samples<CpuSample>>;

  constructor(private readonly capacity = 8192, at = performance.now()) {
    if (!Number.isSafeInteger(capacity) || capacity < 2) throw new Error('perf capacity must be an integer >= 2');
    this.windowAt = this.time(at);
    this.rafSamples = new Samples(capacity);
    this.submitSamples = new Samples(capacity);
    this.completionSamples = new Samples(capacity);
    this.gpuSamples = new Samples(capacity);
    this.cpuSamples = { simulation: new Samples(capacity), stream: new Samples(capacity), encode: new Samples(capacity) };
  }

  private time(at: number): number {
    if (!Number.isFinite(at) || at < 0) throw new Error('invalid performance clock');
    return at;
  }
  private interval(at: number, previous: number | null): number | null {
    this.time(at);
    if (previous !== null && at < previous) throw new Error('performance clock moved backwards');
    return previous === null ? null : at - previous;
  }
  private serial(serial: number): void {
    if (!Number.isSafeInteger(serial) || serial < 1 || serial > this.submitCount) throw new Error('unknown frame submission');
  }

  raf(at = performance.now()): void {
    const intervalMs = this.interval(at, this.lastRaf);
    this.rafCount++; this.lastRaf = at;
    this.rafSamples.push({ at, intervalMs });
  }

  /** Call only after queue.submit succeeds. No extra queue submission or fence is created here. */
  submitted(at = performance.now()): number {
    const intervalMs = this.interval(at, this.lastSubmit);
    const serial = ++this.submitCount;
    this.lastSubmit = at;
    this.submitSamples.push({ at, intervalMs });
    if (this.pending.size >= this.capacity) {
      this.pending.delete(this.pending.keys().next().value!);
      this.pendingTimingsDropped++;
    }
    this.pending.set(serial, at);
    return serial;
  }

  /** A successful fence for serial N proves all frame submissions through N have retired. */
  completed(serial: number, at = performance.now()): void {
    this.serial(serial); this.time(at);
    if (serial <= this.completeWatermark) return;
    const submittedAt = this.pending.get(serial);
    if (submittedAt !== undefined && at < submittedAt) throw new Error('completion predates submission');
    this.completeWatermark = serial;
    for (const id of this.pending.keys()) if (id <= serial) this.pending.delete(id);
    this.completionSamples.push({ at, serial, latencyMs: submittedAt === undefined ? null : at - submittedAt });
  }

  /** Rejected fences are failures, never successful completions. */
  failed(serial: number): void {
    this.serial(serial);
    if (this.pending.delete(serial)) this.failedCount++;
  }

  /** Non-overlapping scopes: encode excludes stream; simulation ends before render begins. */
  cpu(scope: CpuScope, ms: number, at = performance.now()): void {
    this.time(at);
    if (!Number.isFinite(ms) || ms < 0) throw new Error('invalid CPU duration');
    this.cpuSamples[scope].push({ at, ms });
  }

  gpu(serial: number, ms: number, at = performance.now()): void {
    this.serial(serial); this.time(at);
    if (!Number.isFinite(ms) || ms < 0) throw new Error('invalid GPU timestamp duration');
    // A delayed readback from before this sampling window is not part of the window.
    if (serial > this.base.submitted) this.gpuSamples.push({ at, serial, ms });
  }

  /** Clears samples, never monotonic lifetime counters or in-flight queue state. */
  reset(at = performance.now()): void {
    this.windowAt = this.time(at);
    this.base = this.counters(); this.lastRaf = null; this.lastSubmit = null;
    this.rafSamples.clear(); this.submitSamples.clear(); this.completionSamples.clear(); this.gpuSamples.clear();
    for (const samples of Object.values(this.cpuSamples)) samples.clear();
    this.pendingTimingsDropped = 0;
  }

  private counters() {
    return { raf: this.rafCount, submitted: this.submitCount, completed: this.completeWatermark, failed: this.failedCount };
  }

  snapshot(at = performance.now()) {
    this.time(at);
    if (at < this.windowAt) throw new Error('snapshot predates sampling window');
    const counters = this.counters();
    const submitted = counters.submitted - this.base.submitted;
    const dropped = {
      raf: this.rafSamples.dropped, submitted: this.submitSamples.dropped,
      completed: this.completionSamples.dropped, gpu: this.gpuSamples.dropped,
      simulation: this.cpuSamples.simulation.dropped, stream: this.cpuSamples.stream.dropped,
      encode: this.cpuSamples.encode.dropped, pendingTimings: this.pendingTimingsDropped,
    };
    return {
      schemaVersion: 1, window: { start: this.windowAt, end: at, durationMs: at - this.windowAt },
      base: { ...this.base }, counters,
      counts: {
        raf: counters.raf - this.base.raf, submitted,
        completed: Math.min(submitted, Math.max(0, counters.completed - this.base.submitted)),
        failed: counters.failed - this.base.failed, outstanding: counters.submitted - counters.completed,
      },
      dropped, completeRawWindow: Object.values(dropped).every((n) => n === 0),
      samples: {
        raf: this.rafSamples.all(), submitted: this.submitSamples.all(), completed: this.completionSamples.all(),
        cpu: { simulation: this.cpuSamples.simulation.all(), stream: this.cpuSamples.stream.all(), encode: this.cpuSamples.encode.all() },
        gpu: this.gpuSamples.all(),
      },
    };
  }
}

/** Optional timestamps. Skip sampling when all slots are mapping; never wait in the render loop. */
export class GpuTimestampRing {
  readonly available: boolean;
  private query: GPUQuerySet | null = null;
  private resolveBuffer: GPUBuffer | null = null;
  private slots: {
    buffer: GPUBuffer; state: 'free' | 'reserved' | 'mapping'; generation: number;
    begin: boolean; end: boolean; resolved: boolean;
  }[] = [];
  skipped = 0;
  failed = 0;
  private disposed = false;

  constructor(device: GPUDevice, private readonly perf: FramePerf, slotCount = 4) {
    if (!Number.isSafeInteger(slotCount) || slotCount < 1 || slotCount > 32) throw new Error('timestamp slots must be 1..32');
    this.available = device.features.has('timestamp-query');
    if (!this.available) return;
    this.query = device.createQuerySet({ type: 'timestamp', count: slotCount * 2, label: 'perf-timestamps' });
    this.resolveBuffer = device.createBuffer({ size: slotCount * 256, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    this.slots = Array.from({ length: slotCount }, () => ({
      buffer: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
      state: 'free', generation: 0, begin: false, end: false, resolved: false,
    }));
  }

  reserve(): { slot: number; generation: number } | null {
    if (!this.available || this.disposed) return null;
    const slot = this.slots.findIndex((s) => s.state === 'free');
    if (slot < 0) { this.skipped++; return null; }
    const entry = this.slots[slot]; entry.state = 'reserved'; entry.generation++;
    entry.begin = false; entry.end = false; entry.resolved = false;
    return { slot, generation: entry.generation };
  }

  private entry(token: { slot: number; generation: number }) {
    const entry = this.slots[token.slot];
    if (!entry || entry.generation !== token.generation || entry.state !== 'reserved' || this.disposed) throw new Error('stale timestamp reservation');
    return entry;
  }

  /** Attach begin to the first pass, end to the last pass; both is valid for a single-pass range. */
  writes(token: { slot: number; generation: number }, edge: 'begin' | 'end' | 'both'): GPURenderPassTimestampWrites {
    const entry = this.entry(token);
    if (entry.resolved) throw new Error('timestamp range already resolved');
    if (edge !== 'end') entry.begin = true;
    if (edge !== 'begin') entry.end = true;
    return {
      querySet: this.query!,
      ...(edge !== 'end' ? { beginningOfPassWriteIndex: token.slot * 2 } : {}),
      ...(edge !== 'begin' ? { endOfPassWriteIndex: token.slot * 2 + 1 } : {}),
    };
  }

  /** Encode after the timed range, before the same frame's submit. Offset alignment is 256 bytes. */
  resolve(encoder: GPUCommandEncoder, token: { slot: number; generation: number }): void {
    const entry = this.entry(token);
    if (!entry.begin || !entry.end || entry.resolved) throw new Error('timestamp range needs begin and end exactly once before resolve');
    encoder.resolveQuerySet(this.query!, token.slot * 2, 2, this.resolveBuffer!, token.slot * 256);
    encoder.copyBufferToBuffer(this.resolveBuffer!, token.slot * 256, entry.buffer, 0, 16);
    entry.resolved = true;
  }

  cancel(token: { slot: number; generation: number }): void { this.entry(token).state = 'free'; }

  /** Call after successful queue.submit. mapAsync retires asynchronously and the buffer is not reused until unmap. */
  submitted(token: { slot: number; generation: number }, serial: number): void {
    const entry = this.entry(token);
    if (!entry.resolved) throw new Error('timestamp range was not resolved');
    entry.state = 'mapping';
    void entry.buffer.mapAsync(GPUMapMode.READ).then(() => {
      if (!this.disposed) {
        const values = new BigUint64Array(entry.buffer.getMappedRange());
        if (values[1] < values[0]) this.failed++;
        else this.perf.gpu(serial, Number(values[1] - values[0]) / 1e6);
      }
    }).catch(() => { this.failed++; }).finally(() => {
      try { entry.buffer.unmap(); } catch { /* device lost/disposed */ }
      entry.state = 'free';
    });
  }

  destroy(): void {
    this.disposed = true;
    this.query?.destroy(); this.resolveBuffer?.destroy();
    for (const entry of this.slots) entry.buffer.destroy();
  }
}

/**
 * Opt-in per-pass GPU timing, for attributing frame cost before an
 * optimisation is chosen. While enabled, every pass on the frame encoder gets
 * begin/end timestamps under its own label; one resolve per frame, readback
 * through a small pool that skips frames instead of stalling. Chrome quantizes
 * timestamps (~100 µs), so only means over many frames are meaningful.
 */
export class GpuPassTimer {
  private readonly query: GPUQuerySet;
  private readonly resolveBuf: GPUBuffer;
  private readonly reads: { buf: GPUBuffer; busy: boolean; labels: string[] }[];
  private labels: string[] = [];
  private readonly sums = new Map<string, number>();
  frames = 0;
  skipped = 0;
  failed = 0;

  constructor(device: GPUDevice, private readonly max = 32) {
    this.query = device.createQuerySet({ type: 'timestamp', count: max * 2, label: 'pass-timestamps' });
    this.resolveBuf = device.createBuffer({ size: max * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    this.reads = Array.from({ length: 3 }, () => ({
      buf: device.createBuffer({ size: max * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
      busy: false, labels: [],
    }));
  }

  /** Give every pass this encoder begins a labelled timestamp pair. */
  instrument(enc: GPUCommandEncoder): void {
    this.labels = [];
    const writes = (label?: string) => {
      const i = this.labels.length;
      if (i >= this.max) return undefined;
      this.labels.push(label ?? `pass${i}`);
      return { querySet: this.query, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 };
    };
    const render = enc.beginRenderPass.bind(enc);
    const compute = enc.beginComputePass.bind(enc);
    enc.beginRenderPass = (d) => render({ ...d, timestampWrites: writes(d.label) });
    enc.beginComputePass = (d = {}) => compute({ ...d, timestampWrites: writes(d.label) });
  }

  /** Before finish. Returns the readback to hand to `collect` after submit. */
  resolve(enc: GPUCommandEncoder): { buf: GPUBuffer; busy: boolean; labels: string[] } | null {
    const n = this.labels.length;
    if (n === 0) return null;
    const r = this.reads.find((x) => !x.busy);
    if (!r) { this.skipped++; return null; }
    enc.resolveQuerySet(this.query, 0, n * 2, this.resolveBuf, 0);
    enc.copyBufferToBuffer(this.resolveBuf, 0, r.buf, 0, n * 16);
    r.busy = true;
    r.labels = this.labels;
    return r;
  }

  collect(r: { buf: GPUBuffer; busy: boolean; labels: string[] } | null): void {
    if (!r) return;
    void r.buf.mapAsync(GPUMapMode.READ).then(() => {
      const v = new BigUint64Array(r.buf.getMappedRange(), 0, r.labels.length * 2);
      // Incremental completion (this end minus the previous end), not end minus
      // begin: Apple's tiled GPU pipelines passes, so begin is sampled long before
      // a pass's own work and begin-to-end spans overlap (measured: ten post
      // passes each "took" 12.9 ms of a 21.6 ms frame).
      const frame = new Map<string, number>();
      let prevEnd = v[0];
      for (let i = 0; i < r.labels.length; i++) {
        const end = v[i * 2 + 1];
        if (end < v[i * 2]) { this.failed++; return; }
        const inc = end > prevEnd ? Number(end - prevEnd) / 1e6 : 0;
        if (end > prevEnd) prevEnd = end;
        frame.set(r.labels[i], (frame.get(r.labels[i]) ?? 0) + inc);
      }
      frame.set('_span', Number(v[r.labels.length * 2 - 1] - v[0]) / 1e6);
      for (const [k, ms] of frame) this.sums.set(k, (this.sums.get(k) ?? 0) + ms);
      this.frames++;
    }).catch(() => { this.failed++; }).finally(() => {
      try { r.buf.unmap(); } catch { /* device lost */ }
      r.busy = false;
    });
  }

  /** Mean ms per frame for each pass label; `_span` is first begin to last end. */
  results(): { frames: number; skipped: number; failed: number; meanMs: Record<string, number> } {
    const meanMs: Record<string, number> = {};
    for (const [k, ms] of this.sums) meanMs[k] = +(ms / Math.max(1, this.frames)).toFixed(3);
    return { frames: this.frames, skipped: this.skipped, failed: this.failed, meanMs };
  }

  destroy(): void {
    this.query.destroy();
    this.resolveBuf.destroy();
    for (const r of this.reads) if (!r.busy) r.buf.destroy();
  }
}
