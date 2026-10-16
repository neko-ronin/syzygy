# Fall Zone Placement Pass: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place sheet B's makeshift village on the fallen megastructure's remains: where every column, deck fragment, bridge, off-limits patch, wreck piece and village ropeway stands. Show it as a greybox so a reviewer can judge placement in frame before anything is modelled.

**Architecture:** A new pure module, `src/world/fallzone.ts`, builds one `FallZone` per seed from the existing city plan. It is cached like `cityPlan`. `citygen.buildChunk` drops the old buildings that made way for it and hands each chunk its share (`CityChunk.fall`). `src/render/fallmesh.ts` draws that share as plain volumes and registers crowd obstacles. Trams end at the zone's edge, village ropeways join the rail network, fleets spread over every line of their kind, the crowd thins inside the zone, and street islands keep out. The bolted-on scaffold rooms stop being built.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`), Vite, WebGPU renderer. Self-tests run under `npx --yes vite-node@6.0.0` (pinned; not a project dependency). Captures and benchmarks use the Playwright tools in `tools/`.

**Spec:** [`docs/DESIGN.md`](DESIGN.md) §8 "Section B's makeshift village: the fall zone" and [`docs/DECISIONS.md`](DECISIONS.md) D33. Also the owner's placement compromise, recorded below under Global Constraints.

## Global Constraints

- **Branch, never `main`.** `.githooks/post-commit` publishes every commit on `main`: it pushes to the public GitHub remote and deploys to Cloudflare. Work in a worktree on branch `fall-zone-placement` (superpowers:using-git-worktrees). Merging is the owner's call.
- **Commits:** the repo-local git user; messages `feat:` / `fix:` / `docs:`, lowercase, with a body that says why. **No `Co-Authored-By` or any AI-attribution line.**
- **Publish hygiene:** no local paths, usernames or real names in committed files. `npm run hygiene` must pass.
- **No new dependencies.** Self-tests run as `npx --yes vite-node@6.0.0 <file>`.
- **Pure and deterministic:** the same seed gives byte-identical chunks in any order. Nothing reads `Math.random`, time or the DOM.
- **Existing RNG streams stay put.** Tram, network and lot rolls keep their order. New rolls come from new seeds and salts (`hash3(..., seed ^ salt)`).
- **D32:** 30 fps is the floor and 60 the aim. Record the frame rate for added geometry.
- **D28:** lights stay warm. This pass adds no lights.
- **DESIGN §8 values (verbatim):**
  - "the deck stood at ~150 m"
  - piers "8-14 m a side"
  - cores "6-10 m"
  - silo batteries "3-6 touching concrete cylinders"
  - spire stumps "40-80 m across", "3-5 in all"
  - village silhouettes "roughly 75-185 m"
  - off-limits patches "about a quarter of the footprint"
  - bridges "about one per pile"
  - piles "3-10 boxes high"
  - shares: piers "~60%", cores "~15%", silos and stacks "~10%", lattice legs "~10%"
- **Owner's placement compromise (2026-10-15):** "The mega structure is built after the lower cities ... its piers may have to be irregular but they still have to be distributed in a way that looks reasonable. Lean toward not changing the existing placements but adjust them as needed ... some older building may have been disrespected and disregarded upon construction of the mega structure. Commerce and community will try to avoid the ruins but concessions are made in the apocalypse." In this plan that means:
  - piers keep a nominal 48 m grid but shift up to 14 m to clear streets, arterials, the rail, the market and the canal;
  - alleys and old buildings may be disregarded, so piers stand in alleys and the buildings they need are cleared;
  - the street field itself does not change;
  - street islands keep out of the zone;
  - foot traffic thins inside the zone but does not stop.
- **Out of scope (the rendering pass):**
  - real geometry for the columns, piles, revival kit and wreck;
  - the level-of-detail (LOD) split and materials;
  - how fences, water and overgrowth look;
  - how gondolas look;
  - the wreck field's ground treatment (kerbs and paving stay as they are);
  - the cable between ropeway stations;
  - the ground dressing DESIGN §8 lists under "lifelines" and "wreckage": rubble ridges along the deck's grid lines, salvage workshops, winch houses and stair-tower feet. The rendering pass places these around the slabs and each column's `access`, both of which this pass records.

## Review Focus

These are inputs and failure modes the spec implies but no ordinary test would exercise. Each is pinned by a test in the task named.

1. **A seed whose belt is short or broken** (seed 13 gets 49 piers): the zone must build without throwing and every invariant must hold, with fewer spires allowed. Covered by Tasks 2 and 3, which run all invariants over eight seeds.
2. **An item near a chunk edge** must bake exactly once, never twice and never zero times. Covered by Task 4 (CITY block, exactly-once count).
3. **A bridge or ropeway span through a third pile:** spans must route around piles, not through them. Covered by Task 3 (LINKS block, sampled independently every metre, not through `segmentBlocked`).
4. **A tram line that starts inside the zone or crosses it twice:** it must keep its longest outside run and never enter the belt. Covered by Task 6 (TRAMS block over eight seeds).
5. **A ropeway ground station or cable through an old building:** the station and the cable must clear every building. Covered by Task 4 (CITY block: station footprints and sampled cable heights against building bounds).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/world/districts.ts` | modify | `beltBand()`: which belt band a point is in (deck or estates) |
| `src/world/citygen.ts` | modify | `sampleStreetPlan(..., alleys)`; `CityChunk.fall`; buildings make way (`fallClears`); lot audit mirrors it |
| `src/world/fallzone.ts` | **create** | The zone: types, columns, patches, wreck, decks, bridges, access, ropeways, chunk slicing, building clearance, foot-traffic predicate |
| `src/world/__selftest_fallzone.ts` | **create** | Standing measurements: BELT, COLUMNS, LINKS, CITY, GREYBOX, TRAMS, FOOT |
| `src/render/fallmesh.ts` | **create** | Greybox volumes and crowd obstacles for one chunk's share |
| `src/render/citymesh.ts` | modify | Bake the greybox; stop building the bolted-on scaffold rooms |
| `src/world/networks.ts` | modify | Trams end at the zone's edge; village ropeways appended as cable car lines |
| `src/sim/traffic.ts` | modify | Fleets spread over every line of their kind; `lineKindOf`, `lineCount` |
| `src/sim/__selftest.ts` | modify | Cable car check by line kind, not altitude |
| `src/sim/crowd.ts` | modify | Thin seating inside the zone (`fallFoot`) |
| `src/world/marketgrammar.ts` | modify | Street islands keep out of the zone |
| `src/world/__selftest.ts` | modify | Lot audit prints and sums the `fall` drop |
| `src/world/__probe_fallzone.ts` | **create** | Prints ready-to-paste review poses |
| `tools/capture.mjs` | modify | Retire `12-scaffold-b(-night)`; add `16`-`19` fall poses |
| `references/sections.json` | modify | `"fall-": "B"` so `compare --auto` judges the new poses against sheet B |
| `AGENTS.md`, `docs/*` | modify | Verify list, DESIGN §8 status, HANDOFF, PITFALLS §35, performance record, bug wiki |

---

### Task 1: The belt's two bands, and a street sample that can skip alleys

**Files:**
- Modify: `src/world/districts.ts` (add after `districtAtField`, before `spinePoint`)
- Modify: `src/world/citygen.ts:252` (`sampleStreetPlan` signature and alley block)
- Create: `src/world/__selftest_fallzone.ts`

**Interfaces:**
- Produces: `beltBand(f: DistrictField, x: number, z: number): 0 | 1 | 2`. 1 is the deck band (the belt's core along the railway), 2 the estates (the widening past r ~ 1 km), 0 off the belt.
- Produces: `sampleStreetPlan(plan, x, z, out, alleys = true)`. With `alleys === false` the alley grid is ignored. Existing callers are unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/world/__selftest_fallzone.ts`:

```ts
/**
 * Fall zone (DESIGN §8, D33) standing measurements: the belt's bands, the
 * columns, their links and ground, the city around them, the greybox, the trams
 * and the foot traffic.
 *
 * Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
 * Prints a `VIOLATIONS` line; that line is the result. Exits 1 on any violation.
 */

import { beltBand, districtAtField, districtField } from './districts';
import { cityPlan, sampleStreetPlan, type StreetSample } from './citygen';

const DEFAULT_SEED = 0x5e7a17;
const SEEDS = [DEFAULT_SEED, 42, 7, 13, 99, 1234, 31337, 0xbeef];
const LO = -1536, HI = 1792;
const problems: string[] = [];
const fail = (m: string): void => { problems.push(m); };
const sample = (): StreetSample => ({ dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0 });

function belt(): void {
  console.log('\nBELT');
  const f = districtField(DEFAULT_SEED);
  let mismatch = 0, nearBand2 = 0, b1 = 0, b2 = 0;
  for (let x = LO; x < HI; x += 24) {
    for (let z = LO; z < HI; z += 24) {
      const b = beltBand(f, x, z);
      if ((b > 0) !== (districtAtField(f, x, z) === 5)) mismatch++;
      if (b === 1) b1++;
      if (b === 2) { b2++; if (Math.hypot(x, z) < 800) nearBand2++; }
    }
  }
  const km2 = (n: number): string => (n * 576 / 1e6).toFixed(2);
  console.log(`  deck band ${km2(b1)} km2, estates ${km2(b2)} km2`);
  if (mismatch > 0) fail(`${mismatch} samples where beltBand and districtAtField disagree on the belt`);
  // The estates widen only past r ~ 1 km (warped by up to ~150 m); band 2 any
  // closer means beltBand's copy of the belt threshold drifted from districtAtField's.
  if (nearBand2 > 0) fail(`${nearBand2} estate samples inside 800 m of the origin`);
  if (b1 * 576 < 0.2e6) fail(`deck band only ${km2(b1)} km2 at the default seed`);

  const plan = cityPlan(DEFAULT_SEED);
  const a = sample(), b = sample();
  let shrank = 0, differs = 0;
  for (let k = 0; k < 2000; k++) {
    const x = LO + ((k * 7919) % 3328), z = LO + ((k * 104729) % 3328);
    sampleStreetPlan(plan, x, z, a);
    sampleStreetPlan(plan, x, z, b, false);
    if (b.clearance < a.clearance - 1e-9) shrank++;
    if (a.kind !== 'alley' && Math.abs(a.clearance - b.clearance) > 1e-9) differs++;
  }
  if (shrank > 0) fail(`${shrank} samples where skipping alleys reduced clearance`);
  if (differs > 0) fail(`${differs} non-alley samples changed when alleys were skipped`);
}

belt();

console.log(`\nVIOLATIONS ${problems.length === 0 ? 'none' : problems.length}`);
for (const p of problems) console.log(`  - ${p}`);
// tsconfig carries no node types, so reach `process` through globalThis.
const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
if (problems.length > 0 && proc) proc.exitCode = 1;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
Expected: FAIL. The module has no export named `beltBand`, and `sampleStreetPlan` takes no fifth argument (`tsc` would also flag it).

- [ ] **Step 3: Add `beltBand` to `src/world/districts.ts`** (immediately after the closing brace of `districtAtField`):

```ts
/**
 * The industrial belt's two bands (DESIGN §8, D33): 1 where the fallen deck stood,
 * the belt's core along the railway; 2 where the belt widens into estates past
 * r ~ 1 km; 0 off the belt. The band-1 edge repeats `districtAtField`'s belt
 * threshold without its estate widening; the fall-zone self-test fails if band 2
 * shows up inside 800 m of the origin, which is where a drift would show.
 */
export function beltBand(f: DistrictField, x: number, z: number): 0 | 1 | 2 {
  if (districtAtField(f, x, z) !== 5) return 0;
  const fx = (x + f.ox) * 0.0021, fz = (z + f.oz) * 0.0021;
  const n2 = fbm2(fx * 1.3 - 8.2, fz * 1.3 + 2.6, 3);
  return spineHit(f.rail, x, z, scratchHit).dist < f.rail.width * 0.8 + 75 + 30 * n2 ? 1 : 2;
}
```

- [ ] **Step 4: Let `sampleStreetPlan` skip alleys** in `src/world/citygen.ts`

Change the signature line:

```ts
export function sampleStreetPlan(plan: CityPlan, x: number, z: number, out: StreetSample, alleys = true): StreetSample {
```

Wrap the whole alley block in `if (alleys) { ... }`. It runs from `const AP = plan.alleyPeriod;` through the closing brace of `if (alleyClear < best) { ... }`. Keep its contents byte-identical. Add one comment line above the `if`:

```ts
  // The fall zone (fallzone.ts) asks for clearance from everything but alleys:
  // the deck's piers disregarded them.
  if (alleys) {
    const AP = plan.alleyPeriod;
    // ... the existing alley block, unchanged ...
  }
```

- [ ] **Step 5: Run the test and the typecheck**

Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
Expected: `deck band 0.63 km2, estates 0.43 km2` (±0.02), then `VIOLATIONS none`.

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx --yes vite-node@6.0.0 src/world/__selftest.ts`
Expected: `VIOLATIONS   none — all invariants hold`. The default argument leaves every existing caller unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/world/districts.ts src/world/citygen.ts src/world/__selftest_fallzone.ts
git commit -m "feat: the belt's deck and estate bands, and street samples that skip alleys" -m "The fall zone stands on the industrial belt: the deck over its core along the railway, stripped cores where it widens into estates. Its piers disregarded alleys, so placement needs clearance from every carriageway but those."
```

---

### Task 2: The zone's columns

**Files:**
- Create: `src/world/fallzone.ts`
- Modify: `src/world/__selftest_fallzone.ts`

**Interfaces:**
- Consumes: `beltBand` and `sampleStreetPlan(..., false)` from Task 1.
- Produces (all exported from `src/world/fallzone.ts`):
  - Types: `ColumnKind`, `BreakKind`, `Access`, `FallColumn`, `DeckFragment`, `VillageBridge`, `PatchKind`, `OffLimitsPatch`, `WreckPiece`, `Ropeway`, `FallZone` (shapes in the code below).
  - Constants: `DECK_H = 150`, `PIER_PITCH = 48`, `PIER_SHIFT = 14`, `SHAFT_CLEAR = 12`, `CORE_CLEAR = 9`, `BOX_H = 2.6`.
  - `fallZone(seed: number): FallZone` (cached) and `buildFallZone(seed: number): FallZone` (uncached).
  - `onFrame(ox, oz, yaw, a, b): [number, number]` and `toFrame(ox, oz, yaw, x, z): [number, number]` map local (a, b) on a yawed frame (MeshBuilder `rotationY` convention: local x maps to (cos, -sin)) to world and back.
  - `roadClear(plan: CityPlan, x: number, z: number): number` is the clearance from the nearest non-alley carriageway edge.
  - `footprintsOverlap(zone: FallZone, a: FallColumn, b: FallColumn, pad: number): boolean`.
  - Internal: `hash3(a, b, c): number`, `gridSpan(lo, hi): number`, `column(...)`, `pileOn(c, r)`, `siteNear(...)`, `placeColumns(...)`.

- [ ] **Step 1: Write the failing test.** Add these imports to the top of `src/world/__selftest_fallzone.ts`:

```ts
import { GROUND_Y } from './citygen';
import {
  CORE_CLEAR, PIER_PITCH, PIER_SHIFT, SHAFT_CLEAR,
  buildFallZone, footprintsOverlap, onFrame, roadClear,
} from './fallzone';
```

(merge `GROUND_Y` into the existing `./citygen` import line rather than adding a second one). Then add this function above the `belt();` call, and call it after `belt();`:

