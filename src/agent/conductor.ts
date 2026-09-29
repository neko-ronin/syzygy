/**
 * The conductor's conversation loop.
 *
 * Talks to a small dev-server endpoint (`/api/chat`) which proxies the
 * Anthropic Messages API and relays SSE. Tool calls come back as SSE events,
 * are executed *locally* against the world, and the results are posted back —
 * repeating until the model stops calling tools.
 *
 * With no API key configured the server answers `{needsKey:true}` and this
 * module falls through to `localBrain`, which emits the same tool calls. The
 * simulation is therefore fully explorable with zero setup.
 */

import { ToolExecutor, type ToolCall } from './tools';

/** A tool call on the wire, carrying the block id the API needs for the result. */
type WireCall = ToolCall & { id: string };
import { localBrain } from './localbrain';
import type { WorldState } from '../core/state';

export const DEFAULT_MODEL = 'claude-sonnet-4-5';
export const DEFAULT_ENDPOINT = '/api/chat';
const MAX_ITERATIONS = 6;
const REQUEST_TIMEOUT_MS = 120_000;

/** One turn of an Anthropic-style message list, verbatim for the proxy. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

/** SSE payloads the server emits. */
export type ConductorEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done'; stopReason?: string; usage?: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { type: 'needsKey'; model?: string };

export interface ConductorHandlers {
  /** Streaming assistant text. */
  onText?(delta: string): void;
  /** Called before a tool runs, so the UI can show a chip. */
  onToolStart?(call: ToolCall): void;
  /** Called after, with the executor's reply (an `ERROR:` string on failure). */
  onToolEnd?(call: ToolCall, result: string): void;
  /** Final assistant text for the turn, after streaming. */
  onDone?(text: string): void;
  onError?(message: string): void;
  /** True once we know whether the LLM is reachable; drives a mode badge. */
  onModeChange?(mode: ConductorMode): void;
}

export type ConductorMode = 'llm' | 'local';

export interface ConductorOptions {
  endpoint?: string;
  model?: string;
  maxIterations?: number;
  /** Injected for tests / for the capture harness. */
  fetchImpl?: typeof fetch;
}

const SYSTEM_PROMPT = `You are the Conductor of SYZYGY, a dreamscape city that runs continuously in a browser.

You are a film director, not a chatbot. The user is a director on your set; they describe what they want to feel and you stage it.

How to work:
- Never describe what is already on screen unless asked. Act first, speak second.
- Prefer a tool call over a description of a tool call. "Make it rain" is a set_weather call, not an essay about rain.
- Use describe_world before answering any question about the current state, so you are never guessing.
- Combine calls for a single request (weather + time + camera) rather than asking permission for each.
- Use tour for anything the user could name as a place or a shot (canyon, skyline, canal, ground, orbit). It is authored and looks better than a hand-rolled flyTo.
- Change a little at a time unless asked for a spectacle. Ease, do not snap.
- Vary the lens: tilt-shift for miniature, long lens for compression, wide for vertigo, warp when the user wants the city to stop being believable.
- Your reply is one or two short sentences, in character. Never list what you called. Never use bullet points. Never apologise.
- If a request is impossible with these tools, do the nearest thing and say so in one line.`;

export class Conductor {
  private readonly executor: ToolExecutor;
  private readonly worldRef: WorldState;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly maxIter: number;
  private readonly fetchImpl: typeof fetch;
  private readonly messages: ChatMessage[] = [];
  private mode: ConductorMode = 'llm';
  private controller: AbortController | null = null;
  private busy = false;

  constructor(executor: ToolExecutor, world: WorldState, opts: ConductorOptions = {}) {
    this.executor = executor;
    this.worldRef = world;
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.maxIter = opts.maxIterations ?? MAX_ITERATIONS;
    const f = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
    if (!f) throw new Error('Conductor needs a fetch implementation');
    this.fetchImpl = f;
  }

  getMode(): ConductorMode { return this.mode; }
  getBusy(): boolean { return this.busy; }
  /** Full transcript, for debugging and for `POST /api/state`. */
  getTranscript(): ChatMessage[] { return this.messages.slice(); }
  /** Drop the transcript without touching world state. */
  reset(): void { this.messages.length = 0; }

  /** Cancel an in-flight turn. */
  abort(): void {
    this.controller?.abort();
    this.controller = null;
  }

