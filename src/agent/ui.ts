/**
 * DOM wiring for the conductor console.
 *
 * Owns the right-hand panel (`#console`), the composer, tool chips, the `/`
 * command prefix and the toast stack. It creates its own `Conductor` and never
 * adds CSS — index.html already styles every class used here.
 */

import { Conductor, type ConductorMode, type ConductorOptions } from './conductor';
import { localBrain, SLASH_COMMANDS } from './localbrain';
import { STATIC_SITE } from '../core/site';
import { ToolExecutor, type CameraPort, type ToolCall } from './tools';
import type { WorldState } from '../core/state';

const $ = <T extends HTMLElement>(id: string): T | null =>
  (typeof document === 'undefined' ? null : (document.getElementById(id) as T | null));

/** Show a transient message in `#toasts`. Safe to call before mount. */
export function toast(msg: string, ms = 3200): void {
  const host = $('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  host.appendChild(el);
  const life = Math.max(600, ms);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
  }, life);
  while (host.children.length > 5) host.firstElementChild?.remove();
}

export interface ConductorUIOptions extends ConductorOptions {
  /** Key that toggles the console. Defaults to `t`. */
  hotkey?: string;
  /** Prefix mark shown in the composer placeholder. */
  placeholder?: string;
}

export class ConductorUI {
  private readonly executor: ToolExecutor;
  private readonly worldRef: WorldState;
  private readonly cameraRef: CameraPort;
  private readonly conductor: Conductor;
  private readonly hotkey: string;

  private panel: HTMLElement | null = null;
  private chat: HTMLElement | null = null;
  private form: HTMLFormElement | null = null;
  private input: HTMLInputElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private toggleBtn: HTMLElement | null = null;
  private streaming: HTMLElement | null = null;
  private modeBadge: HTMLElement | null = null;
  private hotkeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private buttonHandler: (() => void) | null = null;

  constructor(executor: ToolExecutor, world: WorldState, camera: CameraPort, opts: ConductorUIOptions = {}) {
    this.executor = executor;
    this.worldRef = world;
    this.cameraRef = camera;
    this.hotkey = (opts.hotkey ?? 't').toLowerCase();
    this.conductor = new Conductor(executor, world, opts);
  }