```ts
function columns(): void {
  console.log('\nCOLUMNS');
  for (const seed of SEEDS) {
    const t0 = performance.now();
    const z = buildFallZone(seed);
    const ms = performance.now() - t0;
    if (JSON.stringify(z) !== JSON.stringify(buildFallZone(seed))) fail(`seed ${seed}: two builds of the fall zone differ`);
    // Every bake worker builds the zone once at boot: keep it cheap.
    if (seed === DEFAULT_SEED) console.log(`  default seed builds in ${ms.toFixed(0)} ms`);
    if (seed === DEFAULT_SEED && ms > 1500) fail(`the fall zone takes ${ms.toFixed(0)} ms to build`);
    const f = districtField(seed), plan = cityPlan(seed);
    const by = new Map<string, number>();
    for (const c of z.columns) by.set(c.kind, (by.get(c.kind) ?? 0) + 1);
    const n = z.columns.length;
    const share = (k: string): number => (by.get(k) ?? 0) / Math.max(1, n);
    console.log(`  seed ${seed.toString(16).padStart(6)}: ${String(n).padStart(3)} columns  `
      + ['pier', 'core', 'silo', 'stack', 'lattice', 'spire'].map((k) => `${k} ${by.get(k) ?? 0}`).join('  '));
    z.columns.forEach((c, i) => { if (c.id !== i) fail(`seed ${seed}: column ${i} carries id ${c.id}`); });
    for (const c of z.columns) {
      const band = beltBand(f, c.x, c.z);
      if (band !== (c.kind === 'core' ? 2 : 1)) fail(`seed ${seed}: ${c.kind} ${c.id} stands in belt band ${band}`);
      const need = c.kind === 'core' ? CORE_CLEAR : c.kind === 'spire' ? c.halfX + 2 : SHAFT_CLEAR;
      const clear = roadClear(plan, c.x, c.z);
      if (clear < need - 1e-6) fail(`seed ${seed}: ${c.kind} ${c.id} stands ${clear.toFixed(1)} m from a road edge (needs ${need.toFixed(1)})`);
      if (c.node) {
        const [nx, nz] = onFrame(z.gridX, z.gridZ, z.gridYaw, c.node[0] * PIER_PITCH, c.node[1] * PIER_PITCH);
        const off = Math.hypot(c.x - nx, c.z - nz);
        if (off > PIER_SHIFT + 1e-6) fail(`seed ${seed}: ${c.kind} ${c.id} is ${off.toFixed(1)} m off its grid node`);
      }
      if (c.kind === 'pier' && c.top > z.deckY + 1e-6) fail(`seed ${seed}: pier ${c.id} rises above the deck`);
      if (c.kind === 'pier' && c.break === 'intact' && Math.abs(c.top - z.deckY) > 1e-6) fail(`seed ${seed}: intact pier ${c.id} is not at deck level`);
      if (c.pileTop - GROUND_Y > 230 || c.pileBase >= c.pileTop) fail(`seed ${seed}: ${c.kind} ${c.id} pile ${c.pileBase.toFixed(0)}-${c.pileTop.toFixed(0)} m is out of range`);
    }
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        if (footprintsOverlap(z, z.columns[a], z.columns[b], 0)) fail(`seed ${seed}: columns ${a} and ${b} overlap`);
      }
    }
    if (new Set(z.columns.map((c) => c.seed)).size !== n) fail(`seed ${seed}: two columns share a seed`);
    const spires = by.get('spire') ?? 0, deckSites = n - (by.get('core') ?? 0);
    if (spires > 5 || (deckSites >= 100 && spires < 3) || (deckSites >= 40 && spires < 1)) {
      fail(`seed ${seed}: ${spires} spire stumps for ${deckSites} deck-grid columns`);
    }
    if (seed !== DEFAULT_SEED) continue;
    if (share('pier') < 0.5) fail(`piers are ${(100 * share('pier')).toFixed(0)}% of columns, not most`);
    if (share('core') < 0.05) fail(`stripped cores are only ${(100 * share('core')).toFixed(0)}%`);
    if (share('silo') + share('stack') < 0.03) fail('almost no silos or stacks');
    if (share('lattice') < 0.03) fail('almost no lattice legs');
    const tops = z.columns.filter((c) => c.kind !== 'silo' && c.kind !== 'stack')
      .map((c) => c.pileTop - GROUND_Y).sort((p, q) => p - q);
    const med = tops[tops.length >> 1];
    console.log(`  village tops: median ${med.toFixed(0)} m, ${tops[0].toFixed(0)}-${tops[tops.length - 1].toFixed(0)} m`);
    if (med < 75 || med > 185) fail(`median village top ${med.toFixed(0)} m is outside 75-185 m`);
    const broken = z.columns.filter((c) => c.kind === 'pier' && c.break !== 'intact').map((c) => c.top);
    const mean = broken.reduce((s, v) => s + v, 0) / broken.length;
    const sd = Math.sqrt(broken.reduce((s, v) => s + (v - mean) ** 2, 0) / broken.length);
    if (sd < 15) fail(`broken pier tops vary by only ${sd.toFixed(1)} m: the forest reads as one height`);
  }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
Expected: FAIL with "Failed to load url ./fallzone" (the module does not exist).

- [ ] **Step 3: Create `src/world/fallzone.ts`**

```ts
/**
 * The fall zone (DESIGN §8 "Section B's makeshift village", DECISIONS D33): where
 * the fallen megastructure's remains stand and what stands on them. Pure placement
 * data, one per seed: the columns (deck piers, stripped cores, silos and stacks,
 * lattice legs, spire stumps), the deck fragments and bridges between their
 * villages, the off-limits patches, the wreckage on the ground and the village
 * ropeways. citygen clears old buildings out of their way, fallmesh draws them,
 * networks hangs the ropeways and the crowd thins out inside the zone.
 *
 * The deck came after the lower city (owner, 2026-10-15): its piers keep a nominal
 * grid but shift up to PIER_SHIFT off streets, arterials, the rail, the market and
 * the canal. Alleys and old buildings it disregarded: a pier may stand in an alley,
 * and the buildings it needed are gone.
 *
 * citygen imports this module too (buildChunk), so imported bindings are read only
 * inside functions, never in top-level initialisers.
 */

import { clamp, fbm2, makeRng, type Rng, type Vec3 } from '../core/math';
import { GROUND_Y, cityPlan, defaultCityConfig, sampleStreetPlan, type CityPlan, type StreetSample } from './citygen';
import { beltBand, spineHit, type DistrictField, type SpineHit } from './districts';

// ---------------------------------------------------------------- tuning

/** Deck level above the street (DESIGN §8: "the deck stood at ~150 m"). */
export const DECK_H = 150;
/** Nominal pier grid pitch: the regular spacing that says "one structure". */
export const PIER_PITCH = 48;
/** How far a pier may shift off its grid node to clear a street. */
export const PIER_SHIFT = 14;
/** Distance a deck-grid shaft keeps from any carriageway edge that is not an alley. */
export const SHAFT_CLEAR = 12;
/** The same for a stripped core, which is narrower. */
export const CORE_CLEAR = 9;
/** One stacked box: a shipping container is 2.6 m tall. */
export const BOX_H = 2.6;
const CORE_PITCH_ALONG = 34, CORE_PITCH_ACROSS = 58;
/** A pier that fell entirely: rubble and a slab, no column. */
const PIER_MISSING = 0.18;
const PIER_INTACT = 0.2;
const SALVAGE_CUT = 0.1;
/** Silos and stacks stand along the railway, within this of its centreline. */
const NEAR_RAIL = 45;
const SILO_SHARE = 0.55;
const STACK_SHARE = 0.3;
/** Lattice legs stand at the deck's outer edge. */
const LATTICE_SHARE = 0.2;
const CORE_KEEP = 0.25;
const SPIRES_MIN = 3, SPIRES_MAX = 5;
const SPIRE_SPACING = 300;
/** First-pass mean of the repair knob, until the owner says how long ago it fell. */
const REPAIR_MEAN = 0.35;

// ---------------------------------------------------------------- types

export type ColumnKind = 'pier' | 'core' | 'silo' | 'stack' | 'lattice' | 'spire';
export type BreakKind = 'intact' | 'shear' | 'crater' | 'cut';
/** How people get up from the ground; 'none' only inside an off-limits patch. */
export type Access = 'core-stair' | 'stair-tower' | 'winch' | 'none';

/**
 * One column and the village on it. Plan extents are on the zone's grid frame
 * (`FallZone.gridYaw`): local x runs along the railway. Round kinds (silo, stack,
 * spire) read `halfX` as their radius, except a silo battery, whose `count`
 * cylinders run along local x over `halfX`.
 */
export interface FallColumn {
  id: number;
  kind: ColumnKind;
  x: number;
  z: number;
  /** Deck grid node for deck-grid kinds; null for stripped cores (estate lattice). */
  node: [number, number] | null;
  halfX: number;
  halfZ: number;
  count: number;
  /** World y of the shaft's top: its break, or its cap when intact. */
  top: number;
  break: BreakKind;
  pileHalfX: number;
  pileHalfZ: number;
  /** World y range of the village pile. */
  pileBase: number;
  pileTop: number;
  /** Everything the bake rolls for this column alone starts here. */
  seed: number;
  offLimits: boolean;
  access: Access;
  /** 0..1: how far the revival's repair has got (DESIGN §8 revival kit). */
  repair: number;
}

export interface DeckFragment { a: number; b: number; y: number; width: number }
export interface VillageBridge { a: number; b: number; ya: number; yb: number; kind: 'rope' | 'catwalk' | 'truss' }
export type PatchKind = 'fenced' | 'flooded' | 'overgrown';
/** An off-limits rectangle on the grid frame; nobody walks inside it. */
export interface OffLimitsPatch { x: number; z: number; halfX: number; halfZ: number; kind: PatchKind }
/** A fallen deck slab or a spire's body, yawed (rotationY) then tilted about its local x axis. */
export interface WreckPiece {
  kind: 'slab' | 'body';
  x: number;
  y: number;
  z: number;
  yaw: number;
  tilt: number;
  halfX: number;
  halfY: number;
  halfZ: number;
}
/** A village ropeway: a ground station, then pile-top stations on `columns`. */
export interface Ropeway { stations: Vec3[]; columns: number[] }

export interface FallZone {
  seed: number;
  gridX: number;
  gridZ: number;
  /** Yaw of the grid frame, MeshBuilder rotationY convention (local x -> (cos, -sin)). */
  gridYaw: number;
  deckY: number;
  columns: FallColumn[];
  decks: DeckFragment[];
  bridges: VillageBridge[];
  patches: OffLimitsPatch[];
  wreck: WreckPiece[];
  ropeways: Ropeway[];
}

// ---------------------------------------------------------------- frame

/** World (x, z) of local (a, b) on a frame yawed by `yaw` (MeshBuilder's rotationY). */
export const onFrame = (ox: number, oz: number, yaw: number, a: number, b: number): [number, number] => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [ox + a * c + b * s, oz - a * s + b * c];
};

/** Local (a, b) of world (x, z) on the same frame. */
export const toFrame = (ox: number, oz: number, yaw: number, x: number, z: number): [number, number] => {
  const c = Math.cos(yaw), s = Math.sin(yaw), dx = x - ox, dz = z - oz;
  return [dx * c - dz * s, dx * s + dz * c];
};

const hash3 = (a: number, b: number, c: number): number =>
  (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791)) >>> 0;

/** Grid half-span, in nodes, that covers the city box [lo, hi) at any yaw. */
const gridSpan = (lo: number, hi: number): number => Math.ceil(Math.hypot(Math.max(-lo, hi), Math.max(-lo, hi)) / PIER_PITCH) + 1;

const roadSample: StreetSample = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0 };

/** Clearance from the nearest carriageway edge that is not an alley. */
export const roadClear = (plan: CityPlan, x: number, z: number): number =>
  sampleStreetPlan(plan, x, z, roadSample, false).clearance;

/** Offsets inside PIER_SHIFT, nearest first: a pier moves as little as it can. */
const SHIFTS: [number, number][] = (() => {
  const o: [number, number][] = [];
  for (let a = -PIER_SHIFT; a <= PIER_SHIFT; a += 3.5) {
    for (let b = -PIER_SHIFT; b <= PIER_SHIFT; b += 3.5) if (Math.hypot(a, b) <= PIER_SHIFT) o.push([a, b]);
  }
  return o.sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]) || p[0] - q[0] || p[1] - q[1]);
})();

/** The nearest spot to a node, within PIER_SHIFT, that is in `band` and `clear` of the roads. */
function siteNear(plan: CityPlan, f: DistrictField, band: 1 | 2, x0: number, z0: number, yaw: number, clear: number): [number, number] | null {
  for (const [a, b] of SHIFTS) {
    const [x, z] = onFrame(x0, z0, yaw, a, b);
    if (beltBand(f, x, z) !== band || roadClear(plan, x, z) < clear) continue;
    return [x, z];
  }
  return null;
}

/** Whether two columns' plan footprints (shaft or pile, whichever is wider), grown by `pad`, overlap. Every column shares the grid yaw. */
export function footprintsOverlap(zone: FallZone, a: FallColumn, b: FallColumn, pad: number): boolean {
  const [ax, az] = toFrame(zone.gridX, zone.gridZ, zone.gridYaw, a.x, a.z);
  const [bx, bz] = toFrame(zone.gridX, zone.gridZ, zone.gridYaw, b.x, b.z);
  return Math.abs(ax - bx) < Math.max(a.halfX, a.pileHalfX) + Math.max(b.halfX, b.pileHalfX) + pad
    && Math.abs(az - bz) < Math.max(a.halfZ, a.pileHalfZ) + Math.max(b.halfZ, b.pileHalfZ) + pad;
}

// ---------------------------------------------------------------- columns

const column = (kind: ColumnKind, x: number, z: number, node: [number, number] | null, seed: number): FallColumn => ({
  id: -1, kind, x, z, node, halfX: 0, halfZ: 0, count: 1, top: 0, break: 'intact',
  pileHalfX: 0, pileHalfZ: 0, pileBase: 0, pileTop: 0, seed, offLimits: false, access: 'winch', repair: 0,
});

/** The village pile a column carries (DESIGN §8 "Each column kind gets its own village grammar"). */
function pileOn(c: FallColumn, r: Rng): void {
  const boxes = (lo: number, hi: number): number => r.int(lo, hi) * BOX_H;
  switch (c.kind) {
    case 'pier':
      c.pileHalfX = c.halfX * r.range(1.3, 2.0); c.pileHalfZ = c.halfZ * r.range(1.3, 2.0);
      c.pileBase = c.top - 1.5; c.pileTop = c.top + boxes(3, 10);
      break;
    case 'core':
      c.pileHalfX = c.halfX * r.range(1.1, 1.4); c.pileHalfZ = c.halfZ * r.range(1.1, 1.4);
      c.pileBase = c.top - 1; c.pileTop = c.top + boxes(5, 10);
      break;
    case 'silo':
      c.pileHalfX = c.halfX * 1.05; c.pileHalfZ = c.halfZ * 1.25;
      c.pileBase = c.top; c.pileTop = c.top + boxes(2, 4);
      break;
    case 'stack':
      c.pileHalfX = c.pileHalfZ = c.halfX * r.range(1.8, 2.4);
      c.pileTop = c.top - 4; c.pileBase = c.pileTop - boxes(1, 2);
      break;
    case 'lattice':
      c.pileHalfX = c.halfX * 0.85; c.pileHalfZ = c.halfZ * 0.85;
      c.pileTop = c.top - 3; c.pileBase = c.pileTop - boxes(3, 6);
      break;
    case 'spire':
      c.pileHalfX = c.pileHalfZ = c.halfX * 0.8;
      c.pileTop = c.top - 4; c.pileBase = c.top - r.range(20, 35);
      break;
  }
}

interface Site { i: number; j: number; x: number; z: number; r: Rng; edge: boolean; rail: number; clear: number }

/**
 * Every column: deck-grid sites (spires, silos and stacks, lattice legs, piers),
 * then the estates' stripped cores. `fallen` collects the nodes whose pier came
 * down entirely; their slabs are placed later.
 */
