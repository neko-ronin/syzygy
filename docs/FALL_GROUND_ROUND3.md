# Fall ground, round 3b — lifelines, wreck dressing, flooded lows

**Implementer's record. The frames are fall-review's to judge; this file says what
changed, what it cost, and what I already expect to be wrong.**

Built in three commits so a later failure bisects: `0b52d9d` lifelines,
`fe6bf11` wreck dressing, and the commit carrying this file is the flood.

## Lifecycle of the round's input

`GROUND_ROUND3_PLAN.md` is the design; `GROUND_ROUND3_AUDIT.md` wins wherever the
two disagree; `FLOODED_LOWS_SPIKE.md` supplied the mechanism and the two traps.
The audit's corrections were followed, not the plan's numbers, in every place
they differed (class list is three edits not two; the light budget does not come
out of the market's share; the silt quad is not "ordinary ground" untagged).

## What changed

**Lifelines** (new file `src/render/fallground.ts`, called from `pushFallChunk`).
Derived only from `FallColumn.access` and `FallChunk.stations`: stair-tower feet
with landing and rail, winch houses with the drum and the cable up to the pile,
core-stair thresholds and doors, a salvage workshop at every third winch with
three sorted heaps, the D30 B kit (barrels, pallets, cable drums), ropeway queue
rails. One warm work lamp per lifeline plus an emissive head at every LOD.

**Wreck dressing** (same file). Slabs carry 10-18 rubble lumps along both long
edges and the top, plus 6-10 rebar rods splayed out of each broken short end, in
the slab's own yawed/tilted basis. The three spire bodies carry four floor lines
and a column every ~7 m on both flanks, plus a roof slab edge.

**Flooded lows.** `'flood'` is class **6**, appended: indices 0-5 keep every
existing tag bit-identical. The branch is the **last `else if` before the
carriageway catch-all** in `groundSurface` (`gbuffer.wgsl`) — the audit's
reachability trap. `fs` decodes the class **itself** for the normal ripple
(`isFlood` from `groundSurface` is out of scope there, and gating on
`groundTag < 0.0` alone would ripple every tagged paving and kerb in the city);
the ripple is applied before the G-buffer normal write; the weather-wetness pass
excludes the class. Water is 6-8 irregular pools and 2 runnels per flooded patch,
at `GROUND_Y + 0.075` and up — **above** the patch box's `+0.05` top, which is
the audit's "most likely silent failure". The patch box's **top face only**
carries an ordinary `paving`/`board-formed` tag so the silt is ground rather than
a flat `MAT_DIFFUSE` rectangle; `pushOrientedBox` now forwards `opts` and takes
`topOpts` for that face alone.

## The parity test, and proof that it can fail

`src/render/__selftest_ground_contract.ts` now asserts: `indexOf('flood') === 6`;
the CPU and GPU decoders use the same three expressions; every class in the table
has a test inside a brace-matched `groundSurface`; `isFlood` is decoded from
`surface == 6u`; its branch is an `else if` **before** the chain's final `else`,
and no `else if` sits after that `else`; and, on a baked chunk that owns a
flooded patch, tagged flood triangles exist and their lowest vertex is above
`GROUND_Y + 0.05`.

A guard that cannot fail is a comment, so both failure modes were re-introduced
and the test was run against them:

- water moved back inside the box (`+0.03`) → `flood water at y=0.380 is inside
  the patch box (top 0.400)`;
- the flood branch appended after the final `else` → `a branch after the final
  else is unreachable and passes every presence check`.

Both restored, then `GROUND CONTRACT ALL PASS`.

## Budget

| | value |
|---|---|
| ground pass, citywide | 51,370 tris / 27 chunks, mean 1,903, max 4,206 |
| work lamps | 104 citywide, mean 3.9/chunk, max 6 (`MAX_LAMPS`) |
| G-buffer delta vs the 23:08 run | +15,468 / +14,666 / +12,958 / +9,492 (poses 16-19), ~1 % |
| winding | 0 of 51,370 ground triangles face away from their authored normal |
| lights delivered | 1215 / 1128 / 1401 / 1128 (+26 / +21 / +18 / +21), **starved 0**, cap 3072 |

The plan's per-chunk estimate was 400-2,400 tris; measured 1,903 mean, 4,206 max.
The lamp cap is GPU cost, not market protection — the audit showed the zone's
lamps **raise** the chunk's ceiling rather than taking the market's share.

## Capture

`node tools/orchestrate.mjs capture -- node tools/capture.mjs --dev --sequence
--pose=fall` → **PASS**, `shots/2026-10-22T01-00-11`, 5 shots, 52.3 s, app booted
**frameCount=1025**, `"error": null` on every shot, no GPU/WGSL error (so the new
branch compiled). Note for whoever reads the JSON: `shadowTriangles` fell 4.34M →
2.62M on pose 16 because `rebakePending` went 84 → 0, not because geometry was
removed; `fps` is flat (7.41 → 7.47).

## What I expect the reviewer to still find wrong

1. **The round's own item is photographed nowhere.** No pose points at the
   zone's floor: 16 looks up two shafts from 2.3 m, 17 and 19 stand on a deck
   150 m above it, 18 is 193-1185 m out. Pose 20 does not exist and was not mine
   to add this round. So the flood is verified by geometry and by a shader that
   compiled, **not by a frame** — and the same is true of the lifelines and the
   wreck dressing at any distance that would let them read.
2. **The water can only reflect the sky.** There is no SSR and no probe, so at a
   grazing angle the pool is a sheet of horizon and at a steep angle a dark hole;
   the branch leans on matte silt, low-roughness open water and value contrast,
   and a frame may still say "damp patch" or "bright decal".
3. **The silt tag has a coupling.** Tagging the patch top `paving` makes the
   crowd's walking-surface scan see it; the off-limits obstacle is what keeps
   people out, not the class. If that obstacle is ever dropped, the crowd gains a
   walkable island in a flooded low.
4. **Wreck dressing is near-field only** (`lod < 2`) and unlit: it will read as
   grey rubble in daylight and mostly as silhouette at blue hour.
