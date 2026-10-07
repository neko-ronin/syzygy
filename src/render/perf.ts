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