function placeColumns(zone: FallZone, plan: CityPlan, r: Rng, lo: number, hi: number, fallen: [number, number, number, number][]): FallColumn[] {
  const f = plan.districts, seed = zone.seed, yaw = zone.gridYaw;
  const hit: SpineHit = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, along: 0 };
  const inBox = (x: number, z: number): boolean => x >= lo && x < hi && z >= lo && z < hi;
  const node = (i: number, j: number): [number, number] => onFrame(zone.gridX, zone.gridZ, yaw, i * PIER_PITCH, j * PIER_PITCH);
  const N = gridSpan(lo, hi);

  const sites: Site[] = [];
  for (let j = -N; j <= N; j++) {
    for (let i = -N; i <= N; i++) {
      const [x0, z0] = node(i, j);
      if (!inBox(x0, z0) || beltBand(f, x0, z0) !== 1) continue;
      const nr = makeRng(hash3(i, j, seed ^ 0x9e1));
      if (nr.next() < PIER_MISSING) { fallen.push([x0, z0, i, j]); continue; }
      const at = siteNear(plan, f, 1, x0, z0, yaw, SHAFT_CLEAR);
      if (!at) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => {
        const [nx, nz] = node(i + di, j + dj);
        return beltBand(f, nx, nz) !== 1;
      });
      sites.push({ i, j, x: at[0], z: at[1], r: nr, edge, rail: spineHit(f.rail, at[0], at[1], hit).dist, clear: roadClear(plan, at[0], at[1]) });
    }
  }

  const out: FallColumn[] = [];
  const taken = new Set<Site>();
  const keep = (c: FallColumn): boolean => {
    pileOn(c, makeRng(c.seed));
    if (out.some((o) => footprintsOverlap(zone, o, c, 3))) return false;
    out.push(c);
    return true;
  };

  // Spire stumps: spread along the railway, where a block is big enough to hold one.
  const roomy = sites.filter((s) => s.clear >= 24).sort((a, b) => a.i - b.i || a.j - b.j);
  const want = r.int(SPIRES_MIN, SPIRES_MAX);
  for (let k = 0; k < want && roomy.length > 0; k++) {
    const target = Math.round(((k + 0.5) / want) * (roomy.length - 1));
    for (let d = 0; d < 2 * roomy.length; d++) {
      const s = roomy[target + (d % 2 === 0 ? d / 2 : -(d + 1) / 2)];
      if (!s || taken.has(s)) continue;
      if (out.some((c) => Math.hypot(c.x - s.x, c.z - s.z) < SPIRE_SPACING)) continue;
      const c = column('spire', s.x, s.z, [s.i, s.j], hash3(s.i, s.j, seed ^ 0x5b1e));
      c.halfX = c.halfZ = Math.min(s.r.range(20, 40), s.clear - 4);
      c.top = GROUND_Y + s.r.range(130, 200);
      c.break = 'crater';
      if (!keep(c)) continue;
      taken.add(s);
      for (const o of sites) if (Math.hypot(o.x - s.x, o.z - s.z) < c.halfX + 18) taken.add(o);
      break;
    }
  }

  for (const s of sites) {
    if (taken.has(s)) continue;
    const seedOf = (salt: number): number => hash3(s.i, s.j, seed ^ salt);
    if (s.rail < NEAR_RAIL && s.r.next() < SILO_SHARE) {
      if (s.r.next() < STACK_SHARE) {
        const c = column('stack', s.x, s.z, [s.i, s.j], seedOf(0x57ac));
        c.halfX = c.halfZ = s.r.range(2.5, 4);
        c.top = GROUND_Y + s.r.range(80, 150);
        keep(c);
      } else {
        const rad = s.r.range(4, 6);
        const n = Math.min(s.r.int(3, 6), Math.floor(20 / rad));
        // The battery's end cylinders must clear the roads as its middle does.
        const ends = [-1, 1].every((e) => {
          const [ex, ez] = onFrame(s.x, s.z, yaw, e * (n - 1) * rad, 0);
          return roadClear(plan, ex, ez) >= rad + 2 && beltBand(f, ex, ez) === 1;
        });
        const c = column('silo', s.x, s.z, [s.i, s.j], seedOf(0x5110));
        c.count = ends ? n : 1;
        c.halfX = c.count * rad; c.halfZ = rad;
        c.top = GROUND_Y + s.r.range(40, 70);
        keep(c);
      }
      continue;
    }
    if (s.edge && s.r.next() < LATTICE_SHARE) {
      const c = column('lattice', s.x, s.z, [s.i, s.j], seedOf(0x1a77));
      c.halfX = c.halfZ = s.r.range(6, 9);
      const intact = s.r.next() < 0.3;
      c.break = intact ? 'intact' : 'shear';
      c.top = intact ? zone.deckY : GROUND_Y + DECK_H * s.r.range(0.6, 0.95);
      keep(c);
      continue;
    }
    const c = column('pier', s.x, s.z, [s.i, s.j], seedOf(0x9e7));
    c.halfX = s.r.range(4, 7);
    c.halfZ = c.halfX * s.r.range(0.85, 1);
    const roll = s.r.next();
    if (roll < PIER_INTACT) { c.break = 'intact'; c.top = zone.deckY; }
    else if (roll < PIER_INTACT + SALVAGE_CUT) { c.break = 'cut'; c.top = GROUND_Y + DECK_H * s.r.range(0.35, 0.7); }
    else { c.break = s.r.bool() ? 'shear' : 'crater'; c.top = GROUND_Y + DECK_H * s.r.range(0.4, 0.95); }
    keep(c);
  }

  // Stripped cores: the estates' towers cut back to their lift and stair shafts, in rows.
  const coreA = r.jitter(CORE_PITCH_ALONG / 2), coreB = r.jitter(CORE_PITCH_ACROSS / 2);
  const NA = Math.ceil((N * PIER_PITCH) / CORE_PITCH_ALONG), NC = Math.ceil((N * PIER_PITCH) / CORE_PITCH_ACROSS);
  for (let j = -NC; j <= NC; j++) {
    const rowH = makeRng(hash3(j, 0, seed ^ 0x2097)).range(70, 140);
    for (let i = -NA; i <= NA; i++) {
      const [x0, z0] = onFrame(zone.gridX, zone.gridZ, yaw, coreA + i * CORE_PITCH_ALONG, coreB + j * CORE_PITCH_ACROSS);
      if (!inBox(x0, z0) || beltBand(f, x0, z0) !== 2) continue;
      const er = makeRng(hash3(i, j, seed ^ 0xc02e));
      if (er.next() >= CORE_KEEP) continue;
      const at = siteNear(plan, f, 2, x0, z0, yaw, CORE_CLEAR);
      if (!at) continue;
      const c = column('core', at[0], at[1], null, hash3(i, j, seed ^ 0xc0e5));
      c.halfX = er.range(3, 5); c.halfZ = er.range(3, 5);
      c.top = GROUND_Y + rowH + er.jitter(4);
      keep(c);
    }
  }

  for (const c of out) {
    const cr = makeRng(c.seed ^ 0xacce55);
    c.access = c.kind === 'core' ? 'core-stair' : cr.next() < 0.4 ? 'stair-tower' : 'winch';
    c.repair = clamp(REPAIR_MEAN + 0.25 * fbm2(c.x * 0.004 + 11, c.z * 0.004 - 5, 2) + cr.jitter(0.1), 0, 1);
  }
  return out;
}

// ---------------------------------------------------------------- the zone

const zoneCache = new Map<number, FallZone>();

/** The fall zone for `seed`. Cached; safe to share. */
export function fallZone(seed: number): FallZone {
  const hit = zoneCache.get(seed);
  if (hit) return hit;
  const zone = buildFallZone(seed);
  if (zoneCache.size > 8) zoneCache.delete(zoneCache.keys().next().value as number);
  zoneCache.set(seed, zone);
  return zone;
}

/** Uncached build; the self-test calls it twice to prove determinism. */
export function buildFallZone(seed: number): FallZone {
  const plan = cityPlan(seed);
  const f = plan.districts;
  const r = makeRng((seed ^ 0x6fa11e2d) >>> 0);
  const cfg = defaultCityConfig(seed);
  const lo = -cfg.radiusChunks * cfg.chunkSize, hi = (cfg.radiusChunks + 1) * cfg.chunkSize;
  // Local x along the railway: rotationY maps local x to (cos, -sin), so negate the bearing.
  const gridYaw = -f.rail.bearing;
  const zone: FallZone = {
    seed, gridYaw, deckY: GROUND_Y + DECK_H,
    gridX: f.rail.originX + r.jitter(PIER_PITCH / 2), gridZ: f.rail.originZ + r.jitter(PIER_PITCH / 2),
    columns: [], decks: [], bridges: [], patches: [], wreck: [], ropeways: [],
  };
  const fallen: [number, number, number, number][] = [];
  zone.columns = placeColumns(zone, plan, r, lo, hi, fallen);
  zone.columns.forEach((c, i) => { c.id = i; });
  return zone;
}
```

- [ ] **Step 4: Run the test**

Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
Expected: a COLUMNS line per seed, then `VIOLATIONS none`. At the default seed, expect roughly 150-200 columns: piers ~60%, cores ~15%, silos and stacks ~10%, lattice ~10%, and 3-5 spires.

- [ ] **Step 5: Tune shares if needed.** If the default-seed shares miss the spec's targets (piers ~60%, cores ~15%, silos and stacks ~10%, lattice ~10%) by more than 5 points, adjust only these constants and re-run Step 4:
  - `CORE_KEEP` for cores;
  - `SILO_SHARE` for silos and stacks;
  - `LATTICE_SHARE` for lattice legs.

  If the default seed gets fewer than 3 spires, lower `SPIRE_SPACING` to 250 before touching the `roomy` threshold. The 24 m clearance is what holds a 40 m-across stump off the streets.

  If the build-time check fires, profile before optimising. The likely cost is `siteNear`'s up-to-61 `roadClear` calls per node; trying the nominal node first, before the shift list, is the cheap fix.

  Paste the final COLUMNS output into the commit body.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit` (expected: no output)

```bash
git add src/world/fallzone.ts src/world/__selftest_fallzone.ts
git commit -m "feat: fall zone columns: deck piers, cores, silos and stacks, lattice legs, spire stumps" -m "<paste the COLUMNS lines>"
```

---

### Task 3: Patches, wreck, decks, bridges, access and ropeways

**Files:**
- Modify: `src/world/fallzone.ts`
- Modify: `src/world/__selftest_fallzone.ts`

**Interfaces:**
- Consumes: everything Task 2 produced.
- Produces (exported from `src/world/fallzone.ts`):
  - Constants: `MAX_BRIDGE_GAP = 40`, `OFF_LIMITS_SHARE = 0.25`, `ROPE_SAG = 0.04`.
  - `patchAt(zone: FallZone, x: number, z: number): OffLimitsPatch | undefined`.
  - `shaftMeetsWreck(c: FallColumn, w: WreckPiece, pad: number): boolean`.
  - `segmentBlocked(zone, ax, az, bx, bz, skip: readonly number[], pad): boolean` reports whether the plan segment passes within `pad` of a column not in `skip`.
  - `reachable(zone: FallZone): Set<number>` returns the column ids people can reach from the ground.
  - After this task, `buildFallZone` fills `patches`, `wreck`, `decks`, `bridges` and `ropeways`, and sets `offLimits` and `access`.

- [ ] **Step 1: Write the failing test.** Extend the `./fallzone` import in the self-test with `patchAt, reachable, toFrame`. Add this function and call it after `columns();`:

```ts
function links(): void {
  console.log('\nLINKS & GROUND');
  for (const seed of SEEDS) {
    const z = buildFallZone(seed);
    const f = districtField(seed), plan = cityPlan(seed);
    const col = z.columns;
    // Off-limits: about a quarter of the deck band, sampled on a 12 m grid.
    let inBand = 0, inPatch = 0;
    for (let x = LO; x < HI; x += 12) {
      for (let q = LO; q < HI; q += 12) {
        if (beltBand(f, x, q) !== 1) continue;
        inBand++;
        if (patchAt(z, x, q)) inPatch++;
      }
    }
    const offShare = inPatch / Math.max(1, inBand);
    if (inBand > 0 && (offShare < 0.15 || offShare > 0.35)) fail(`seed ${seed}: off-limits covers ${(100 * offShare).toFixed(0)}% of the deck band`);
    for (const c of col) {
      if (c.offLimits !== !!patchAt(z, c.x, c.z)) fail(`seed ${seed}: column ${c.id} offLimits flag disagrees with the patches`);
      if (c.offLimits && c.access !== 'none') fail(`seed ${seed}: off-limits column ${c.id} has ground access (${c.access})`);
      if (!c.offLimits && c.access === 'none') fail(`seed ${seed}: open column ${c.id} has no way up`);
    }
    // Everyone can get home: ground access, then decks, bridges and ropeways.
    const seen = reachable(z);
    const stranded = col.filter((c) => !seen.has(c.id)).length;
    if (stranded > 0) fail(`seed ${seed}: ${stranded} columns cannot be reached from the ground`);
    // Spans: decks join grid-adjacent intact piers; bridges stay short; nothing passes through a third pile.
    for (const d of z.decks) {
      const a = col[d.a], b = col[d.b];
      const adj = a.node && b.node && Math.abs(a.node[0] - b.node[0]) + Math.abs(a.node[1] - b.node[1]) === 1;
      if (a.kind !== 'pier' || b.kind !== 'pier' || a.break !== 'intact' || b.break !== 'intact' || !adj) fail(`seed ${seed}: deck ${d.a}-${d.b} does not join adjacent intact piers`);
    }
    const spans: [number, number, number, number, number[]][] = [
      ...z.decks.map((d) => [col[d.a].x, col[d.a].z, col[d.b].x, col[d.b].z, [d.a, d.b]] as [number, number, number, number, number[]]),
      ...z.bridges.map((b) => [col[b.a].x, col[b.a].z, col[b.b].x, col[b.b].z, [b.a, b.b]] as [number, number, number, number, number[]]),
      ...z.ropeways.flatMap((rw) => rw.stations.slice(1).map((s, k) => {
        const p = rw.stations[k];
        return [p[0], p[2], s[0], s[2], k === 0 ? [rw.columns[0]] : [rw.columns[k - 1], rw.columns[k]]] as [number, number, number, number, number[]];
      })),
    ];
    let through = 0;
    for (const [ax, az, bx, bz, skip] of spans) {
      const len = Math.hypot(bx - ax, bz - az);
      for (let t = 0; t <= len; t += 1) {
        const px = ax + ((bx - ax) * t) / len, pz = az + ((bz - az) * t) / len;
        const [pa, pb] = toFrame(z.gridX, z.gridZ, z.gridYaw, px, pz);
        const hitCol = col.find((c) => {
          if (skip.includes(c.id)) return false;
          const [ca, cb] = toFrame(z.gridX, z.gridZ, z.gridYaw, c.x, c.z);
          return Math.abs(pa - ca) < Math.max(c.halfX, c.pileHalfX) && Math.abs(pb - cb) < Math.max(c.halfZ, c.pileHalfZ);
        });
        if (hitCol) { through++; break; }
      }
    }
    if (through > 0) fail(`seed ${seed}: ${through} spans pass through a third pile`);
    const longBridges = z.bridges.filter((b) => {
      const a = col[b.a], c = col[b.b];
      return Math.hypot(a.x - c.x, a.z - c.z) > 160;
    }).length;
    if (longBridges > 0) fail(`seed ${seed}: ${longBridges} bridges span more than 160 m`);
    // Slabs keep off every carriageway but alleys, outside the fences.
    let onRoad = 0;
    for (const w of z.wreck) {
      if (w.kind !== 'slab' || patchAt(z, w.x, w.z)) continue;
      for (let u = -1; u <= 1; u += 0.25) {
        for (let v = -1; v <= 1; v += 0.25) {
          const [px, pz] = onFrame(w.x, w.z, w.yaw, u * w.halfX, v * w.halfZ * Math.cos(w.tilt));
          if (roadClear(plan, px, pz) < 0) { onRoad++; u = v = 2; }
        }
      }
    }
    if (onRoad > 0) fail(`seed ${seed}: ${onRoad} slabs lie on a street outside the fences`);
    const bodies = z.wreck.filter((w) => w.kind === 'body').length;
    if (bodies !== col.filter((c) => c.kind === 'spire').length) fail(`seed ${seed}: ${bodies} spire bodies for the spire stumps`);
    if (seed === DEFAULT_SEED) {
      const perPile = z.bridges.length / Math.max(1, col.length);
      console.log(`  default seed: ${z.patches.length} patches (${(100 * offShare).toFixed(0)}% of the deck band), `
        + `${z.wreck.length - bodies} slabs, ${bodies} bodies, ${z.decks.length} decks, ${z.bridges.length} bridges `
        + `(${perPile.toFixed(2)} per pile), ${z.ropeways.length} ropeways (${z.ropeways.map((rw) => rw.columns.length).join(', ')} stations)`);
      if (perPile < 0.5 || perPile > 1.5) fail(`${perPile.toFixed(2)} bridges per pile, not about one`);
      if (z.ropeways.length < 1) fail('no village ropeway');
      if (z.wreck.length - bodies < 15) fail(`only ${z.wreck.length - bodies} fallen slabs`);
    }
  }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
Expected: FAIL. `patchAt` and `reachable` are not exported.

- [ ] **Step 3: Add the tuning constants** under the existing tuning block in `src/world/fallzone.ts`:

```ts
/** Longest rope or catwalk between two piles, pile edge to pile edge. */
export const MAX_BRIDGE_GAP = 40;
/** Share of the deck band fenced, flooded or overgrown (DESIGN §8: about a quarter). */
export const OFF_LIMITS_SHARE = 0.25;
/** Ropeway cable sag as a share of its span; networks.ts hangs the line with it. */
export const ROPE_SAG = 0.04;
const SLAB_CHANCE = 0.3;
const DECK_KEEP = 0.6;
const ROPEWAYS = 2;
```

- [ ] **Step 4: Add the ground, links and access functions** to `src/world/fallzone.ts`, between the `columns` section and the `the zone` section:

```ts
// ---------------------------------------------------------------- ground