  /**
   * Handle one user utterance: run the tool loop if the LLM is reachable,
   * otherwise delegate to the local brain. Never throws.
   */
  async send(text: string, handlers: ConductorHandlers = {}): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.busy) return;
    this.busy = true;
    try {
      if (this.mode === 'local') {
        await this.runLocal(trimmed, handlers);
        return;
      }
      await this.runRemote(trimmed, handlers);
    } catch (err) {
      if (isAbort(err)) { handlers.onDone?.(''); return; }
      handlers.onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy = false;
      this.controller = null;
    }
  }

  // ------------------------------------------------------------ local path

  private async runLocal(text: string, handlers: ConductorHandlers): Promise<void> {
    const cam = this.executor.camera.position();
    const plan = localBrain(text, this.worldRef, cam);
    // Stream the reply word by word so the local path feels alive too.
    for (const word of plan.text.split(/(\s+)/)) {
      if (this.busy === false) break;
      handlers.onText?.(word);
      await tick(14);
    }
    await this.executeAll(plan.calls, handlers);
    handlers.onDone?.(plan.text);
  }

  // ------------------------------------------------------------ remote path

  private async runRemote(text: string, handlers: ConductorHandlers): Promise<void> {
    this.messages.push({ role: 'user', content: text });
    let finalText = '';

    for (let iter = 0; iter < this.maxIter; iter++) {
      const turn = await this.streamTurn(handlers);
      if (turn.error) { handlers.onError?.(turn.error); return; }
      if (turn.needsKey) {
        // Server has no key configured. Roll the user message back out of the
        // transcript (nothing was sent) and handle it locally from here on.
        this.messages.pop();
        this.setMode('local', handlers);
        await this.runLocal(text, handlers);
        return;
      }
      if (turn.stopped) return;
      finalText = turn.text || finalText;

      if (turn.calls.length === 0) break;

      this.messages.push({ role: 'assistant', content: turn.blocks });
      const results: ContentBlock[] = [];
      for (const call of turn.calls) {
        const result = await this.executeCall(call, handlers);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: result, is_error: result.startsWith('ERROR:') });
      }
      this.messages.push({ role: 'user', content: results });
      if (iter === this.maxIter - 1) {
        handlers.onError?.(`Stopped after ${this.maxIter} tool rounds.`);
      }
    }

    handlers.onDone?.(finalText);
  }

  private async streamTurn(handlers: ConductorHandlers): Promise<{
    text: string; calls: WireCall[]; blocks: ContentBlock[];
    stopped: boolean; needsKey: boolean; error?: string;
  }> {
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let text = '';
    const calls: WireCall[] = [];

    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({
          system: SYSTEM_PROMPT,
          model: this.model,
          messages: this.messages,
          tools: this.executor.list(),
          world: this.worldRef,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await safeText(res);
        return { text, calls, blocks: [], stopped: false, needsKey: false, error: `conductor: ${res.status} ${detail}` };
      }

      // Content negotiation: the server may answer JSON (needsKey) or SSE.
      const ctype = res.headers.get('content-type') ?? '';
      if (ctype.includes('application/json')) {
        const body = (await res.json()) as { needsKey?: boolean; message?: string };
        if (body?.needsKey) return { text, calls, blocks: [], stopped: false, needsKey: true };
        if (body?.message) return { text, calls, blocks: [], stopped: false, needsKey: false, error: body.message };
        return { text, calls, blocks: [], stopped: false, needsKey: false, error: 'conductor: empty response' };
      }

      for await (const ev of readSse(res)) {
        switch (ev.type) {
          case 'text':
            text += ev.delta;
            handlers.onText?.(ev.delta);
            break;
          case 'tool':
            calls.push({ id: ev.id, name: ev.name, input: ev.input });
            break;
          case 'error':
            return { text, calls, blocks: [], stopped: false, needsKey: false, error: ev.message };
          case 'done':
            break;
          case 'needsKey':
            return { text, calls, blocks: [], stopped: false, needsKey: true };
        }
      }
    } catch (err) {
      if (isAbort(err)) return { text, calls, blocks: [], stopped: true, needsKey: false };
      // Network or dev-server failure: degrade rather than dead-end.
      this.setMode('local', handlers);
      handlers.onError?.(`Conductor server unreachable (${err instanceof Error ? err.message : String(err)}). Using the local brain.`);
      const cam = this.executor.camera.position();
      const plan = localBrain(this.lastUserText(), this.worldRef, cam);
      for (const word of plan.text.split(/(\s+)/)) handlers.onText?.(word);
      await this.executeAll(plan.calls, handlers);
      handlers.onDone?.(plan.text);
      return { text, calls, blocks: [], stopped: true, needsKey: false };
    } finally {
      clearTimeout(timer);
    }

    const blocks: ContentBlock[] = [];
    if (text) blocks.push({ type: 'text', text });
    for (const c of calls) {
      blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
    }
    return { text, calls, blocks, stopped: false, needsKey: false };
  }

  private lastUserText(): string {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.role === 'user' && typeof m.content === 'string') return m.content;
      if (m.role === 'user' && Array.isArray(m.content)) {
        const t = m.content.find((b) => b.type === 'text');
        if (t && t.type === 'text') return t.text;
      }
    }
    return '';
  }

  private setMode(mode: ConductorMode, handlers: ConductorHandlers): void {
    if (this.mode === mode) return;
    this.mode = mode;
    handlers.onModeChange?.(mode);
  }

  // ------------------------------------------------------------ execution

  private async executeAll(calls: ToolCall[], handlers: ConductorHandlers): Promise<string[]> {
    const out: string[] = [];
    for (const call of calls) out.push(await this.executeCall(call, handlers));
    return out;
  }

  private async executeCall(call: ToolCall, handlers: ConductorHandlers): Promise<string> {
    handlers.onToolStart?.(call);
    let result: string;
    try {
      result = await this.executor.run(call.name, call.input);
    } catch (err) {
      result = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
    handlers.onToolEnd?.(call, result);
    return result;
  }
}

// ---------------------------------------------------------------- helpers

const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const isAbort = (err: unknown): boolean =>
  err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}

/**
 * Parse an SSE response body into events. Handles both `data: {...}` and
 * multi-line data frames, ignores comments, and tolerates a truncated tail.
 */
export async function* readSse(res: Response): AsyncGenerator<ConductorEvent> {
  const body = res.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  const drain = function* (frame: string): Generator<ConductorEvent> {
    const payload = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (!payload || payload === '[DONE]') return;
    try {
      const ev = JSON.parse(payload) as ConductorEvent;
      if (ev && typeof ev === 'object' && typeof (ev as { type?: unknown }).type === 'string') yield ev;
    } catch {
      /* keep-alive or partial frame — drop it */
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        yield* drain(frame);
      }
    }
    if (buf.trim()) yield* drain(buf);
  } finally {
    reader.cancel().catch(() => {});
  }
}
