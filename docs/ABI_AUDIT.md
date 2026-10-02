# ABI audit — WGSL ↔ TypeScript

**R13 section 2.** Read-only audit. No source was changed. Every claim below cites
a file and a line, because the reason this section exists is the same reason a
`PASS` with `requested: null` in it was distrusted (`b2ea352`, `PITFALLS.md` §20):
a check that reports success without naming what it checked has told us nothing.

**Scope.** Inventory and verdict only. No migration, no abstraction, no second
backend. A finding of the form "we should adopt X" would be a failure of this
section, not a result of it.

## Method, and its one limit

Both sides were read and the layouts were **recomputed by hand** from the WGSL
struct declarations and compared against the TypeScript writers, member by
member. Sizes alone are not sufficient and are not what was checked: WGSL pads
`vec3` to 16 bytes and aligns struct members to their alignment, and TypeScript
packs `Float32Array` elements with no padding at all. A layout made of `vec4f`
and `mat4x4f` has no such hazard, which is the result below — but it is a result
about *these* structs, not a general guarantee, and a future `vec3` member would
break it silently.

**The limit:** this is a source-reading audit. It establishes that the two
declarations agree *today*. It cannot establish that a change to either side
keeps them in agreement, and section 4 shows that nothing else does either.

## 1. Inventory

Five buffers cross the boundary: one `uniform`, two `storage`, one
dynamically-offset `uniform`, and one instance vertex layout. All are enumerated
from the complete binding set — `grep -n "^struct \|@group(.*) @binding"` across
`src/shaders/*.wgsl` returns 5 structs and 4 storage/uniform buffer bindings, plus
textures, which carry no layout ABI.

### 1.1 `Frame` — the frame uniform

| | |
|---|---|
| WGSL declaration | `src/shaders/common.wgsl:7-40` |
| WGSL binding | `src/shaders/common.wgsl:42` (`@group(0) @binding(0) var<uniform>`) |
| TS writer | `src/render/renderer.ts:833-896` (`writeFrameUniforms`) |
| TS size | `src/render/gpuutil.ts:18` — `FRAME_UNIFORM_SIZE = 1024` |
| WGSL size | **880 bytes**, recomputed below |
| Verdict | **SAFE** |

WGSL size, recomputed: 9 × `mat4x4f` (`common.wgsl:8-16`) = 576 B, plus 19 ×
`vec4f` (`common.wgsl:18-39`) = 304 B. **880 B total.** No `vec3`, no `f32`
scalar, so no member is padded and no alignment rule applies. The buffer is 1024
B, so 144 B is unallocated slack.

TS size, recomputed: nine `d.set(matrix, n)` at float offsets 0, 16, 32, 48, 64,
80, 96, 112 (`renderer.ts:846-854`) occupy floats 0-143, then 19 `put()` calls
from `let o = 144` (`renderer.ts:860`) to `fogColor` (`renderer.ts:888`) occupy
floats 144-219. **220 floats = 880 B.** Ends at the same place.

Member order was compared one-for-one and matches `common.wgsl:18-39` exactly,
including the three `weather` blocks and the four `lens` blocks. Two members carry
a documented semantic override rather than a positional one:

- `grade.w` — declared `w = unused` at `common.wgsl:34`, and written as
  `this.stats.lights` at `renderer.ts:888`. The comment there records the
  `arrayLength` bug (`ab19da9`) that motivated it.
- `time.w` — declared `quality` at `common.wgsl:30`, written as a render-scale
  flag at `renderer.ts:879`.