/** Deck-band grid cells, by their corner node (i, j). */
function deckCells(zone: FallZone, plan: CityPlan, lo: number, hi: number): [number, number][] {
  const out: [number, number][] = [];
  const N = gridSpan(lo, hi);
  for (let j = -N; j <= N; j++) {
    for (let i = -N; i <= N; i++) {
      const [x, z] = onFrame(zone.gridX, zone.gridZ, zone.gridYaw, (i + 0.5) * PIER_PITCH, (j + 0.5) * PIER_PITCH);
      if (x >= lo && x < hi && z >= lo && z < hi && beltBand(plan.districts, x, z) === 1) out.push([i, j]);
    }
  }
  return out;
}

/** The off-limits patch covering (x, z), if any. */
export function patchAt(zone: FallZone, x: number, z: number): OffLimitsPatch | undefined {
  const [a, b] = toFrame(zone.gridX, zone.gridZ, zone.gridYaw, x, z);
  return zone.patches.find((p) => {
    const [pa, pb] = toFrame(zone.gridX, zone.gridZ, zone.gridYaw, p.x, p.z);
    return Math.abs(a - pa) <= p.halfX && Math.abs(b - pb) <= p.halfZ;
  });
}

/** Fenced, flooded and overgrown rectangles of whole grid cells, until they cover OFF_LIMITS_SHARE of the deck band. */
function placePatches(zone: FallZone, plan: CityPlan, cells: [number, number][]): void {
  const P = PIER_PITCH, seed = zone.seed;
  const order = [...cells].sort((a, b) => hash3(a[0], a[1], seed ^ 0x0ff) - hash3(b[0], b[1], seed ^ 0x0ff) || a[0] - b[0] || a[1] - b[1]);
  const target = OFF_LIMITS_SHARE * cells.length * P * P;
  let area = 0;
  for (const [i, j] of order) {
    if (area >= target) break;
    const pr = makeRng(hash3(i, j, seed ^ 0x9a7c));
    const w = pr.int(1, 3), h = pr.int(1, 2);
    const ca = (i + 0.5 * w) * P, cb = (j + 0.5 * h) * P, hx = 0.5 * w * P, hz = 0.5 * h * P;
    const clash = zone.patches.some((p) => {
      const [pa, pb] = toFrame(zone.gridX, zone.gridZ, zone.gridYaw, p.x, p.z);
      return Math.abs(pa - ca) < p.halfX + hx && Math.abs(pb - cb) < p.halfZ + hz;
    });
    if (clash) continue;
    const [x, z] = onFrame(zone.gridX, zone.gridZ, zone.gridYaw, ca, cb);
    if (beltBand(plan.districts, x, z) !== 1) continue;
    const roll = pr.next();
    zone.patches.push({ x, z, halfX: hx, halfZ: hz, kind: roll < 0.4 ? 'fenced' : roll < 0.7 ? 'flooded' : 'overgrown' });
    area += 4 * hx * hz;
  }
}

/** Whether a column's shaft (as a disc grown by `pad`) meets a wreck piece's plan footprint. */
export function shaftMeetsWreck(c: FallColumn, w: WreckPiece, pad: number): boolean {
  const [lx, lz] = toFrame(w.x, w.z, w.yaw, c.x, c.z);
  const rad = Math.hypot(c.halfX, c.halfZ) + pad;
  return Math.abs(lx) < w.halfX + rad && Math.abs(lz) < w.halfZ * Math.cos(w.tilt) + rad;
}

/** Each spire's fallen body: a long ridge from its foot along the belt, cut short where the belt ends. */
function placeBodies(zone: FallZone, plan: CityPlan): void {
  for (const c of zone.columns) {
    if (c.kind !== 'spire') continue;
    const r = makeRng(c.seed ^ 0xb0d1);
    const ang = zone.gridYaw + (r.bool() ? 0 : Math.PI) + r.jitter(0.3);
    let len = r.range(150, 280);
    while (len > 80 && beltBand(plan.districts, ...onFrame(c.x, c.z, ang, c.halfX + len, 0)) === 0) len -= 20;
    const [x, z] = onFrame(c.x, c.z, ang, c.halfX + len / 2, 0);
    const halfZ = c.halfX * 0.6, halfY = c.halfX * 0.35;
    zone.wreck.push({ kind: 'body', x, y: GROUND_Y + halfY, z, yaw: ang, tilt: r.range(0.02, 0.08), halfX: len / 2, halfY, halfZ });
  }
}

/**
 * Fallen deck slabs: one at every node whose pier came down, and at SLAB_CHANCE of
 * the deck cells. Outside the fences a slab keeps off every carriageway but an
 * alley (paths stay open); it never lands on a standing column. Too big: shrink
 * twice, then give up.
 */
function placeSlabs(zone: FallZone, plan: CityPlan, cells: [number, number][], fallen: [number, number, number, number][]): void {
  const seed = zone.seed;
  const spots: { x: number; z: number; key: number }[] = fallen.map(([x, z, i, j]) => ({ x, z, key: hash3(i, j, seed ^ 0x51a1) }));
  for (const [i, j] of cells) {
    if (makeRng(hash3(i, j, seed ^ 0x51ab)).next() >= SLAB_CHANCE) continue;
    const [x, z] = onFrame(zone.gridX, zone.gridZ, zone.gridYaw, (i + 0.5) * PIER_PITCH, (j + 0.5) * PIER_PITCH);
    spots.push({ x, z, key: hash3(i, j, seed ^ 0x51a2) });
  }
  for (const s of spots) {
    const r = makeRng(s.key);
    const x = s.x + r.jitter(10), z = s.z + r.jitter(10);
    const yaw = zone.gridYaw + r.jitter(0.5), tilt = r.range(0.08, 0.6), halfY = 1.2;
    let hx = r.range(10, 25), hz = r.range(6, 14);
    const open = !patchAt(zone, x, z);
    for (let k = 0; k < 3; k++, hx *= 0.7, hz *= 0.7) {
      const piece: WreckPiece = { kind: 'slab', x, y: GROUND_Y + halfY * Math.cos(tilt) + hz * Math.sin(tilt), z, yaw, tilt, halfX: hx, halfY, halfZ: hz };
      // The self-test samples these same 9 x 9 points, so the two agree exactly.
      let onRoad = false;
      for (let u = -1; u <= 1 && !onRoad; u += 0.25) {
        for (let v = -1; v <= 1 && !onRoad; v += 0.25) {
          const [px, pz] = onFrame(x, z, yaw, u * hx, v * hz * Math.cos(tilt));
          if (roadClear(plan, px, pz) < 0.5) onRoad = true;
        }
      }
      if (open && onRoad) continue;
      if (zone.columns.some((c) => shaftMeetsWreck(c, piece, 2))) continue;
      zone.wreck.push(piece);
      break;
    }
  }
}

// ---------------------------------------------------------------- links

/** Plan gap between two columns' footprints along the line between them (conservative). */
const pileGap = (a: FallColumn, b: FallColumn): number =>
  Math.hypot(a.x - b.x, a.z - b.z) - Math.max(a.pileHalfX, a.pileHalfZ, a.halfX) - Math.max(b.pileHalfX, b.pileHalfZ, b.halfX);

/** Slab test: does the segment (x0,z0)-(x1,z1) meet the box |x| <= hx, |z| <= hz? */
function segHitsBox(x0: number, z0: number, x1: number, z1: number, hx: number, hz: number): boolean {
  let t0 = 0, t1 = 1;
  for (const [p, d, h] of [[x0, x1 - x0, hx], [z0, z1 - z0, hz]]) {
    if (Math.abs(d) < 1e-9) { if (Math.abs(p) > h) return false; continue; }
    let ta = (-h - p) / d, tb = (h - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/** Whether the plan segment a->b passes within `pad` of any column not in `skip`. */
export function segmentBlocked(zone: FallZone, ax: number, az: number, bx: number, bz: number, skip: readonly number[], pad: number): boolean {
  const [p0, q0] = toFrame(zone.gridX, zone.gridZ, zone.gridYaw, ax, az);
  const [p1, q1] = toFrame(zone.gridX, zone.gridZ, zone.gridYaw, bx, bz);
  for (const c of zone.columns) {
    if (skip.includes(c.id)) continue;
    const [cx, cz] = toFrame(zone.gridX, zone.gridZ, zone.gridYaw, c.x, c.z);
    if (segHitsBox(p0 - cx, q0 - cz, p1 - cx, q1 - cz, Math.max(c.halfX, c.pileHalfX) + pad, Math.max(c.halfZ, c.pileHalfZ) + pad)) return true;
  }
  return false;
}

/** Deck fragments still spanning between grid-adjacent intact piers: streets in the sky. */
function placeDecks(zone: FallZone): void {
  const at = new Map<string, FallColumn>();
  for (const c of zone.columns) if (c.node) at.set(`${c.node[0]},${c.node[1]}`, c);
  for (const c of zone.columns) {
    if (c.kind !== 'pier' || c.break !== 'intact' || !c.node) continue;
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const o = at.get(`${c.node[0] + di},${c.node[1] + dj}`);
      if (!o || o.kind !== 'pier' || o.break !== 'intact') continue;
      const r = makeRng(hash3(c.id, o.id, zone.seed ^ 0xdec));
      if (r.next() >= DECK_KEEP) continue;
      // Shifted piers can bring a third column into the gap; the fragment fell there.
      if (segmentBlocked(zone, c.x, c.z, o.x, o.z, [c.id, o.id], 1)) continue;
      zone.decks.push({ a: c.id, b: o.id, y: zone.deckY, width: r.range(14, 24) });
    }
  }
}

function bridgeBetween(zone: FallZone, a: FallColumn, b: FallColumn): VillageBridge {
  const r = makeRng(hash3(a.id, b.id, zone.seed ^ 0xb21d));
  const y = Math.min(a.pileTop, b.pileTop) - BOX_H;
  return {
    a: a.id, b: b.id,
    ya: clamp(y, a.pileBase + 1, a.pileTop - 1), yb: clamp(y, b.pileBase + 1, b.pileTop - 1),
    kind: a.kind === 'lattice' && b.kind === 'lattice' ? 'truss' : r.next() < 0.6 ? 'rope' : 'catwalk',
  };
}

/** About one bridge per pile: each column to its nearest neighbour, if close, unlinked and clear of third piles. */
function placeBridges(zone: FallZone): void {
  const linked = new Set<string>();
  const key = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);
  for (const d of zone.decks) linked.add(key(d.a, d.b));
  for (const c of zone.columns) {
    let best: FallColumn | null = null, gap = Infinity;
    for (const o of zone.columns) {
      if (o === c) continue;
      const g = pileGap(c, o);
      if (g < gap) { gap = g; best = o; }
    }
    if (!best || gap > MAX_BRIDGE_GAP || linked.has(key(c.id, best.id))) continue;
    if (segmentBlocked(zone, c.x, c.z, best.x, best.z, [c.id, best.id], 1)) continue;
    linked.add(key(c.id, best.id));
    zone.bridges.push(bridgeBetween(zone, c, best));
  }
}

const stationSample: StreetSample = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0 };

/** A ground station beside a road, off the belt, straight across the belt from `c`. */
function groundStation(zone: FallZone, plan: CityPlan, c: FallColumn): [number, number] | null {
  for (let d = 0; d <= 400; d += 8) {
    for (const side of [1, -1]) {
      const [x, z] = onFrame(c.x, c.z, zone.gridYaw, 0, side * d);
      if (beltBand(plan.districts, x, z) !== 0) continue;
      const s = sampleStreetPlan(plan, x, z, stationSample);
      if (s.clearance >= 1.5 && s.clearance <= 8) return [x, z];
    }
  }
  return null;
}

/** A ropeway from the nearest ground station up to `start`, then up to `hops` more piles, off-limits ones first. */
function ropewayFrom(zone: FallZone, plan: CityPlan, start: FallColumn, used: Set<number>, hops: number): Ropeway | null {
  const g = groundStation(zone, plan, start);
  if (!g || segmentBlocked(zone, g[0], g[1], start.x, start.z, [start.id], 1)) return null;
  const rw: Ropeway = { stations: [[g[0], GROUND_Y + 4, g[1]]], columns: [] };
  let at = start;
  for (let k = 0; k <= hops; k++) {
    rw.columns.push(at.id);
    used.add(at.id);
    rw.stations.push([at.x, at.pileTop + 3, at.z]);
    const from = at;
    const next = zone.columns
      .filter((o) => !used.has(o.id) && Math.hypot(o.x - from.x, o.z - from.z) >= 40 && Math.hypot(o.x - from.x, o.z - from.z) <= 160)
      .sort((p, q) => Number(q.offLimits) - Number(p.offLimits)
        || Math.hypot(p.x - from.x, p.z - from.z) - Math.hypot(q.x - from.x, q.z - from.z) || p.id - q.id)
      .find((o) => !segmentBlocked(zone, from.x, from.z, o.x, o.z, [from.id, o.id], 1));
    if (!next) break;
    at = next;
  }
  return rw;
}

/** ROPEWAYS lines, each starting 300 m or more from the others, off-limits and tall piles first. */
function placeRopeways(zone: FallZone, plan: CityPlan): void {
  const used = new Set<number>();
  const order = [...zone.columns].sort((p, q) => Number(q.offLimits) - Number(p.offLimits) || q.pileTop - p.pileTop || p.id - q.id);
  for (const c of order) {
    if (zone.ropeways.length >= ROPEWAYS) break;
    if (used.has(c.id)) continue;
    if (zone.ropeways.some((rw) => Math.hypot(rw.stations[1][0] - c.x, rw.stations[1][2] - c.z) < 300)) continue;
    const rw = ropewayFrom(zone, plan, c, used, 3);
    if (rw && rw.columns.length >= 2) zone.ropeways.push(rw);
    else if (rw) for (const id of rw.columns) used.delete(id);
  }
}

/** Column ids people can reach from the ground: their own access, then across decks, bridges and ropeways. */
export function reachable(zone: FallZone): Set<number> {
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  };
  for (const d of zone.decks) link(d.a, d.b);
  for (const b of zone.bridges) link(b.a, b.b);
  for (const rw of zone.ropeways) for (let k = 1; k < rw.columns.length; k++) link(rw.columns[k - 1], rw.columns[k]);
  const queue = zone.columns.filter((c) => c.access !== 'none').map((c) => c.id);
  for (const rw of zone.ropeways) if (rw.columns.length > 0) queue.push(rw.columns[0]);
  const seen = new Set<number>();
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const n of adj.get(id) ?? []) if (!seen.has(n)) queue.push(n);
  }
  return seen;
}