  /** Wire up the DOM. Idempotent. */
  mount(): void {
    if (this.panel) return;
    this.panel = $('console');
    this.chat = $('chat');
    this.form = $('composer') as HTMLFormElement | null;
    this.input = $('chat-input') as HTMLInputElement | null;
    this.sendBtn = $('chat-send') as HTMLButtonElement | null;
    this.toggleBtn = $('btn-console');
    if (!this.panel || !this.chat || !this.form || !this.input) {
      console.warn('[conductor] console DOM missing; UI not mounted');
      return;
    }

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit();
    });
    // Enter sends, Shift+Enter inserts a newline (harmless on <input>, correct
    // if the composer is ever swapped for a <textarea>).
    this.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.shiftKey) { e.preventDefault(); this.insert('\n'); return; }
      e.preventDefault();
      void this.submit();
    });

    if (this.toggleBtn) {
      this.buttonHandler = () => this.toggle();
      this.toggleBtn.addEventListener('click', this.buttonHandler);
    }

    this.hotkeyHandler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === this.hotkey) {
        e.preventDefault();
        this.toggle();
      }
    };
    window.addEventListener('keydown', this.hotkeyHandler);

    // The llm/local badge means nothing on the static site, which is always local.
    const header = this.panel.querySelector('header p');
    if (header && !this.modeBadge && !STATIC_SITE) {
      this.modeBadge = document.createElement('span');
      header.appendChild(document.createTextNode(' · '));
      header.appendChild(this.modeBadge);
    }
    this.setModeBadge(this.conductor.getMode());

    this.pushBot(
      `Steer the city in plain language — weather, time of day, camera, lens, events. ` +
      `${STATIC_SITE ? '' : 'No API key? The built-in director still handles the basics.'}\n${SLASH_COMMANDS.map((c) => `  ${c}`).join('\n')}`,
    );
  }

  /** Detach listeners. */
  unmount(): void {
    if (this.hotkeyHandler) window.removeEventListener('keydown', this.hotkeyHandler);
    if (this.toggleBtn && this.buttonHandler) this.toggleBtn.removeEventListener('click', this.buttonHandler);
    this.hotkeyHandler = null;
    this.buttonHandler = null;
    this.panel = null;
  }

  // ------------------------------------------------------------ panel

  get isOpen(): boolean { return this.panel?.classList.contains('open') ?? false; }

  open(): void {
    if (!this.panel) return;
    this.panel.classList.add('open');
    this.toggleBtn?.classList.add('on');
    // Focus after the slide-in transition has started, or the caret is lost.
    setTimeout(() => this.input?.focus(), 60);
  }

  close(): void {
    if (!this.panel) return;
    this.panel.classList.remove('open');
    this.toggleBtn?.classList.remove('on');
  }

  toggle(): void { this.isOpen ? this.close() : this.open(); }

  focus(): void { this.input?.focus(); }

  // ------------------------------------------------------------ messaging

  /** Send whatever is in the composer. */
  async submit(): Promise<void> {
    const value = this.input?.value ?? '';
    if (!value.trim()) return;
    if (this.input) this.input.value = '';
    await this.send(value);
  }

  /** Send an arbitrary line (used by the composer, hotkeys and tests). */
  async send(text: string): Promise<void> {
    const line = text.trim();
    if (!line) return;
    this.pushUser(line);
    if (this.sendBtn) this.sendBtn.disabled = true;
    try {
      if (line.startsWith('/')) {
        await this.runSlash(line);
        return;
      }
      await this.conductor.send(line, {
        onText: (d) => this.appendStreaming(d),
        onToolStart: (c) => this.chip(c),
        onToolEnd: (c) => toast(`${c.name} ${summarise(c.input)}`.slice(0, 110), 1800),
        onDone: (t) => this.endStreaming(t),
        onError: (m) => this.pushError(m),
        onModeChange: (m) => {
          this.setModeBadge(m);
          toast(m === 'local' ? 'conductor: local brain (no API key)' : 'conductor: LLM online', 2600);
        },
      });
      this.endStreaming('');
    } finally {
      if (this.sendBtn) this.sendBtn.disabled = false;
      this.input?.focus();
    }
  }

  // ------------------------------------------------------------ slash

  private async runSlash(line: string): Promise<void> {
    const [cmd, ...rest] = line.slice(1).trim().split(/\s+/);
    const arg = rest.join(' ').toLowerCase();
    const world = this.worldRef;

    switch (cmd) {
      case 'help':
        this.pushBot(`Commands\n${SLASH_COMMANDS.map((c) => `  ${c}`).join('\n')}`);
        return;
      case 'state':
        this.pushBot(await this.executor.run('describe_world', {}));
        return;
      case 'clear':
        if (this.chat) this.chat.innerHTML = '';
        return;
      case 'reset':
        this.conductor.reset();
        await this.apply([{ name: 'reset_world', input: {} }], 'Reset to defaults.');
        return;
      case 'weather': {
        const map: Record<string, string> = {
          storm: 'storm', rain: 'rain', snow: 'snow', fog: 'fog',
          clear: 'clear', cloud: 'cloud', haze: 'haze', ash: 'ash', pollen: 'pollen',
        };
        const word = map[arg];
        if (!word) { this.pushBot(`Unknown weather "${arg}". Try: ${Object.keys(map).join(', ')}`); return; }
        await this.runBrain(word);
        return;
      }
      case 'tour': {
        if (!arg) { this.pushBot(`Usage: /tour ${'canyon|skyline|canal|aerial|ground|vertical-drop|orbit'}`); return; }
        await this.apply([{ name: 'tour', input: { preset: arg } }], '');
        return;
      }
      case 'lens': {
        const map: Record<string, Record<string, unknown>> = {
          miniature: { tiltShift: 0.9, bokeh: 0.85, focusWidth: 0.1, fov: 26 * (Math.PI / 180), horizonBend: 0.35 },
          soft: { bokeh: 0.9, tiltShift: 0.7, focusWidth: 0.18 },
          sharp: { bokeh: 0.15, tiltShift: 0.05, focusWidth: 0.9 },
          wide: { fov: 92 * (Math.PI / 180) },
          tele: { fov: 18 * (Math.PI / 180) },
          dutch: { roll: 0.22 },
          normal: { tiltShift: 0.62, bokeh: 0.5, fov: 62 * (Math.PI / 180), roll: 0, warp: 0.2 },
          warp: { warp: 0.65, horizonBend: 0.5, breathe: 0.6 },
        };
        const patch = map[arg];
        if (!patch) { this.pushBot(`Unknown lens "${arg}". Try: ${Object.keys(map).join(', ')}`); return; }
        await this.apply([{ name: 'set_lens', input: patch }], '');
        return;
      }
      case 'time': {
        const phases = ['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'bluehour', 'night'];
        if (!phases.includes(arg)) { this.pushBot(`Usage: /time ${phases.join('|')}`); return; }
        await this.apply([{ name: 'set_time', input: { phase: arg } }], '');
        return;
      }
      case 'event': {
        const kinds = ['lantern-rise', 'bloom-festival', 'migration', 'aurora-borealis', 'lightning', 'monsoon', 'blimp-parade', 'market-rush', 'balloon-release', 'fog-bank', 'sunbreak', 'spore-bloom', 'rain-burst', 'flash-flood', 'power-cycle', 'migration'];
        const kind = kinds.find((k) => arg.includes(k)) ?? (kinds.includes(arg) ? arg : '');
        if (!kind) { this.pushBot(`Usage: /event ${kinds.slice(0, 8).join('|')}...`); return; }
        await this.apply([{ name: 'trigger_event', input: { kind, ttl: 120 } }], '');
        return;
      }
      default: {
        // Unknown slash command: treat the whole line as plain language so
        // "/golden hour" still works.
        await this.send(line.slice(1));
        void world;
      }
    }
  }

  /** Run the local brain over a phrase and stage every call it produces. */
  private async runBrain(phrase: string): Promise<void> {
    const plan = localBrain(phrase, this.worldRef, this.cameraRef.position());
    this.appendStreaming(plan.text);
    for (const call of plan.calls) {
      this.chip(call);
      const result = await this.executor.run(call.name, call.input);
      if (result.startsWith('ERROR:')) this.pushError(result);
      else toast(result.slice(0, 110), 1600);
    }
    this.endStreaming('');
  }

  /** Run calls, render chips and a spoken line. */
  private async apply(calls: ToolCall[], text: string): Promise<void> {
    if (text) this.appendStreaming(text);
    for (const call of calls) {
      this.chip(call);
      const result = await this.executor.run(call.name, call.input);
      toast(result.slice(0, 110), 1800);
      if (result.startsWith('ERROR:')) this.pushError(result);
    }
    this.endStreaming('');
  }

  // ------------------------------------------------------------ rendering

  private scroll(): void {
    if (this.chat) this.chat.scrollTop = this.chat.scrollHeight;
  }

  private pushUser(text: string): void {
    if (!this.chat) return;
    const el = document.createElement('div');
    el.className = 'msg user';
    el.textContent = text;
    this.chat.appendChild(el);
    this.scroll();
  }

  private pushBot(text: string): void {
    if (!this.chat) return;
    const el = this.botNode();
    const body = document.createElement('div');
    body.textContent = text;
    body.style.whiteSpace = 'pre-wrap';
    el.appendChild(body);
    this.chat.appendChild(el);
    this.scroll();
  }

  private pushError(text: string): void {
    if (!this.chat) return;
    const el = this.botNode('bot err');
    const body = document.createElement('div');
    body.textContent = text;
    body.style.whiteSpace = 'pre-wrap';
    el.appendChild(body);
    this.chat.appendChild(el);
    this.scroll();
  }

  private botNode(extra = 'bot'): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `msg ${extra}`;
    return el;
  }

  /** Open (or reuse) the streaming bubble and show the thinking indicator. */
  private appendStreaming(delta: string): void {
    if (!this.chat) return;
    if (!this.streaming) {
      this.streaming = this.botNode();
      const thinking = document.createElement('span');
      thinking.className = 'thinking';
      thinking.textContent = 'thinking';
      this.streaming.appendChild(thinking);
      this.chat.appendChild(this.streaming);
    }
    const thinking = this.streaming.querySelector('.thinking');
    if (thinking) {
      // First real token: retire the indicator.
      const body = document.createElement('div');
      body.style.whiteSpace = 'pre-wrap';
      this.streaming.appendChild(body);
      thinking.remove();
    }
    const body = this.streaming.lastElementChild as HTMLElement | null;
    if (body) body.textContent = (body.textContent ?? '') + delta;
    this.scroll();
  }

  /** Close the streaming bubble, falling back to the thinking state. */
  private endStreaming(finalText: string): void {
    if (!this.chat) return;
    const el = this.streaming;
    this.streaming = null;
    if (!el) return;
    if (el.querySelector('.thinking')) {
      const t = el.querySelector('.thinking');
      if (t) t.textContent = 'thinking';
      el.remove();
      if (finalText) this.pushBot(finalText);
      return;
    }
    const body = el.lastElementChild as HTMLElement | null;
    if ((body?.textContent ?? '').trim().length === 0) el.remove();
    else if (finalText && finalText !== body?.textContent) {
      const extra = document.createElement('div');
      extra.style.whiteSpace = 'pre-wrap';
      extra.textContent = finalText;
      el.appendChild(extra);
    }
    this.scroll();
  }

  /** Render a tool-call chip: name plus a compact argument summary. */
  private chip(call: ToolCall): void {
    if (!this.chat) return;
    const host = this.streaming ?? this.botNode();
    if (!this.streaming) this.chat.appendChild(host);
    const el = document.createElement('span');
    el.className = 'tool';
    el.textContent = `${call.name} ${summarise(call.input)}`.trim();
    host.appendChild(el);
    this.scroll();
  }

  private setModeBadge(mode: ConductorMode): void {
    if (!this.modeBadge) return;
    this.modeBadge.textContent = mode === 'llm' ? 'llm online' : 'local brain';
    this.modeBadge.className = mode === 'llm' ? 'spark' : 'warn';
  }

  private insert(s: string): void {
    if (!this.input) return;
    const start = this.input.selectionStart ?? this.input.value.length;
    const end = this.input.selectionEnd ?? start;
    this.input.value = this.input.value.slice(0, start) + s + this.input.value.slice(end);
    this.input.selectionStart = this.input.selectionEnd = start + s.length;
  }
}

/** One-line argument summary for a tool chip. */
export function summarise(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'number') parts.push(`${k}=${Math.round(v * 1000) / 1000}`);
    else if (typeof v === 'boolean') parts.push(`${k}=${v}`);
    else if (typeof v === 'string') parts.push(`${k}=${v}`);
    else if (Array.isArray(v)) parts.push(`${k}=[${v.map((n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n)).join(',')}]`);
    else parts.push(`${k}={…}`);
  }
  const joined = parts.join(' ');
  return joined.length > 96 ? `${joined.slice(0, 93)}…` : joined;
}