Both are within the member they occupy, so neither shifts a neighbour. The
hazard this struct carries is documented on the writer at `renderer.ts:857-859`
("9 mat4 precede the vec4 block... Getting this wrong silently shifts *every*
uniform"), and the recomputation confirms the comment's `144`.

### 1.2 `Light` — the light storage array

| | |
|---|---|
| WGSL declaration | `src/shaders/lightbin.wgsl:10-13` |
| WGSL binding | `src/shaders/lightbin.wgsl:25` (`array<Light>`, storage read) |
| TS writer | `src/render/renderer.ts`, `gatherLights`, packing at the comment "Pack at the SHADER's stride" |
| WGSL stride | 2 × `vec4f` = **32 B** |
| TS stride | `d[o+0..o+7]` — 8 floats = **32 B** |
| Verdict | **SAFE** |

Two `vec4f`, no padding. The TS comment on the packer records the exact class of
bug this project has already suffered — a patch written at the shader's stride
applied to data laid out at 24 — and `src/render/__perftest.ts:375` quotes it as
a known hazard, which is evidence it is understood and not evidence it is
checked.

### 1.3 `Bin` — the tile bin storage array

| | |
|---|---|
| WGSL declaration | `src/shaders/lightbin.wgsl:19-23` |
| WGSL binding | `src/shaders/lightbin.wgsl:26` (`array<Bin>`, storage read_write) |
| TS writer | `src/render/renderer.ts:1556-1557` (`allocTiles`) |
| WGSL stride | `array<atomic<u32>,96>` = 384 B, + `count` 4 B, + `_pad` 12 B = **400 B** |
| TS stride | `const bytes = bins * 400;` — **400 B** |
| Verdict | **SAFE** |

Both sides are 400 and both sides say why: the TS line carries
`// Matches sizeof(Bin) in lightbin.wgsl: array<atomic<u32>,96> + count + 3 pad.`
`MAX_PER_TILE` is 96 in WGSL (`lightbin.wgsl:17`) and 96 in the TS stat
(`renderer.ts:2106`). The count is a hand-maintained duplicate, and it is
currently correct.

### 1.4 `ShadowParams` — the per-cascade uniform

| | |
|---|---|
| WGSL declaration | `src/shaders/shadow.wgsl:11-15` |
| WGSL binding | `src/shaders/shadow.wgsl:17` (`@group(2) @binding(0)`) |
| TS writer | `src/render/renderer.ts:912-924` |
| TS stride | `CASCADE_STRIDE = 256` B (`renderer.ts:53`), bound at `renderer.ts:1400` |
| WGSL size | `mat4x4f` + 2 × `vec4f` = **96 B** |
| Verdict | **SAFE** |

The buffer is `CASCADE_COUNT * 256` (`renderer.ts:502`) and the binding uses a
dynamic offset of `CASCADE_STRIDE` (`renderer.ts:1400`). The writer touches
floats `base+0` through `base+23` = 96 B, so 160 B of each 256 B slot is slack.
`CASCADE_STRIDE = 256` is also exactly the default
`minUniformBufferOffsetAlignment`, which a dynamic-offset binding requires — true
today, asserted by nothing.

### 1.5 The instance vertex layout (D18)

| | |
|---|---|
| WGSL declaration | `src/shaders/gbuffer.wgsl:10-23`, per-instance at locations 5-10 |
| TS layout | `src/render/gpuutil.ts:217-227` (`instanceVertexLayout`) |
| TS record size | `INSTANCE_FLOATS = 24` (`src/render/citymesh.ts:62`) |
| WGSL per-instance size | 6 × `vec4f` = **96 B** |
| TS attribute offsets | 0, 16, 32, 48, 64, 80 — six `float32x4` |
| Verdict | **SAFE** |

24 floats × 4 = 96 B, and the six attributes end at 80+16 = 96, so the last one
lands exactly on the record boundary. `arrayStride` is `INSTANCE_STRIDE`
(`gpuutil.ts:218`) and the agreement of that constant with
`INSTANCE_FLOATS * 4` is the load-bearing coupling in this row — it is correct and
nothing checks it. This is the layout D18 exists to settle, and the audit
confirms the two representations agree.

### 1.6 `TileLight` — declared, not bound

`src/shaders/lightbin.wgsl:14` declares `struct TileLight { offset: u32, count: u32, _pad: vec2u }`,
16 B. **No `@group(...) @binding` in any shader references it** — the storage
bindings are `lights` and `bins` at `lightbin.wgsl:25-26`. It is a declaration with
no counterpart on either side, so it is **not part of the live ABI**. Reported
here because a struct that exists in WGSL and nothing binds is exactly the shape
`docs/COVERAGE.md` tracks, and because if it is ever bound its 16 B layout would
have to be matched by hand. **Not a mismatch. An orphan.**

## 2. Verdicts

| Buffer | Verdict | Basis |
|---|---|---|
| `Frame` uniform | **SAFE** | 880 B both sides, member order identical, no padding hazard |
| `Light` array | **SAFE** | 32 B both sides |
| `Bin` array | **SAFE** | 400 B both sides, duplicate constant, both documented |
| `ShadowParams` | **SAFE** | 96 B written into a 256 B slot, both sides over-allocated |
| Instance layout | **SAFE** | 96 B both sides, attributes land on the boundary |
| `TileLight` | **not live ABI** | declared, never bound |

**SAFE: 5. MISMATCH: 0. CANNOT-VERIFY-FROM-SOURCE: 1** (the persistence of these
agreements — section 4). **Orphan: 1** (`TileLight`).

**Zero mismatches is the expected result and it is not reassuring on its own.**
The project has been bitten by this class three times. The reason it has not been
bitten more often is visible in the table: the correct constants are *duplicated
and commented*, which is a human convention, not a check.

## 3. The most dangerous finding

**Every one of these five agreements is a duplicated hand-maintained constant,
and four of the five are over-allocated, so a size comparison could not detect a
drift even if one existed.**

`FRAME_UNIFORM_SIZE` is 1024 for an 880 B struct (`gpuutil.ts:18`).
`CASCADE_STRIDE` is 256 for a 96 B struct (`renderer.ts:53`). Both sizes are
*larger* than what is written, so a struct that outgrows the buffer fails loudly
and visibly — but a **writer that outgrows its WGSL struct does not**. Add a
twentieth `vec4f` to `common.wgsl` and a twentieth `put()` to `renderer.ts`, and:

- the struct becomes 896 B, still inside the 1024 B buffer, so the buffer
  allocation still succeeds;
- the write still succeeds, because the writer writes exactly what it is told;
- and if the *writer* were not updated in step, the shader reads the tail as
  zeros, which for a colour or an intensity is a plausible darkening rather than
  an error.

There is no test, no assertion, and no type that would notice. The 144 B and 160 B
of slack that make the buffers safe are the same slack that makes a future
disagreement undetectable. That is the finding, and it is more specific than
"there is no ABI test": **the safety margin and the detection gap are the same
number.**

## 4. Is there any automated check? No

Searched `src/*/__selftest*.ts` and `tools/*.mjs` for `abi`, `offset check`,
`struct size`, `layout assert` and `wgsl size`. The only hits are
`tools/capture.mjs:920` (a comment about a crowd diagnostic),
`tools/lsp-check.mjs:164,180` (`capabilities`, unrelated) and nothing else.
**No automated check exists that would catch a size or offset disagreement
between any of these five buffers and their WGSL counterparts.**

The guards that do exist are, in order of strength:

1. **Comments naming the failure.** `renderer.ts:857-859` on the frame uniform's
   float-144 boundary; `renderer.ts:1556` on the 400 B bin stride;
   `__perftest.ts:375` on the 32 B light stride. These are good and they are
   load-bearing today. They are also prose, and prose does not fail a build.
2. **Shader-compile errors.** A *type* error in WGSL is caught at module
   creation. A *layout* error is not, because both sides are legal on their own —
   which is precisely why this class of bug is silent.
3. **Visible-at-runtime errors.** The tile-bin overflow check at
   `renderer.ts:1584-1585` throws. This is the only guard in the inventory that
   fails loudly, and it is a capacity check, not a layout check.

## 5. The specifier I would write next

Not written this round — the brief scopes this to a document. Stated so the next
session does not have to re-derive it, and deliberately small: no framework, no
build step, no new dependency.

**A table-driven source check, in the existing self-test style.** Declare each
buffer once as a record of `{ name, wgslFile, tsFile, structSizeBytes, strideFloats }`
where the two size fields are **derived by parsing the files at test time**, not
retyped. Assertions, in order of value:

1. `sizeof(struct)` recomputed from the WGSL declaration — sum member sizes,
   applying `@align` and the `vec3`-pads-to-16 rule — **≤ the allocated buffer
   size**. This is the assertion that would have caught a truncated writer, and it
   is the one worth writing first.
2. The TS writer's **last written float offset** equals the WGSL struct's float
   size. This catches a writer that silently stops short, and catches it in the
   direction that produces plausible darkening rather than an error.
3. `stride % 256 == 0` for every dynamic-offset uniform binding, or the constant
   is named in the failure — the `CASCADE_STRIDE` case at `renderer.ts:53`.
4. `INSTANCE_STRIDE === INSTANCE_FLOATS * 4`, and the largest instance attribute
   offset + size ≤ `INSTANCE_STRIDE`. The D18 coupling at `gpuutil.ts:218`.
5. A negative control: assert the parser *fails* on a deliberately malformed
   declaration, so the check is known to be capable of failing. Without this it is
   the same class of guard as everything else in section 4 — a check that has
   never been observed to fail.

**Why a source parse and not a runtime readback.** A runtime check that writes a
sentinel and reads it back through the buffer verifies WebGPU, not the agreement
between these two files. The disagreement is between a `.wgsl` and a `.ts`, and
only a check that reads both catches it. This is also why the negative control is
item 5 and not optional: a parser that silently returns a default for a member it
does not recognise would report five SAFEs forever, which is the
`requested: null` failure wearing a different hat.

**What it would not catch.** A buffer that is written correctly and read by a
shader that was never updated, where both parse fine and only the *semantics*
diverge. That is `grade.w` and `time.w` in section 1.1, both currently
documented in comments on both sides. Comments are the right tool for a
documented semantic override; they are the wrong tool for an undocumented one,
and no amount of layout checking changes that.

## 6. Conclusion

**The ABI is currently sound.** Five buffers, five agreements, zero mismatches,
every claim cited. That is a real result and it is the answer R13 section 2 was
asked for.

It is also the result the project would have produced without this audit, because
the constants are correct and the comments are good. What the audit adds is the
sentence in section 3: **the safety margin and the detection gap are the same
number, and nothing watches it.** That is a three-line problem, not a migration,
and it is the only work item this section produces.