/**
 * Nobody is stranded: a column nobody can reach gets a bridge to the nearest
 * reachable one (clear of third piles), else a ropeway of its own, else, as a
 * last resort the self-test reports, a winch.
 */
function connectStranded(zone: FallZone, plan: CityPlan): void {
  for (;;) {
    const seen = reachable(zone);
    const stranded = zone.columns.find((c) => !seen.has(c.id));
    if (!stranded) return;
    const to = zone.columns.filter((c) => seen.has(c.id) && Math.hypot(c.x - stranded.x, c.z - stranded.z) <= 160)
      .sort((p, q) => pileGap(stranded, p) - pileGap(stranded, q) || p.id - q.id)
      .slice(0, 10)
      .find((o) => !segmentBlocked(zone, stranded.x, stranded.z, o.x, o.z, [stranded.id, o.id], 1));
    if (to) { zone.bridges.push(bridgeBetween(zone, stranded, to)); continue; }
    const rw = ropewayFrom(zone, plan, stranded, new Set(), 0);
    if (rw) { zone.ropeways.push(rw); continue; }
    stranded.access = 'winch';
  }
}
```

- [ ] **Step 5: Wire them into `buildFallZone`.** Replace the two lines after `const fallen ...` with:

```ts
  zone.columns = placeColumns(zone, plan, r, lo, hi, fallen);
  const cells = deckCells(zone, plan, lo, hi);
  placePatches(zone, plan, cells);
  // A spire's body knocked down every column it fell across.
  placeBodies(zone, plan);
  zone.columns = zone.columns.filter((c) => c.kind === 'spire' || !zone.wreck.some((w) => shaftMeetsWreck(c, w, 2)));
  zone.columns.forEach((c, i) => { c.id = i; });
  for (const c of zone.columns) if (patchAt(zone, c.x, c.z)) { c.offLimits = true; c.access = 'none'; }
  placeSlabs(zone, plan, cells, fallen);
  placeDecks(zone);
  placeBridges(zone);
  placeRopeways(zone, plan);
  connectStranded(zone, plan);
  return zone;
```

- [ ] **Step 6: Run the test**

Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
Expected: COLUMNS lines, then the `default seed: ... patches ... ropeways` line, then `VIOLATIONS none`.

The likeliest violation is "off-limits covers N%". Patches are counted at full size even where they hang off the band. If that fires, raise `OFF_LIMITS_SHARE` in 0.05 steps until the measured share lands in 20-30%, and note the final value in the commit body.

If "bridges per pile" comes in under 0.5, raise `MAX_BRIDGE_GAP` in 5 m steps (frame 2's bridges are long). If "fallen slabs" comes in under 15, raise `SLAB_CHANCE`. Do not loosen the road test: paths stay open.

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit` (expected: no output)

```bash
git add src/world/fallzone.ts src/world/__selftest_fallzone.ts
git commit -m "feat: fall zone ground and links: patches, wreck, decks, bridges, access, ropeways" -m "<paste the LINKS & GROUND line>"
```

---

### Task 4: The old city makes way, and each chunk carries its share

**Files:**
- Modify: `src/world/fallzone.ts` (chunk slicing, building clearance)
- Modify: `src/world/citygen.ts` (`CityChunk.fall`, `buildChunk`, `LotAudit`, `auditChunkLots`)
- Modify: `src/world/__selftest.ts:345-353, 666` (sum and print `fall`)
- Modify: `src/world/__selftest_fallzone.ts`

