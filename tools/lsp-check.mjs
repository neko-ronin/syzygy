#!/usr/bin/env node
/**
 * Verify an LSP server actually speaks the protocol and can serve a real file.
 *
 * The point of this script is to catch the failure mode where a binary exists on
 * PATH but silently does nothing — a very common state for language servers that
 * have gone stale under a newer Node, or that are wired to a broken project
 * root. Existence checks are not evidence; a completed `initialize` handshake
 * and a real diagnostic are.
 *
 *   node tools/lsp-check.mjs                     # check every server in the map
 *   node tools/lsp-check.mjs typescript clangd   # check specific ones
 *
 * Exits non-zero if any requested server fails.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Each entry knows how to (a) prove it starts, and (b) prove it can actually
 * analyse something. `probe` writes a small file with a deliberate problem and
 * asserts the server reports it.
 */
const SERVERS = {
  typescript: {
    cmd: 'typescript-language-server',
    args: ['--stdio'],
    ext: '.ts',
    // The server needs a real TypeScript to load. Point it at this project's
    // copy so the check works in a scratch directory.
    initOptions: {
      tsserver: { path: join(ROOT, 'node_modules/typescript/lib/tsserver.js') },
      preferences: { includeInlayParameterNames: true, providePrefixAndSuffixTextForRename: true },
    },
    // A definite type error plus a missing module.
    source: 'const n: number = "definitely not a number";\nimport x from "./nope";\nexport { n, x };\n',
    expect: /not assignable|module|cannot find/i,
  },
  python: {
    cmd: 'pyright-langserver',
    args: ['--stdio'],
    ext: '.py',
    source: 'def f(x: int) -> str:\n    return x\n\nundefined_name_here\n',
    expect: /type|unknown|undeclared|report/i,
  },
  c: {
    cmd: 'clangd',
    args: ['--background-index', '--enable-config'],
    ext: '.c',
    source: '#include <stdio.h>\nint main(void) {\n  int x = "not an int";\n  undeclared_function();\n  return 0;\n}\n',
    expect: /error|undeclared|incompatible/i,
  },
  cpp: {
    cmd: 'clangd',
    args: ['--background-index', '--enable-config'],
    ext: '.cpp',
    source: '#include <string>\nint main() {\n  std::string s = 42;\n  not_a_real_function();\n  return 0;\n}\n',
    expect: /error|undeclared|convert/i,
  },
  rust: {
    cmd: 'rust-analyzer',
    args: [],
    ext: '.rs',
    // A tiny crate so rust-analyzer has a real workspace to index.
    crate: {
      'Cargo.toml': '[package]\nname = "probe"\nversion = "0.1.0"\nedition = "2021"\n',
      'src/main.rs': 'fn main() {\n    let x: i32 = "not an int";\n    undefined_function();\n}\n',
    },
    expect: /mismatched|unresolved|not found|error/i,
  },
};