**Interfaces:**
- Consumes: `fallZone`, `onFrame`, `ROPE_SAG` (Tasks 2-3).
- Produces:
  - `interface FallChunk { yaw: number; columns: FallColumn[]; decks: { deck: DeckFragment; a: FallColumn; b: FallColumn }[]; bridges: { bridge: VillageBridge; a: FallColumn; b: FallColumn }[]; patches: OffLimitsPatch[]; wreck: WreckPiece[]; stations: Vec3[] }`.
  - `fallChunk(zone: FallZone, ox: number, oz: number, size: number): FallChunk` gives each item to the chunk holding its anchor (a centre, or a span's midpoint), so every item lands in exactly one chunk.
  - `fallClears(seed: number, min: Vec3, max: Vec3): boolean` reports whether an old building with these bounds made way.
  - `CityChunk.fall: FallChunk`.
  - `LotAudit.fall: number`.

- [ ] **Step 1: Write the failing test.**
  1. Add to the self-test's imports: `City, defaultCityConfig, footprintAabb` from `./citygen`; `fallZone` from `./fallzone`; `type Vec3` from `../core/math`.
  2. Add this function and call it after `links();`.

```ts
function cityBlock(): void {
  console.log('\nCITY');
  const seed = DEFAULT_SEED, z = fallZone(seed), city = new City(defaultCityConfig(seed));
  const colCount = new Map<number, number>(), wreckCount = new Map<number, number>();
  let decks = 0, bridges = 0, stations = 0, buildings = 0, overShaft = 0, underPile = 0, onStation = 0, underCable = 0;
  const cables: { a: Vec3; b: Vec3 }[] = z.ropeways.flatMap((rw) => rw.stations.slice(1).map((b, k) => ({ a: rw.stations[k], b })));
  for (let cx = -6; cx <= 6; cx++) {
    for (let cz = -6; cz <= 6; cz++) {
      const ch = city.getChunk(cx, cz);
      if (!ch) continue;
      for (const c of ch.fall.columns) colCount.set(c.id, (colCount.get(c.id) ?? 0) + 1);
      for (const w of ch.fall.wreck) { const k = z.wreck.indexOf(w); wreckCount.set(k, (wreckCount.get(k) ?? 0) + 1); }
      decks += ch.fall.decks.length; bridges += ch.fall.bridges.length; stations += ch.fall.stations.length;
      for (const b of ch.buildings) {
        buildings++;
        const [lo, hi] = footprintAabb(b);
        for (const c of z.columns) {
          // Distance from the column's centre to the footprint: under the shaft's (or the
          // pile's) inscribed half-width means they certainly overlap.
          const gap = Math.hypot(Math.max(lo[0] - c.x, 0, c.x - hi[0]), Math.max(lo[2] - c.z, 0, c.z - hi[2]));
          if (gap < Math.min(c.halfX, c.halfZ)) overShaft++;
          if (b.aabbMax[1] > c.pileBase && gap < Math.min(c.pileHalfX, c.pileHalfZ)) underPile++;
        }
        for (const rw of z.ropeways) {
          const g = rw.stations[0];
          if (g[0] > lo[0] - 3 && g[0] < hi[0] + 3 && g[2] > lo[2] - 3 && g[2] < hi[2] + 3) onStation++;
        }
        for (const { a, b: e } of cables) {
          const len = Math.hypot(e[0] - a[0], e[2] - a[2]);
          for (let t = 0; t <= len; t += 2) {
            const px = a[0] + ((e[0] - a[0]) * t) / len, pz = a[2] + ((e[2] - a[2]) * t) / len;
            const py = a[1] + ((e[1] - a[1]) * t) / len - len * 0.04;
            if (px > lo[0] && px < hi[0] && pz > lo[2] && pz < hi[2] && b.aabbMax[1] > py) { underCable++; break; }
          }
        }
      }
    }
  }
  // Items anchored outside the city's chunks (a pier shifted past the edge, a
  // station found beyond it) are baked by no chunk, by design.
  const inCity = (x: number, q: number): boolean => x >= LO && x < HI && q >= LO && q < HI;
  const col = z.columns;
  const midIn = (a: number, b: number): boolean => inCity((col[a].x + col[b].x) / 2, (col[a].z + col[b].z) / 2);
  const missCol = col.filter((c) => inCity(c.x, c.z) && colCount.get(c.id) !== 1).length;
  const missWreck = z.wreck.filter((w, k) => inCity(w.x, w.z) && wreckCount.get(k) !== 1).length;
  const wantDecks = z.decks.filter((d) => midIn(d.a, d.b)).length;
  const wantBridges = z.bridges.filter((b) => midIn(b.a, b.b)).length;
  const wantStations = z.ropeways.filter((rw) => inCity(rw.stations[0][0], rw.stations[0][2])).length;
  console.log(`  ${buildings} buildings stand; chunks carry ${colCount.size} columns, ${wreckCount.size} wreck pieces, ${decks} decks, ${bridges} bridges, ${stations} stations`);
  if (missCol > 0) fail(`${missCol} columns are baked by zero or several chunks`);
  if (missWreck > 0) fail(`${missWreck} wreck pieces are baked by zero or several chunks`);
  if (decks !== wantDecks) fail(`chunks carry ${decks} decks of ${wantDecks}`);
  if (bridges !== wantBridges) fail(`chunks carry ${bridges} bridges of ${wantBridges}`);
  if (stations !== wantStations) fail(`chunks carry ${stations} ropeway stations of ${wantStations}`);
  if (overShaft > 0) fail(`${overShaft} old buildings still stand on a column's shaft`);
  if (underPile > 0) fail(`${underPile} old buildings rise into a village pile`);
  if (onStation > 0) fail(`${onStation} old buildings stand on a ropeway ground station`);
  if (underCable > 0) fail(`${underCable} old buildings rise through a ropeway cable`);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
Expected: FAIL. `ch.fall` is undefined: "Cannot read properties of undefined (reading 'columns')".

- [ ] **Step 3: Add chunk slicing and building clearance** to the end of `src/world/fallzone.ts`:

```ts
// ---------------------------------------------------------------- chunks

/** What one chunk bakes of the zone: everything anchored inside it, resolved. */
export interface FallChunk {
  /** The grid frame's yaw; every column and patch is aligned to it. */
  yaw: number;
  columns: FallColumn[];
  decks: { deck: DeckFragment; a: FallColumn; b: FallColumn }[];
  bridges: { bridge: VillageBridge; a: FallColumn; b: FallColumn }[];
  patches: OffLimitsPatch[];
  wreck: WreckPiece[];
  /** Ropeway ground stations: the hut at the foot of each line. */
  stations: Vec3[];
}

/** One chunk's share: an item belongs to the chunk holding its centre, a span to the one holding its midpoint. */
export function fallChunk(zone: FallZone, ox: number, oz: number, size: number): FallChunk {
  const inside = (x: number, z: number): boolean => x >= ox && x < ox + size && z >= oz && z < oz + size;
  const col = zone.columns;
  const mid = (a: FallColumn, b: FallColumn): boolean => inside((a.x + b.x) / 2, (a.z + b.z) / 2);
  return {
    yaw: zone.gridYaw,
    columns: col.filter((c) => inside(c.x, c.z)),
    decks: zone.decks.filter((d) => mid(col[d.a], col[d.b])).map((d) => ({ deck: d, a: col[d.a], b: col[d.b] })),
    bridges: zone.bridges.filter((b) => mid(col[b.a], col[b.b])).map((b) => ({ bridge: b, a: col[b.a], b: col[b.b] })),
    patches: zone.patches.filter((p) => inside(p.x, p.z)),
    wreck: zone.wreck.filter((w) => inside(w.x, w.z)),
    stations: zone.ropeways.map((rw) => rw.stations[0]).filter((s) => inside(s[0], s[2])),
  };
}

// ---------------------------------------------------------------- the old city makes way

/** A clearance shape: an old building meeting it in plan is gone if it rises above `y`. */
interface Clearance { minX: number; minZ: number; maxX: number; maxZ: number; y: number }
const CLEAR_CELL = 64;
const clearCache = new Map<number, Map<number, Clearance[]>>();
const cellKey = (gx: number, gz: number): number => (gx + 4096) * 8192 + (gz + 4096);

/**
 * What the old city made way for (owner, 2026-10-15: "some older building may have
 * been disrespected and disregarded"): shafts, wreck and ropeway huts from the
 * ground; piles, decks, bridges and ropeway cables from their undersides. Spans are
 * cut into 20 m pieces so a long diagonal does not clear a whole block.
 */
function clearances(zone: FallZone): Clearance[] {
  const out: Clearance[] = [];
  const ground = GROUND_Y - 1;
  const rect = (x: number, z: number, yaw: number, hx: number, hz: number, y: number): void => {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [u, v] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const [px, pz] = onFrame(x, z, yaw, u * hx, v * hz);
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
    }
    out.push({ minX, minZ, maxX, maxZ, y });
  };
  const span = (a: Vec3, b: Vec3, half: number, drop: number): void => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 20));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const x0 = a[0] + (b[0] - a[0]) * t0, z0 = a[2] + (b[2] - a[2]) * t0;
      const x1 = a[0] + (b[0] - a[0]) * t1, z1 = a[2] + (b[2] - a[2]) * t1;
      const y = Math.min(a[1] + (b[1] - a[1]) * t0, a[1] + (b[1] - a[1]) * t1) - drop;
      out.push({ minX: Math.min(x0, x1) - half, minZ: Math.min(z0, z1) - half, maxX: Math.max(x0, x1) + half, maxZ: Math.max(z0, z1) + half, y });
    }
  };
  for (const c of zone.columns) {
    rect(c.x, c.z, zone.gridYaw, c.halfX + 2, c.halfZ + 2, ground);
    rect(c.x, c.z, zone.gridYaw, c.pileHalfX + 2, c.pileHalfZ + 2, c.pileBase - 2);
  }
  for (const w of zone.wreck) rect(w.x, w.z, w.yaw, w.halfX + 1, w.halfZ + 1, ground);
  const col = zone.columns;
  for (const d of zone.decks) span([col[d.a].x, d.y, col[d.a].z], [col[d.b].x, d.y, col[d.b].z], d.width / 2 + 1, 3);
  for (const br of zone.bridges) span([col[br.a].x, br.ya, col[br.a].z], [col[br.b].x, br.yb, col[br.b].z], 2, 3);
  for (const rw of zone.ropeways) {
    const g = rw.stations[0];
    rect(g[0], g[2], zone.gridYaw, 4, 4, ground);
    for (let k = 1; k < rw.stations.length; k++) {
      const a = rw.stations[k - 1], b = rw.stations[k];
      span(a, b, 3, Math.hypot(b[0] - a[0], b[2] - a[2]) * ROPE_SAG + 4);
    }
  }
  return out;
}

function clearIndex(zone: FallZone): Map<number, Clearance[]> {
  const hit = clearCache.get(zone.seed);
  if (hit) return hit;
  const idx = new Map<number, Clearance[]>();
  for (const c of clearances(zone)) {
    for (let gx = Math.floor(c.minX / CLEAR_CELL); gx <= Math.floor(c.maxX / CLEAR_CELL); gx++) {
      for (let gz = Math.floor(c.minZ / CLEAR_CELL); gz <= Math.floor(c.maxZ / CLEAR_CELL); gz++) {
        const list = idx.get(cellKey(gx, gz));
        if (list) list.push(c); else idx.set(cellKey(gx, gz), [c]);
      }
    }
  }
  if (clearCache.size > 8) clearCache.delete(clearCache.keys().next().value as number);
  clearCache.set(zone.seed, idx);
  return idx;
}

/** Whether the old building with these bounds made way for the fall zone. */
export function fallClears(seed: number, min: Vec3, max: Vec3): boolean {
  const idx = clearIndex(fallZone(seed));
  for (let gx = Math.floor(min[0] / CLEAR_CELL); gx <= Math.floor(max[0] / CLEAR_CELL); gx++) {
    for (let gz = Math.floor(min[2] / CLEAR_CELL); gz <= Math.floor(max[2] / CLEAR_CELL); gz++) {
      for (const c of idx.get(cellKey(gx, gz)) ?? []) {
        if (max[0] > c.minX && min[0] < c.maxX && max[2] > c.minZ && min[2] < c.maxZ && max[1] > c.y) return true;
      }
    }
  }
  return false;
}
```

- [ ] **Step 4: Wire it into `src/world/citygen.ts`.**

Add the import below the `./districts` import:

```ts
import { fallChunk, fallClears, fallZone, type FallChunk } from './fallzone';
```

In `interface CityChunk`, after `districtByCell`:

```ts
  /** The fall zone's share of this chunk (fallzone.ts, DESIGN §8). */
  fall: FallChunk;
```

In `interface LotAudit`, after `overlap`:

```ts
  /** Made way for the fall zone's columns, wreck and spans. */
  fall: number;
```

In `buildChunk`, replace `if (b) candidates.push(b);` with:

```ts
      // The old city made way for the fall zone's columns, wreck and spans (DESIGN §8).
      if (b && !fallClears(plan.seed, b.aabbMin, b.aabbMax)) candidates.push(b);
```

In `buildChunk`, just before `let maxY = GROUND_Y;`:

```ts
  const fall = fallChunk(fallZone(plan.seed), ox, oz, size);
```

and after the existing `for (const b of buildings) ...maxY` line:

```ts
  for (const c of fall.columns) if (c.pileTop > maxY) maxY = c.pileTop;
```

and add `fall,` to the returned object after `districtByCell`.

In `auditChunkLots`:
- initialise `fall: 0` in `out`;
- replace `if (b) cands.push(b);` with:

```ts
      if (b && fallClears(plan.seed, b.aabbMin, b.aabbMax)) { out.fall++; continue; }
      if (b) cands.push(b);
```

In `src/world/__selftest.ts`:
- add `fall: 0` to the `lotAudit` literal (line 345);
- add `lotAudit.fall += a.fall;` beside the other sums;
- in the `lots` print line (line 666), insert ` / fall-zone ${lotAudit.fall}` before ` / kept`.

- [ ] **Step 5: Run the tests**

Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
Expected: a CITY line, then `VIOLATIONS none`.

Run: `npx --yes vite-node@6.0.0 src/world/__selftest.ts`
Expected: `VIOLATIONS   none — all invariants hold`, and the lots line now shows ` / fall-zone N`. Seed 42's 64 chunks may or may not reach the belt, so N can be 0.

Run each section and street test and read the last line:

```bash
for t in __selftest_sectionA __selftest_sectionB __selftest_sectionD __selftest_street __selftest_footway __selftest_market; do echo "== $t"; npx --yes vite-node@6.0.0 src/world/$t.ts 2>&1 | tail -2; done
```

Expected: every block ends `VIOLATIONS none` (`VIOLATIONS: none` for the market test). The deck band's old rust-hangars buildings are partly cleared, so section B's cable inversion check (Pearson(height, cables) > +0.15 over districts 3, 5 and 9) may move. If it drops to +0.15 or below, do not loosen it. Report the value in the commit body and in HANDOFF as an open item for the owner: that statistic measured buildings that the fall zone now replaces.

- [ ] **Step 6: Typecheck, build and commit**

Run: `npx tsc --noEmit && npx vite build`
Expected: clean. `citygen` and `fallzone` now import each other. That cycle is safe because `fallzone` reads `citygen`'s bindings only inside functions, and Vite drops Rollup's `CIRCULAR_DEPENDENCY` warning. If the build or a bake worker ever throws "Cannot access ... before initialization", a top-level initialiser in `fallzone.ts` has started reading an import: move it into a function.

```bash
git add src/world/fallzone.ts src/world/citygen.ts src/world/__selftest.ts src/world/__selftest_fallzone.ts
git commit -m "feat: old buildings make way for the fall zone, and chunks carry its share" -m "Shafts, wreck and ropeway huts clear the ground; piles, decks, bridges and cables clear what rises into them. Each item belongs to one chunk, by its anchor. The lot audit counts the fall-zone drop so it still reconciles."
```

---

### Task 5: The greybox, and the bolted-on rooms retire

**Files:**
- Create: `src/render/fallmesh.ts`
- Modify: `src/render/citymesh.ts:1493-1505` (bake loop), `:673` (`pushScaffold` doc)
- Modify: `src/world/__selftest_fallzone.ts`

**Interfaces:**
- Consumes: `FallChunk` (Task 4).
- Produces:
  - `pushOrientedBox(bld, c: Vec3, ax: Vec3, ay: Vec3, az: Vec3, h: Vec3, color: Vec3): void`, a box on any right-handed basis whose faces wind outward;
  - `yawTiltBasis(yaw: number, tilt: number): [Vec3, Vec3, Vec3]`;
  - `pushFallChunk(bld: MeshBuilder, fall: FallChunk, lod: number, obstacles: CrowdObstacle[]): void`.
  - Obstacle kinds: `fall-<column kind>`, `fall-slab`, `fall-body`, `fall-ropeway-station`, `off-limits-<patch kind>`.

- [ ] **Step 1: Write the failing test.** Add the imports `MeshBuilder` from `./geometry`, `pushOrientedBox, yawTiltBasis` from `../render/fallmesh` and `bakeChunk` from `../render/citymesh`. Add this function and call it after `cityBlock();`:

```ts
function greybox(): void {
  console.log('\nGREYBOX');
  // Every face of a yawed, tilted box winds outward (PITFALLS §34 is what happens otherwise).
  let inward = 0;
  for (let k = 0; k < 24; k++) {
    const c: Vec3 = [k, 3, -k];
    const mb = new MeshBuilder();
    pushOrientedBox(mb, c, ...yawTiltBasis(k * 0.7, (k % 6) * 0.11), [5, 1.2, 3], [0.5, 0.5, 0.5]);
    const m = mb.build();
    for (let i = 0; i < m.indexCount; i += 3) {
      const v = [0, 1, 2].map((q) => { const o = m.indices[i + q] * 3; return [m.positions[o], m.positions[o + 1], m.positions[o + 2]]; });
      const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const out = [0, 1, 2].map((a) => (v[0][a] + v[1][a] + v[2][a]) / 3 - c[a]);
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] <= 0) inward++;
    }
  }
  if (inward > 0) fail(`${inward} greybox triangles wind into their box`);

  // Every column, wreck piece, patch and station a chunk bakes registers its crowd obstacle.
  const seed = DEFAULT_SEED, city = new City(defaultCityConfig(seed));
  let want = 0, got = 0, chunks = 0;
  for (let cx = -6; cx <= 6; cx++) {
    for (let cz = -6; cz <= 6; cz++) {
      const ch = city.getChunk(cx, cz);
      if (!ch) continue;
      const n = ch.fall.columns.length + ch.fall.wreck.length + ch.fall.patches.length + ch.fall.stations.length;
      if (n === 0) continue;
      chunks++;
      want += n;
      got += bakeChunk(ch, 0, seed).obstacles.filter((o) => o.kind.startsWith('fall-') || o.kind.startsWith('off-limits-')).length;
    }
  }
  console.log(`  ${chunks} chunks bake fall-zone items; ${got}/${want} obstacles`);
  if (got !== want) fail(`${want - got} fall-zone items registered no crowd obstacle`);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
Expected: FAIL with "Failed to load url ../render/fallmesh".

- [ ] **Step 3: Create `src/render/fallmesh.ts`**

```ts
/**
 * The fall zone as a greybox (DESIGN §8): plain volumes where placement put
 * things, so placement can be judged in frame before anything is modelled. The
 * village rendering pass replaces the volumes with the columns, piles, revival
 * kit and wreckage. The crowd obstacles stay: they are placement, not looks.
 */

import type { Vec3 } from '../core/math';
import { GROUND_Y } from '../world/citygen';
import type { CrowdObstacle } from '../world/crowdobstacles';
import type { FallChunk, FallColumn, PatchKind } from '../world/fallzone';
import type { MeshBuilder } from '../world/geometry';

const CONCRETE: Vec3 = [0.34, 0.35, 0.36];
const STEEL: Vec3 = [0.14, 0.17, 0.21];
const PILE: Vec3 = [0.13, 0.15, 0.18];
const SLAB: Vec3 = [0.3, 0.31, 0.32];
const SPAN: Vec3 = [0.2, 0.18, 0.16];
const PATCH: Record<PatchKind, Vec3> = { fenced: [0.24, 0.25, 0.26], flooded: [0.06, 0.08, 0.1], overgrown: [0.14, 0.19, 0.11] };

/** A box on a right-handed basis: MeshBuilder.pushBox's corners and faces, so every face winds outward. */
export function pushOrientedBox(bld: MeshBuilder, c: Vec3, ax: Vec3, ay: Vec3, az: Vec3, h: Vec3, color: Vec3): void {
  const p = (x: number, y: number, z: number): Vec3 => [
    c[0] + ax[0] * x + ay[0] * y + az[0] * z,
    c[1] + ax[1] * x + ay[1] * y + az[1] * z,
    c[2] + ax[2] * x + ay[2] * y + az[2] * z,
  ];
  const [hx, hy, hz] = h;
  const c000 = p(-hx, -hy, -hz), c100 = p(hx, -hy, -hz), c110 = p(hx, hy, -hz), c010 = p(-hx, hy, -hz);
  const c001 = p(-hx, -hy, hz), c101 = p(hx, -hy, hz), c111 = p(hx, hy, hz), c011 = p(-hx, hy, hz);
  bld.pushQuad(c001, c101, c111, c011, color);
  bld.pushQuad(c100, c000, c010, c110, color);
  bld.pushQuad(c101, c100, c110, c111, color);
  bld.pushQuad(c000, c001, c011, c010, color);
  bld.pushQuad(c011, c111, c110, c010, color);
  bld.pushQuad(c000, c100, c101, c001, color);
}

/** The basis of a frame yawed by `yaw` (rotationY), then tilted by `tilt` about its own x axis. */
export function yawTiltBasis(yaw: number, tilt: number): [Vec3, Vec3, Vec3] {
  const c = Math.cos(yaw), s = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
  return [[c, 0, -s], [s * st, ct, c * st], [s * ct, -st, c * ct]];
}

/** The basis of a span from a to b: x along it, z level and to its side, y up out of it. */
function spanBasis(a: Vec3, b: Vec3): [Vec3, Vec3, Vec3] {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const ax: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
  const zl = Math.hypot(ax[0], ax[2]) || 1;
  const az: Vec3 = [-ax[2] / zl, 0, ax[0] / zl];
  const ay: Vec3 = [az[1] * ax[2] - az[2] * ax[1], az[2] * ax[0] - az[0] * ax[2], az[0] * ax[1] - az[1] * ax[0]];
  return [ax, ay, az];
}

/** A hollow square tube: four walls of thickness `t`, so what stands inside it shows from above. */
function pushTube(bld: MeshBuilder, c: Vec3, basis: [Vec3, Vec3, Vec3], hx: number, hy: number, hz: number, t: number, color: Vec3): void {
  const [ax, ay, az] = basis;
  const at = (u: number, w: number): Vec3 => [c[0] + ax[0] * u + az[0] * w, c[1], c[2] + ax[2] * u + az[2] * w];
  pushOrientedBox(bld, at(0, hz - t / 2), ax, ay, az, [hx, hy, t / 2], color);
  pushOrientedBox(bld, at(0, -hz + t / 2), ax, ay, az, [hx, hy, t / 2], color);
  pushOrientedBox(bld, at(hx - t / 2, 0), ax, ay, az, [t / 2, hy, hz - t], color);
  pushOrientedBox(bld, at(-hx + t / 2, 0), ax, ay, az, [t / 2, hy, hz - t], color);
}

function pushColumn(bld: MeshBuilder, c: FallColumn, flat: [Vec3, Vec3, Vec3]): void {
  const [ax, ay, az] = flat;
  const h = (c.top - GROUND_Y) / 2, y = GROUND_Y + h;
  if (c.kind === 'silo') {
    const rad = c.halfX / c.count;
    for (let k = 0; k < c.count; k++) {
      const off = (2 * k - (c.count - 1)) * rad;
      pushOrientedBox(bld, [c.x + ax[0] * off, y, c.z + ax[2] * off], ax, ay, az, [rad, h, rad], CONCRETE);
    }
  } else if (c.kind === 'lattice') {
    // Four legs, so the boxes slung inside the cage show.
    for (const [u, w] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      pushOrientedBox(bld, [c.x + ax[0] * u * c.halfX + az[0] * w * c.halfZ, y, c.z + ax[2] * u * c.halfX + az[2] * w * c.halfZ], ax, ay, az, [0.8, h, 0.8], STEEL);
    }
  } else if (c.kind === 'spire') {
    pushTube(bld, [c.x, y, c.z], flat, c.halfX, h, c.halfZ, 3, CONCRETE);
  } else {
    pushOrientedBox(bld, [c.x, y, c.z], ax, ay, az, [c.halfX, h, c.halfZ], CONCRETE);
  }
  const ph = (c.pileTop - c.pileBase) / 2;
  pushOrientedBox(bld, [c.x, c.pileBase + ph, c.z], ax, ay, az, [c.pileHalfX, ph, c.pileHalfZ], PILE);
}

/** Greybox one chunk's share of the fall zone, and register what the crowd must walk around. */
export function pushFallChunk(bld: MeshBuilder, fall: FallChunk, lod: number, obstacles: CrowdObstacle[]): void {
  const flat = yawTiltBasis(fall.yaw, 0);
  const tx = Math.cos(fall.yaw), tz = -Math.sin(fall.yaw);
  for (const c of fall.columns) {
    pushColumn(bld, c, flat);
    obstacles.push({ x: c.x, z: c.z, tx, tz, halfAlong: c.halfX, halfAcross: c.halfZ, minY: GROUND_Y, maxY: c.top, kind: `fall-${c.kind}` });
  }
  for (const { deck, a, b } of fall.decks) {
    const pa: Vec3 = [a.x, deck.y - 1.2, a.z], pb: Vec3 = [b.x, deck.y - 1.2, b.z];
    const mid: Vec3 = [(pa[0] + pb[0]) / 2, pa[1], (pa[2] + pb[2]) / 2];
    pushOrientedBox(bld, mid, ...spanBasis(pa, pb), [Math.hypot(b.x - a.x, b.z - a.z) / 2, 1.2, deck.width / 2], SLAB);
  }
  if (lod < 2) {
    for (const { bridge, a, b } of fall.bridges) {
      const pa: Vec3 = [a.x, bridge.ya, a.z], pb: Vec3 = [b.x, bridge.yb, b.z];
      const mid: Vec3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
      pushOrientedBox(bld, mid, ...spanBasis(pa, pb), [len / 2, 0.15, bridge.kind === 'rope' ? 0.6 : 0.9], SPAN);
    }
  }
  for (const w of fall.wreck) {
    pushOrientedBox(bld, [w.x, w.y, w.z], ...yawTiltBasis(w.yaw, w.tilt), [w.halfX, w.halfY, w.halfZ], SLAB);
    obstacles.push({
      x: w.x, z: w.z, tx: Math.cos(w.yaw), tz: -Math.sin(w.yaw), halfAlong: w.halfX,
      halfAcross: w.halfZ * Math.cos(w.tilt) + w.halfY * Math.sin(w.tilt),
      minY: GROUND_Y, maxY: w.y + w.halfZ * Math.sin(w.tilt) + w.halfY, kind: `fall-${w.kind}`,
    });
  }
  for (const p of fall.patches) {
    if (lod < 2) pushOrientedBox(bld, [p.x, GROUND_Y + 0.03, p.z], ...flat, [p.halfX, 0.02, p.halfZ], PATCH[p.kind]);
    obstacles.push({ x: p.x, z: p.z, tx, tz, halfAlong: p.halfX, halfAcross: p.halfZ, minY: GROUND_Y, maxY: GROUND_Y + 2.2, kind: `off-limits-${p.kind}` });
  }
  for (const s of fall.stations) {
    pushOrientedBox(bld, [s[0], GROUND_Y + 2, s[2]], ...flat, [3, 2, 3], STEEL);
    obstacles.push({ x: s[0], z: s[2], tx, tz, halfAlong: 3, halfAcross: 3, minY: GROUND_Y, maxY: GROUND_Y + 4, kind: 'fall-ropeway-station' });
  }
}
```

- [ ] **Step 4: Bake it, and retire the bolted-on rooms,** in `src/render/citymesh.ts`.

Add the import:

```ts
import { pushFallChunk } from './fallmesh';
```

In `bakeChunk`'s building loop, delete the line `pushScaffold(solid, b, dp, lod, lights);`. Immediately after the building loop's closing brace (before `// --- props`), add:

```ts
  // --- the fall zone (DESIGN §8): a greybox until the village rendering pass.
  // Before the props and ground furniture, so the far shadow cascades draw it.
  pushFallChunk(solid, chunk.fall, lod, obstacles);
```

`pushScaffold` has no doc comment. Add this directly above `export function pushScaffold`:

```ts
/**
 * Retired (DESIGN §8, D33): nothing calls this. The bolted-on room columns
 * misread sheet B. Kept only until the village rendering pass lifts
 * `weatherRoom`, `catwalk`, `faceQuad` and the scaffold members out of it into
 * the pile kit; delete it then.
 */
```

- [ ] **Step 5: Run the tests**

Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
Expected: `GREYBOX  N chunks bake fall-zone items; M/M obstacles`, then `VIOLATIONS none`.

Run: `npx tsc --noEmit && npx vite build`
Expected: clean. `pushScaffold` is exported, so `noUnusedLocals` does not fire.

Run: `npx --yes vite-node@6.0.0 src/render/__selftest_ground_contract.ts`
Expected: `GROUND CONTRACT ALL PASS`.

- [ ] **Step 6: Commit**

```bash
git add src/render/fallmesh.ts src/render/citymesh.ts src/world/__selftest_fallzone.ts
git commit -m "feat: greybox the fall zone; retire the bolted-on scaffold rooms" -m "Plain volumes where placement put the columns, piles, decks, bridges, wreck, patches and ropeway huts, so placement can be reviewed in frame. Each registers its crowd obstacle. pushScaffold is no longer called (DESIGN §8): it stays only until the rendering pass lifts its parts into the pile kit."
```

---

### Task 6: Trams end at the zone's edge; village ropeways join the network

**Files:**
- Modify: `src/world/networks.ts:171-192` (`growTrams`), `:208-261` (`buildRailLines`)
- Modify: `src/world/__selftest_fallzone.ts`

**Interfaces:**
- Consumes: `fallZone`, `ROPE_SAG` (Task 3), `beltBand` (Task 1).
- Produces: `tramTrack(plan, seed)` and `buildRailLines(city, seed)` trams never enter the belt. `buildRailLines` appends one `RailLine` per `FallZone.ropeways` entry, with `kind: 'cablecar'`, `districtId: 5`, `suspension: 'free'` and `speed: 6`.

- [ ] **Step 1: Write the failing test.** Add the imports `tramTrack, buildRailLines` from `./networks`. Add this function and call it after `greybox();`:

```ts
function trams(): void {
  console.log('\nTRAMS & ROPEWAYS');
  for (const seed of SEEDS) {
    const f = districtField(seed), plan = cityPlan(seed);
    const lines = tramTrack(plan, seed);
    const inside = lines.reduce((s, pts) => s + pts.filter((p) => beltBand(f, p[0], p[2]) > 0).length, 0);
    if (inside > 0) fail(`seed ${seed}: ${inside} tram points run through the industrial belt`);
    if (seed === DEFAULT_SEED) console.log(`  default seed: ${lines.length} tram lines, ${lines.map((p) => p.length).join(' + ')} points`);
  }
  const city = new City(defaultCityConfig(DEFAULT_SEED));
  const rails = buildRailLines(city, DEFAULT_SEED);
  const ropeLines = rails.filter((l) => l.kind === 'cablecar' && l.districtId === 5).length;
  const want = fallZone(DEFAULT_SEED).ropeways.length;
  console.log(`  ${rails.length} rail lines, ${ropeLines} of them village ropeways`);
  if (ropeLines !== want) fail(`${ropeLines} ropeway lines for ${want} village ropeways`);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
Expected: FAIL. Either `seed ...: N tram points run through the industrial belt` (for any seed whose tram crosses the belt) or `0 ropeway lines for 2 village ropeways`.

- [ ] **Step 3: Edit `src/world/networks.ts`.**

Extend the imports:

```ts
import { DISTRICT_STYLES, beltBand, districtAt, districtPaletteLinear, type DistrictField, type DistrictStyle } from './districts';
import { ROPE_SAG, fallZone } from './fallzone';
```

Add above `growTrams`:

```ts
/** The longest run of `pts` off the industrial belt: trams end at the fall zone's edge (DESIGN §8). */
function outsideBelt(pts: Vec3[], f: DistrictField): Vec3[] {
  let best: [number, number] = [0, 0], start = -1;
  for (let k = 0; k <= pts.length; k++) {
    const out = k < pts.length && beltBand(f, pts[k][0], pts[k][2]) === 0;
    if (out && start < 0) start = k;
    if (!out && start >= 0) { if (k - start > best[1] - best[0]) best = [start, k]; start = -1; }
  }
  return pts.slice(best[0], best[1]);
}
```

In `growTrams`, replace the body after `if (raw.length < 6) continue;` through the `lines.push({...})` with:

```ts
    const pts = resampleSpline(raw, 96);
    // Both draws first, in their old order: a line cut short leaves the stream as it was.
    const hump = 8 + r.next() * 9;
    const speed = 10.5 + r.next() * 2.5;
    // Cut before the viaduct ramp, so a line that ends at the zone's edge ends at street level.
    const kept = outsideBelt(pts, plan.districts);
    if (kept.length < 6) continue;
    for (let k = 0; k < kept.length; k++) {
      kept[k][1] += 0.28 + rampProfile(k / (kept.length - 1), hump);
    }
    const mid = kept[kept.length >> 1];
    const d = districtAt(mid[0], mid[2], seed);
    let crest = 0;
    for (const p of kept) if (p[1] > crest) crest = p[1];
    lines.push({
      id: lines.length, kind: 'tram', points: kept, closed: false,
      speed, color: styleColor(DISTRICT_STYLES[d], 0.55),
      districtId: d, suspension: crest - GROUND_Y > 4 ? 'catenary' : 'ground',
    });
```

In `buildRailLines`, after the funicular loop and before `return lines;`:

```ts
  // Village ropeways over the fall zone (DESIGN §8; frame 4's gondolas). Last, so
  // every line above keeps its draws.
  for (const rw of fallZone(seed).ropeways) {
    const pts: Vec3[] = [];
    for (let k = 1; k < rw.stations.length; k++) {
      const a = rw.stations[k - 1], b = rw.stations[k];
      const seg = spanCurve(a, b, Math.hypot(b[0] - a[0], b[2] - a[2]) * ROPE_SAG, 8);
      pts.push(...(k === 1 ? seg : seg.slice(1)));
    }
    lines.push({
      id: id++, kind: 'cablecar', points: resampleSpline(pts, 48), closed: false,
      speed: 6, color: [0.62, 0.12, 0.07], districtId: 5, suspension: 'free',
    });
  }
```

- [ ] **Step 4: Run the tests**

Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
Expected: the TRAMS & ROPEWAYS lines, then `VIOLATIONS none`.

Run: `npx --yes vite-node@6.0.0 src/world/__selftest_footway.ts | tail -3`
Expected: `VIOLATIONS none`. Islands still keep 7 m off the (now shorter) tram track.

Run: `npx tsc --noEmit` (expected: clean)

- [ ] **Step 5: Commit**

```bash
git add src/world/networks.ts src/world/__selftest_fallzone.ts
git commit -m "feat: trams end at the fall zone's edge; village ropeways join the network" -m "A tram keeps its longest run off the belt, ramped after the cut so it ends at street level; its draws keep their order. Each village ropeway becomes a cable car line from its ground station up through the piles."
```

---

### Task 7: Fleets ride every line of their kind

**Files:**
- Modify: `src/sim/traffic.ts:323-326` (fields), `:375-390` (accessors), `:415-440` (`rebuild`), `:531` (`assign`)
- Modify: `src/sim/__selftest.ts:571-620`

**Interfaces:**
- Consumes: the extra cable car lines from Task 6.
- Produces:
  - `TrafficSim.lineKindOf(v: Vehicle): string | null`, the kind of line a vehicle rides;
  - `TrafficSim.lineCount(kind: string): number`;
  - every vehicle of a kind is assigned `routesOf[kind][i % n]` rather than the first route of that kind.

**Finding this task fixes:** `assign()` points every vehicle of a kind at `byKind[kind]`, the *first* route of that kind. Every second tram line, second heavy cable car, second and third funicular and every zipline after the first has been running empty, and the village ropeways would too. This is a visible change: those lines start carrying vehicles.

- [ ] **Step 1: Write the failing test.** In `src/sim/__selftest.ts`, replace the altitude assertion

```ts
  if (cableAlts.length > 0 && cableFloor < railCeiling + 20) {
    note(`cable cars fly at ${cableFloor.toFixed(0)}m while trams reach ${railCeiling.toFixed(0)}m — they are on the wrong lines`);
  }
```

with:

```ts
  // A vehicle rides a line of its own kind. Village ropeways (DESIGN §8) start at
  // a ground station, so altitude no longer separates cable cars from trams; the
  // line kind does, and it is what the fallback bug above got wrong.
  const wrongLine = traffic.vehicles.filter((v) => v.alive && v.route >= 0 && traffic.lineKindOf(v) !== v.kind).length;
  if (wrongLine > 0) note(`${wrongLine} alive vehicles ride a line of another kind`);
  // And a fleet spreads over its lines: every vehicle of a kind used to ride the first.
  const cableRoutes = new Set(traffic.vehicles.filter((v) => v.alive && v.kind === 'cablecar').map((v) => v.route));
  if (traffic.lineCount('cablecar') > 1 && cableRoutes.size < 2) note(`every cable car rides one of ${traffic.lineCount('cablecar')} cable car lines`);
```

Keep the informational `L.push(... cable cars ... altitude ...)` line as it is.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx --yes vite-node@6.0.0 src/sim/__selftest.ts`
Expected: FAIL. `traffic.lineKindOf is not a function` (tsc: property does not exist).

- [ ] **Step 3: Edit `src/sim/traffic.ts`.**

Below the `byKind` field:

```ts
  /** Every route index per kind, so a fleet spreads over all its lines, not only the first. */
  private readonly routesOf: Record<string, number[]> = {};
```

Below `suspensionOf`:

```ts
  /** The kind of line a vehicle rides ('zipline' for the zipline family), or null off any route. */
  lineKindOf(v: Vehicle): string | null {
    const r = this.routes[v.route];
    return r ? (r.family === 'zipline' ? 'zipline' : r.lineKind ?? null) : null;
  }

  /** How many routes carry vehicles of this kind. */
  lineCount(kind: string): number {
    return this.routesOf[kind]?.length ?? 0;
  }
```

In `rebuild`, directly after the loop that fills `byKind` (`if (this.byKind[key] < 0) this.byKind[key] = i;`) and before the fallback pass:

```ts
    for (const k of Object.keys(this.routesOf)) delete this.routesOf[k];
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      (this.routesOf[r.family === 'zipline' ? 'zipline' : r.lineKind] ??= []).push(i);
    }
```

In `assign`, replace `const idx = this.byKind[v.kind] ?? -1;` with:

```ts
    // Spread a kind's fleet over all its lines; `byKind` (with its fallback) only when it has none.
    const list = this.routesOf[v.kind];
    const idx = list && list.length > 0 ? list[i % list.length] : this.byKind[v.kind] ?? -1;
```

If `tsc` reports that `r.lineKind` can be undefined in the `routesOf` key, use `r.lineKind ?? 'rail'`. The `byKind` sweep above uses the same expression, so mirror whatever it does.

- [ ] **Step 4: Run the sim tests**

Run each and read the last line:

```bash
for t in __selftest __selftest_density __selftest_separation __selftest_spread; do echo "== $t"; npx --yes vite-node@6.0.0 src/sim/$t.ts 2>&1 | tail -2; done
```

Expected: each ends `ALL PASS`.

Run: `npx tsc --noEmit` (expected: clean)

- [ ] **Step 5: Record the bug in the operator's cross-project bug wiki** (outside this repository; the operator's instructions give its location and protocol, so read its README first). Add an entry for "vehicles of a kind ride only the first route of that kind". Include file `src/sim/traffic.ts`, function `assign`, root cause, fix, and recurrence signs ("a line with no vehicles"; "the HUD counts a kind but one line is busy and its twin empty"). Add its one-line pointer to the wiki's index.

- [ ] **Step 6: Commit**

```bash
git add src/sim/traffic.ts src/sim/__selftest.ts
git commit -m "fix: every vehicle of a kind rode the first line of that kind" -m "assign() pointed a kind's whole fleet at byKind[kind], its first route: the second tram line, second cable car, later funiculars and ziplines ran empty, and the village ropeways would have too. Fleets now spread over routesOf[kind]. The sim self-test checks a vehicle's line kind, which altitude no longer separates once ropeways start on the ground."
```

---

### Task 8: Commerce keeps out of the ruins; foot traffic thins

**Files:**
- Modify: `src/world/fallzone.ts` (add `FALL_FOOT`, `fallFoot`)
- Modify: `src/sim/crowd.ts` (`seedAgent`)
- Modify: `src/world/marketgrammar.ts:1407-1408` (`streetIslands`)
- Modify: `src/world/__selftest_fallzone.ts`

**Interfaces:**
- Produces: `FALL_FOOT = 0.25` and `fallFoot(f: DistrictField, x: number, z: number, i: number): boolean`. It is always true off the belt, and true for about `FALL_FOOT` of agent indices on it.

- [ ] **Step 1: Write the failing test.** Add the imports `FALL_FOOT, fallFoot` from `./fallzone`, `bakeGroundDetail` from `../render/groundbake`, and `makeRng` from `../core/math`. Add this function and call it after `trams();`:

```ts
function foot(): void {
  console.log('\nFOOT TRAFFIC & COMMERCE');
  const f = districtField(DEFAULT_SEED), plan = cityPlan(DEFAULT_SEED);
  let inBelt = 0, keptIn = 0, offBelt = 0, keptOff = 0;
  for (let k = 0; k < 20000; k++) {
    const x = LO + ((k * 7919) % 3328), z = LO + ((k * 104729) % 3328);
    const ok = fallFoot(f, x, z, k);
    if (beltBand(f, x, z) > 0) { inBelt++; if (ok) keptIn++; } else { offBelt++; if (ok) keptOff++; }
  }
  const share = keptIn / Math.max(1, inBelt);
  console.log(`  seats kept: ${(100 * share).toFixed(1)}% in the belt (${inBelt} samples), ${keptOff}/${offBelt} off it`);
  if (keptOff !== offBelt) fail(`${offBelt - keptOff} seats refused off the belt`);
  if (Math.abs(share - FALL_FOOT) > 0.03) fail(`belt seats kept ${(100 * share).toFixed(1)}%, not ~${100 * FALL_FOOT}%`);
  // Street islands (cafes, planters, benches) keep out of the zone.
  const city = new City(defaultCityConfig(DEFAULT_SEED));
  let islands = 0, inZone = 0;
  for (let cx = -6; cx <= 6; cx++) {
    for (let cz = -6; cz <= 6; cz++) {
      const ch = city.getChunk(cx, cz);
      if (!ch || ch.fall.columns.length === 0) continue;
      const g = bakeGroundDetail(new MeshBuilder(), ch, plan, 0, makeRng(1), []);
      islands += g.streetIslands.length;
      inZone += g.streetIslands.filter((s) => beltBand(f, s.x, s.z) > 0).length;
    }
  }
  console.log(`  ${islands} street islands on the zone's chunks, ${inZone} inside the belt`);
  if (inZone > 0) fail(`${inZone} street islands stand in the industrial belt`);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
Expected: FAIL. `fallFoot` is not exported.

- [ ] **Step 3: Add the predicate** to `src/world/fallzone.ts` (end of file):