/** Minimal LSP stdio client: Content-Length framed JSON-RPC. */
class Client {
  constructor(cmd, args, cwd) {
    this.p = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.buf = Buffer.alloc(0);
    this.pending = new Map();
    this.diagnostics = new Map();
    this.nextId = 1;
    this.stderr = '';
    this.exited = null;
    this.p.stderr.on('data', (d) => { this.stderr += d.toString(); });
    this.p.on('exit', (c) => { this.exited = c; });
    this.p.on('error', (e) => { this.exited = e.message; });
    this.p.stdout.on('data', (d) => this.#onData(d));
  }

  #onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const sep = this.buf.indexOf('\r\n\r\n');
      if (sep < 0) return;
      const m = /Content-Length: (\d+)/i.exec(this.buf.subarray(0, sep).toString());
      if (!m) { this.buf = this.buf.subarray(sep + 4); continue; }
      const len = Number(m[1]);
      if (this.buf.length < sep + 4 + len) return;
      const body = this.buf.subarray(sep + 4, sep + 4 + len).toString();
      this.buf = this.buf.subarray(sep + 4 + len);
      let msg;
      try { msg = JSON.parse(body); } catch { continue; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      } else if (msg.method === 'textDocument/publishDiagnostics') {
        const p = msg.params;
        const prev = this.diagnostics.get(p.uri) ?? [];
        this.diagnostics.set(p.uri, [...prev, ...(p.diagnostics ?? [])]);
      }
    }
  }

  send(method, params) {
    const id = this.nextId++;
    const s = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    this.p.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`);
    return new Promise((res) => this.pending.set(id, res));
  }

  notify(method, params) {
    const s = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.p.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`);
  }

  get caps() { return this._caps ?? {}; }
  set caps(v) { this._caps = v; }

  kill() { try { this.p.kill(); } catch { /* already gone */ } }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(name) {
  const spec = SERVERS[name];
  if (!spec) throw new Error(`unknown server "${name}"`);

  const dir = mkdtempSync(join(tmpdir(), `lsp-${name}-`));
  if (spec.crate) {
    for (const [f, body] of Object.entries(spec.crate)) {
      const p = join(dir, f);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body);
    }
  } else {
    writeFileSync(join(dir, `probe${spec.ext}`), spec.source);
  }
  const file = spec.crate
    ? join(dir, 'src/main.rs')
    : join(dir, `probe${spec.ext}`);
  const uri = `file://${file}`;

  const c = new Client(spec.cmd, spec.args, dir);
  const t0 = Date.now();
  const init = await Promise.race([
    c.send('initialize', {
      processId: process.pid,
      rootUri: `file://${dir}`,
      workspaceFolders: [{ uri: `file://${dir}`, name: 'probe' }],
      capabilities: {
        textDocument: { publishDiagnostics: {}, synchronization: { didSave: true } },
        workspace: { didChangeConfiguration: { dynamicRegistration: true } },
      },
      initializationOptions: spec.initOptions ?? {},
    }),
    wait(45000).then(() => null),
  ]);

  if (!init || init.error) {
    c.kill();
    return { name, ok: false, why: c.exited
      ? `server exited (${c.exited}) ${c.stderr.slice(0, 200)}`
      : 'no initialize response within 45s' };
  }

  c.caps = init.result?.capabilities ?? {};
  const hasDiag = !!(c.caps.hoverProvider && c.caps.completionProvider);
  c.notify('initialized', {});
  c.notify('textDocument/didOpen', {
    textDocument: { uri, languageId: langId(name), version: 1, text: readFile(file) },
  });

  // Pull diagnostics first; fall back to waiting for a pushed publish.
  await c.send('textDocument/diagnostic', { textDocument: { uri } }).catch(() => null);
  for (let i = 0; i < 40 && (c.diagnostics.get(uri)?.length ?? 0) === 0; i++) await wait(250);

  const diags = c.diagnostics.get(uri) ?? [];
  const matched = diags.filter((d) => spec.expect.test(d.message ?? ''));
  c.kill();

  return {
    name, ok: hasDiag && matched.length > 0, ms: Date.now() - t0,
    hover: !!c.caps.hoverProvider, completion: !!c.caps.completionProvider,
    defs: !!c.caps.definitionProvider,
    diags: diags.length, matched: matched.length,
    sample: (matched[0] ?? diags[0])?.message?.slice(0, 110),
  };
}

function langId(n) {
  return { typescript: 'typescript', python: 'python', c: 'c', cpp: 'cpp', rust: 'rust' }[n] ?? 'plaintext';
}
function readFile(p) {
  // Small sync read; the probe files are tiny.
  return existsSync(p) ? require('node:fs').readFileSync(p, 'utf8') : '';
}

// `require` is unavailable in ESM; shim just this one need.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const names = want.length ? want : Object.keys(SERVERS);
const rows = [];
for (const n of names) {
  process.stdout.write(`  ${n.padEnd(12)}`);
  const r = await check(n);
  rows.push(r);
  if (r.ok) {
    console.log(`OK    ${String(r.ms).padStart(6)}ms  hover=${r.hover} completion=${r.completion} defs=${r.defs}  ${r.diags} diag(s), ${r.matched} matched`);
  } else {
    console.log(`FAIL  ${r.why ?? `handshake ok but no expected diagnostic (saw ${r.diags})`}`);
  }
}
const bad = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - bad}/${rows.length} language server(s) verified`);
process.exit(bad ? 1 : 0);