```ts
// ---------------------------------------------------------------- the crowd

/** Share of crowd seats kept inside the zone: thin foot traffic, not none (owner: "concessions are made"). */
export const FALL_FOOT = 0.25;

/** Whether agent `i` may take a seat at (x, z): always off the belt, FALL_FOOT of agents on it. */
export function fallFoot(f: DistrictField, x: number, z: number, i: number): boolean {
  if (beltBand(f, x, z) === 0) return true;
  return (Math.imul(i + 1, 0x9e3779b1) >>> 0) / 4294967296 < FALL_FOOT;
}
```

- [ ] **Step 4: Use it in `src/sim/crowd.ts`.** Add the import:

```ts
import { fallFoot } from '../world/fallzone';
```

In `seedAgent`, immediately after `const cz = placed.z + nz * lat;`:

```ts
    // The fall zone (DESIGN §8): most people keep away from the ruins; a few still go in.
    if (!fallFoot(districtField(this.seedRef.seed), cx, cz, i)) return false;
```

- [ ] **Step 5: Keep the islands out** in `src/world/marketgrammar.ts`. Add `beltBand` to its `./districts` import. In `streetIslands`, directly after the `lived` line:

```ts
    // Commerce keeps out of the fall zone's ruins (DESIGN §8).
    if (beltBand(plan.districts, x, z) > 0) { walked = 0; next = 6; continue; }
```

- [ ] **Step 6: Run the tests**

Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
Expected: FOOT TRAFFIC & COMMERCE lines, then `VIOLATIONS none`.

Run the sim loop from Task 7 Step 4 and the footway and market tests:

```bash
for t in __selftest __selftest_density __selftest_separation __selftest_spread; do echo "== $t"; npx --yes vite-node@6.0.0 src/sim/$t.ts 2>&1 | tail -2; done
npx --yes vite-node@6.0.0 src/world/__selftest_footway.ts | tail -2
npx --yes vite-node@6.0.0 src/world/__selftest_market.ts | tail -2
```

Expected: `ALL PASS` ×4, `VIOLATIONS none`, `VIOLATIONS: none`.

Run: `npx tsc --noEmit` (expected: clean)

- [ ] **Step 7: Commit**

```bash
git add src/world/fallzone.ts src/sim/crowd.ts src/world/marketgrammar.ts src/world/__selftest_fallzone.ts
git commit -m "feat: commerce keeps out of the fall zone; foot traffic thins inside it" -m "Owner, 2026-10-15: commerce and community avoid the ruins but concessions are made. Street islands skip the belt; a quarter of crowd seats inside it are kept, by agent index, so the RNG streams are untouched."
```

---

### Task 9: Review poses, captures and the frame rate

**Files:**
- Create: `src/world/__probe_fallzone.ts`
- Modify: `tools/capture.mjs:337-361` (retire 12-scaffold-b and -night; add 16-19)
- Modify: `references/sections.json` (`poses`)
- Modify: `docs/PERFORMANCE_2026-10-06.md` (append a section)

**Interfaces:**
- Consumes: `fallZone` (Tasks 2-4).
- Produces: capture poses `16-fall-wreck-up`, `17-fall-piles-level`, `18-fall-skyline`, `19-fall-pile-close`.

- [ ] **Step 1: Create the probe** `src/world/__probe_fallzone.ts`:

```ts
/**
 * Review poses for the fall zone (DESIGN §8), derived from the zone, not typed in:
 * run, then paste the printed objects into tools/capture.mjs.
 *
 *   npx --yes vite-node@6.0.0 src/world/__probe_fallzone.ts
 *
 * 16 stands in the wreck field and looks up at the densest knot of piles
 * (frame 2's angle); 17 is level with the longest deck fragment (frame 1);
 * 18 is the wide-skyline camera turned onto the zone; 19 stands on a deck
 * fragment 3 m from a pile.
 */

import { cityPlan, GROUND_Y, sampleStreetPlan, type StreetSample } from './citygen';
import { beltBand } from './districts';
import { fallZone, patchAt } from './fallzone';

const SEED = 0x5e7a17;
const z = fallZone(SEED), plan = cityPlan(SEED), f = plan.districts;
const r1 = (v: number): number => Math.round(v * 10) / 10;
const pose = (name: string, label: string, position: number[], lookAt: number[], time: string, sky: string, fov = 1.05): string =>
  `  {\n    // Derived by src/world/__probe_fallzone.ts (seed 5e7a17).\n    name: '${name}',\n    label: '${label}',\n`
  + `    position: [${position.map(r1).join(', ')}], lookAt: [${lookAt.map(r1).join(', ')}], fov: ${fov}, roll: 0,\n`
  + `    time: '${time}',\n    weather: { sky: '${sky}', cloudCover: 0.35, haze: 0.3 },\n    lens: { fov: ${fov} },\n    settle: 30,\n  },`;

// 16: the street point in the deck band, outside the fences, with the most piles 25-90 m ahead in a 70-degree cone.
const s: StreetSample = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0 };
let best = { n: 0, x: 0, z: 0, ang: 0 };
for (let x = -1536; x < 1792; x += 6) {
  for (let q = -1536; q < 1792; q += 6) {
    if (beltBand(f, x, q) !== 1 || patchAt(z, x, q)) continue;
    if (sampleStreetPlan(plan, x, q, s).clearance > -2) continue;
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const n = z.columns.filter((c) => {
        const d = Math.hypot(c.x - x, c.z - q);
        const off = Math.abs(Math.atan2(Math.sin(Math.atan2(c.z - q, c.x - x) - ang), Math.cos(Math.atan2(c.z - q, c.x - x) - ang)));
        return d >= 25 && d <= 90 && off < 0.61;
      }).length;
      if (n > best.n) best = { n, x, z: q, ang };
    }
  }
}
const knot = z.columns.filter((c) => Math.hypot(c.x - best.x, c.z - best.z) <= 90 && Math.hypot(c.x - best.x, c.z - best.z) >= 25);
const tops = knot.map((c) => c.pileTop).sort((p, q) => p - q);
const lookUp = [best.x + Math.cos(best.ang) * 60, tops[tops.length >> 1] ?? GROUND_Y + 120, best.z + Math.sin(best.ang) * 60];
console.log(`// 16: ${best.n} piles in the cone`);
console.log(pose('16-fall-wreck-up', 'sheet B: the wreck field looking up at a knot of piles, dusk', [best.x, GROUND_Y + 1.7, best.z], lookUp, 'dusk', 'dusk'));

// 17: level with the longest deck fragment, 45 m off its side.
const deck = [...z.decks].sort((p, q) => {
  const lp = Math.hypot(z.columns[p.a].x - z.columns[p.b].x, z.columns[p.a].z - z.columns[p.b].z);
  const lq = Math.hypot(z.columns[q.a].x - z.columns[q.b].x, z.columns[q.a].z - z.columns[q.b].z);
  return lq - lp;
})[0];
if (deck) {
  const a = z.columns[deck.a], b = z.columns[deck.b];
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, l = Math.hypot(b.x - a.x, b.z - a.z);
  const nx = -(b.z - a.z) / l, nz = (b.x - a.x) / l;
  console.log(pose('17-fall-piles-level', 'sheet B: level with a deck fragment between two piles, morning', [mx + nx * 45, deck.y + 6, mz + nz * 45], [mx, deck.y + 8, mz], 'morning', 'clear'));
  // 19: standing on the fragment, 3 m from pile a's face, looking at it.
  const ux = (a.x - b.x) / l, uz = (a.z - b.z) / l, reach = Math.max(a.pileHalfX, a.pileHalfZ) + 3;
  console.log(pose('19-fall-pile-close', 'sheet B: on a deck fragment, 3 m from a village pile, noon', [a.x - ux * reach, deck.y + 1.7, a.z - uz * reach], [a.x, deck.y + 5, a.z], 'noon', 'clear', 1.1));
} else {
  console.log('// 17 and 19: no deck fragment at this seed; derive them from the tallest pile instead.');
}

// 18: the 01-wide-skyline camera, turned onto the zone's centroid; report which spires are in the 64-degree view.
const cx = z.columns.reduce((t, c) => t + c.x, 0) / z.columns.length, cz = z.columns.reduce((t, c) => t + c.z, 0) / z.columns.length;
const cam = [323, 150, 506];
const head = Math.atan2(cz - cam[2], cx - cam[0]);
const spires = z.columns.filter((c) => c.kind === 'spire');
const seen = spires.filter((c) => Math.abs(Math.atan2(Math.sin(Math.atan2(c.z - cam[2], c.x - cam[0]) - head), Math.cos(Math.atan2(c.z - cam[2], c.x - cam[0]) - head))) < 0.56);
console.log(`// 18: ${seen.length}/${spires.length} spire stumps inside the horizontal view`);
console.log(pose('18-fall-skyline', 'sheet B: the fall zone as a mid band on the skyline, dusk', cam, [cx, GROUND_Y + 120, cz], 'dusk', 'dusk', 1.12));
```

- [ ] **Step 2: Run the probe and paste the poses**

Run: `npx --yes vite-node@6.0.0 src/world/__probe_fallzone.ts`
Expected: four pose objects and three `//` notes. If 18 reports fewer than 2 spires in view, move the camera rather than leaving the spires out. Re-run with `cam` set to a point 1100 m from the centroid on the side facing the origin, at y = 160, and note the change in the pose's comment.

In `tools/capture.mjs`:
- delete the `12-scaffold-b` and `12-scaffold-b-night` entries, including their comments;
- paste the four printed objects in their place, ordered 16, 17, 18, 19.

Then check that nothing else names the retired poses or counts the sequence:

```bash
grep -rn "12-scaffold\|POSES.length\|23 poses" tools src docs/PROCEDURES.md
```

Expected: no hit in `tools` or `src`. Update any prose hit in `docs/PROCEDURES.md` to the new pose names.

In `references/sections.json`, add `"fall-": "B"` to `poses`.

- [ ] **Step 3: Capture.** Gate on a quiet machine first (HANDOFF, "How this session worked"):

```bash
memory_pressure | tail -1
until [ "$(ps -Ao %cpu -r | sed -n 2p | awk '{print int($1)}')" -lt 30 ]; do sleep 10; done
node tools/capture.mjs --pose=16-fall-wreck-up --timeout 900
node tools/capture.mjs --pose=17-fall-piles-level --timeout 900
node tools/capture.mjs --pose=18-fall-skyline --timeout 900
node tools/capture.mjs --pose=19-fall-pile-close --timeout 900
node tools/compare.mjs --latest --auto
```

Expected: four PNGs under `shots/<stamp>/`, and a compare grid against sheet B. Serialize the captures. Respect the capture guard (WORKFLOW §6.1, 250 MB free minimum); never force past it.

- [ ] **Step 4: Read the frames honestly against frames 1 and 2** (`references/sections/B-cold-industrial/0{1,2}-*.jpg`). Write down placement only, not looks:
  - Does 16 read as a forest of columns with piles high above?
  - Does 17 show a deck fragment between full-height piers?
  - Does 18 show a distinct mid band between the low belt and downtown?
  - Is 19 within 3 m of a pile?
  - Any column standing in a street, any pile clipping a surviving building, and any city-wide surprise in the regular poses: run `node tools/capture.mjs --sequence --timeout 900` once.

- [ ] **Step 5: Benchmark (D32).** Use the method of the "D30 islands that read" section of `docs/PERFORMANCE_2026-10-06.md`:
  - ABBA ABBA against a worktree at the branch's base commit;
  - `--route=all`, with fixed high quality and `--gpu-passes`;
  - every leg gated on top CPU < 30%.

  Reuse this checkout's installed dependencies through a symlink rather than installing a second copy (no `npm install`, so no install scripts run):

```bash
BASE=$(git merge-base HEAD main)
git worktree add ../syzygy-bench-base "$BASE"
ln -s "$PWD/node_modules" ../syzygy-bench-base/node_modules
# each leg, alternating directories (A = base, B = head), after the quiet-machine gate:
(cd ../syzygy-bench-base && node tools/benchmark.mjs --route=all --quality=high --gpu-passes)
node tools/benchmark.mjs --route=all --quality=high --gpu-passes
```

Record hero, skyline, garden and flight submitted/s and GPU span for each leg. When done, `git worktree remove ../syzygy-bench-base`. Append a section "Fall zone greybox (2026-10-15)" to `docs/PERFORMANCE_2026-10-06.md`: the legs, the means, and a sentence on what the greybox costs. Its few thousand triangles of boxes should cost little; a big change means something is wrong.

- [ ] **Step 6: Commit**

```bash
git add src/world/__probe_fallzone.ts tools/capture.mjs references/sections.json docs/PERFORMANCE_2026-10-06.md
git commit -m "feat: fall zone review poses; retire the scaffold poses; benchmark the greybox" -m "<capture stamp, honest read in two lines, benchmark means>"
```

---

### Task 10: Docs and handoff

**Files:**
- Modify: `docs/DESIGN.md` (§8 status line)
- Modify: `docs/HANDOFF.md` (item 5 and the start-here block)
- Modify: `docs/PITFALLS.md` (new §35)
- Modify: `AGENTS.md` (verify list)

- [ ] **Step 1: DESIGN §8 status.** Replace `**Status: lore and form designed. Placement and rendering not started.**` with:

```markdown
**Status: lore, form and placement done (placement pass, 2026-10-15; greybox in frame, poses 16-19). Rendering not started.**
```

Under "What happens to what is built", append one bullet:

```markdown
- **Placement compromise (owner, 2026-10-15):** the deck came after the lower city, so its piers keep a nominal 48 m grid but shift up to 14 m off streets, arterials, the rail, the market and the canal; alleys and the old buildings they needed were disregarded. Commerce (street islands) keeps out; a quarter of the crowd still goes in.
```

- [ ] **Step 2: HANDOFF.** Update item 5:
  - placement is done, with the commit range;
  - the capture stamp;
  - the honest read;
  - the benchmark means;
  - the open owner calls (cause of the fall, how long ago, the burnt quarter, plus the section B cable statistic if Task 4 moved it);
  - "next: the village rendering pass (DESIGN §8)".

  Add the Task 7 finding (fleets rode only the first line of a kind) to the start-here block in one sentence.

- [ ] **Step 3: PITFALLS §35.** Add a section after §34:

```markdown
## 35. A fleet on one line: every vehicle of a kind rode the first route of that kind

`TrafficSim.assign` pointed each vehicle at `byKind[kind]`, the first route of
its kind, so a city with two tram lines ran four trams on one and none on the
other; the second heavy cable car, later funiculars and every zipline but the
first ran empty. Nothing counted vehicles per line. Fixed by spreading a kind
over `routesOf[kind]` (`i % n`); the sim self-test now fails if every cable car
shares one of several lines, and checks a vehicle's line kind instead of its
altitude (village ropeways start on the ground). Recurrence sign: a line with no
vehicles on it, or a twin line busy on one side only.
```

- [ ] **Step 3a: Add the self-test to AGENTS.md's verify list**, under the world self-test line:

```bash
npx vite-node@6.0.0 src/world/__selftest_fallzone.ts   # fall zone — prints "VIOLATIONS none"
```

- [ ] **Step 4: Full verification before the last commit**

```bash
npx tsc --noEmit
npx vite build
npx --yes vite-node@6.0.0 src/world/__selftest.ts | tail -1
npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts | tail -1
npx --yes vite-node@6.0.0 src/sim/__selftest.ts | tail -1
npx --yes vite-node@6.0.0 src/camera/__selftest.ts | tail -1
node tools/lsp-check.mjs
node tools/__selftest_hygiene.mjs
npm run hygiene
```

Expected: clean tsc and build, then `VIOLATIONS   none — all invariants hold`, `VIOLATIONS none`, `ALL PASS`, `ALL PASS`, 5/5 language servers, hygiene `ALL PASS`, and a clean tree screen.

- [ ] **Step 5: Commit, then stop for review**

```bash
git add docs/DESIGN.md docs/HANDOFF.md docs/PITFALLS.md AGENTS.md
git commit -m "docs: fall zone placement pass, the fleet-on-one-line pitfall, handoff"
```

Then ask a non-implementing reviewer to read poses 16-19 and the sequence (PROCESS rule 9) before anyone calls placement done. Merging to `main` publishes, so it waits for the owner.
