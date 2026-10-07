# Crowd query and local clearance — 2026-10-06

Implementer B; no captures, no GPU work, no commits. This is the crowd part of
the authorized hero/street/crowd/night batch. D26 controls the scope: local
avoidance first; scene scripts, goals and global lane authoring remain later work.
The baseline pair was saved before simulation edits, at
`shots/2026-10-06T22-40-29/10-hero-walk-{day,night}.png`.

## The failure was more fundamental than buffer resolution

At starting HEAD, `HashGrid.build` populated `counts`, calculated prefix starts,
then reused those populated counts as write cursors. Each cell started writing
*after* its own range. Adjacent cell ranges were overwritten; unwritten entries
read as agent zero. The grid also moved its origin every frame while rebuilding
membership only every seventh frame.

A known-answer scratch probe, independent of any crowd appearance, produced:

```text
three live IDs in one cell: expected [0,1,2], returned [0,0,0]
600 live IDs in one cell: returned 256 entries, one distinct ID
true nearest: ID 599, distance 0.0014142136 m
nearest returned: ID 0, distance 0.7071067812 m
```

This invalidates the old claim that 2 m cells alone made the query correct.
Changing cell size cannot repair a corrupt cell range or guarantee closest
selection when a bounded buffer fills in insertion order.

The original body control in this session was also invalid: its camera at the
origin retired the body just behind it. Its reported 0.218713 m distance is
**void**. With the camera moved to x=-40, all three bodies remain alive. On
starting HEAD, two initially clear bodies approach each other from 0.6 m apart
and reach **0.0079313759 m** separation in 120 frames. The checked-in regression
now asserts that every measured fixture body remains active on every frame.

## What changed

`src/sim/crowd.ts` replaces the corrupt counting sort with linked local cells.
Membership is rebuilt against the current camera each frame and updated as each
body moves. A metric-radius query returns the true closest 32 bodies, sorted by
distance and stable ID, excludes self/inactive bodies, and never truncates cell
traversal to the first 32 entries. Agent capacity remains 6,000. Query storage is
bounded; exact candidate traversal still depends on local occupancy, with its
largest visit count exposed in `diag.maxNeighbourCandidates`.

Separation has its own speed term. A continuous local disc sweep runs after
pathing, wind and the existing pavement hold. The sweep examines every reachable
body without the steering buffer cap, so later displacement terms cannot put a
body back inside another body. Sequential movement updates cell membership
immediately. The initial physical floor was the existing 0.45 m body-center
separation. The mesh-envelope correction below raises the current separation to
0.50 m; the solver adds 1 mm of clearance before Float32 position storage.

Birth rejects locally occupied candidates and emitted solids, with eight bounded
candidate attempts. Saturation is visible as `diag.blockedSeeds`; it is not
silently counted as a seeded agent. This changes no global count/density, goal,
group anchor or lane policy.

`src/world/crowdobstacles.ts` defines a neutral oriented-box contract. The ground
implementer emits descriptors beside the actual counter/post/furniture geometry,
includes emitted prop bounds and generator building footprints, and wires the
renderer revision to `CrowdSim.setStaticObstacles`. The simulation indexes this
immutable aggregate on revision changes; it does not reconstruct furniture
placement from the street field or copy the aggregate every frame.

Static sweeps expand emitted boxes by body radius. Corners are conservatively
square, so a body can be stopped before true rounded-corner contact. This is a
clearance guarantee, not an exact locomotion model.

A new solid revision can surround an existing body. Local recovery targets the
nearest face, travels at most pace × dt, and passes through the same body/static
sweeps. `diag.obstacleRecoveries` counts attempted recovery frames and
`diag.blockedRecoveries` counts attempts with no available displacement. An
isolated actor clears a newly streamed real counter without teleporting; a
packed or mutually enclosing arrangement can still block recovery and must be
reported instead of being certified clear.

## Verification

`src/sim/__selftest_separation.ts` checks these properties:

- True closest membership and ordering against brute force in a 1,200-body dense
  cell, under three insertion permutations, exact ties, inactive bodies and self
  exclusion; moved membership crosses a negative-coordinate cell boundary.
- Initially clear head-on and crossing bodies preserve the physical floor at
  dt=1/120, 1/60, 1/15 and 1 s (the existing update clamp applies), while an
  unobstructed body actually travels. An independent relative-motion quadratic
  also checks the closest simultaneous pre/post segments between frames; clear
  endpoints alone are insufficient. dt=0 preserves positions.
- Large external wind displacement does not tunnel through a body.
- Diagnostics derive from emitted chunk (0,-2) descriptors: `market-counter` and
  `potted-palm`. Bodies approach the actual positions and bases, preserve body
  radius clearance, do not tunnel through them, and an unobstructed nearby body
  moves. These checks assert behavior, not a canonical prop count.
- A real counter arriving over an existing body through a later revision clears
  through bounded local recovery, with every recovery step measured.

The suite passes, and four scratch mutations fail with process exit 1:

```text
first-in-cell truncation:
  closest set differs ... permutation 1: 32,31,30 vs 1197,1198,1190
  query depends on cell insertion order
body sweep disabled:
  head-on bodies overlap at dt=1/60: 0.0004099910 m
solid sweep disabled:
  body overlaps emitted market-counter
  body tunnels through emitted market-counter
recovery disabled:
  body remains inside newly streamed emitted solid after bounded recovery
```

Pinned `./node_modules/.bin/tsc --noEmit` is clean. The existing sim suite returned
`ALL PASS`; its existing crowd readability note still reported **41%** of figures
under 2 px against the documented ≤25% target, explicitly **NOT MET**. No density
or spread assertion was weakened. The full repository checks and independent
vision verdict belong to the orchestrator close-out.

## Performance and actual scene check

The first CPU sample overlapped the ground implementer's capture. Its results
are contention-affected and cannot establish a budget:

| Scene | Active bodies | p50 crowd update | p95 crowd update |
| --- | ---: | ---: | ---: |
| Packed, initially clear, local solver | 6,000 | 24.89 ms | 70.95 ms |
| Same, legacy lane sampler enabled | 6,000 | 31.88 ms | 56.45 ms |
| Seeded hero region, no emitted blocker feed in fixture | 2,550 | 10.18 ms | 16.99 ms |

The single follow-up was started after the capture owner released its GPU round.
It warmed 300 frames, then measured 120 updates per case in Node 26.7.0. It did
not use Chrome, measure GPU time, or establish a quiet whole-machine baseline.
The results remain unsuitable as a rendered frame-rate claim:

| Scene | Active bodies | p50 crowd update | p95 crowd update |
| --- | ---: | ---: | ---: |
| Packed, initially clear, legacy sampler enabled | 6,000 | 66.01 ms | 70.16 ms |
| Seeded hero region, nine authoritative emitted blocker chunks | 2,550 | 35.54 ms | 76.13 ms |

The second scene supplied 1,780 emitted blockers before warming. A final
brute-force body check found true nearest minimum **0.4508285 m**, zero bodies
inside the historical 0.45 m floor and zero true disc/solid penetrations.
The last frame recorded 57 recovery attempts, of which 37 were blocked; the
conservative expanded box corners can request recovery even where the true
rounded disc does not intersect the solid. These values predate the shared
0.25 m mesh radius below and **do not certify clearance for the new mesh**.

These are headless Node CPU timings, not rendered Chrome FPS. The requested
target remains this Mac, Chrome, 1600 × 900 at 60 rendered frames per second.

## Human geometry, physical envelope and instance ABI follow-up

The opened A/B sheets, `shots/compare/2026-10-06T22-47-05.png` and its sidecar,
plus the actual round-two day/night pair show the visual cause plainly: the
daylight actors read as orange signposts with a central leg and detached broad
arms. The reference figures have separated leg silhouettes, shoulders, necks
and heads. Night remains too dark to judge most body detail. This observation
supports the following implementation; it does not approve its new frame.

The old arm boxes reached x=±0.31 m, outside the old 0.225 m collision radius.
Body-center clearance at 0.45 m therefore could not certify actual rendered
non-overlap. `crowdobstacles.ts` now defines the shared physical contract:
`PEDESTRIAN_RADIUS=0.25`, `PEDESTRIAN_HEIGHT=1.7`. The solver consumes it and
requires 0.50 m center clearance, retaining the old 0.45 m floor as a minimum.

`src/render/pedestrianmesh.ts` provides a static human walking pose: two
separated legs and feet, tapered hips/shoulders, connected close arms and hands,
a neck and an octagonal head with a small face projection. Neutral cloth lets
the existing per-agent coat tint carry color. This is no claim of articulated
locomotion or scene behavior. The ground owner owns the one-line entity factory
wiring and holds the old mesh until its ground control capture is saved.

The actual mesh's maximum xz radial extent is **0.243298 m**, below the shared
0.25 m radius; its vertices span y=0 to 1.7 m. Tests inspect all vertices under
16 yaw rotations, and radial invariance establishes the same envelope for
every yaw. A triangle-plane intersection at shin height confirms left and
right supports with an open center. This is geometry proof, not a visual
acceptance score.

`writeInstance` now writes exactly the 24-float ABI record. Its old four-float
density/speed tail overwrote the next record's rotation and was only hidden by
ascending writes. Regression writes slots out of order, checks every float
outside the destination record is unchanged, checks the final capacity slot,
and verifies finite transforms with a unit determinant.

The expanded suite and pinned TypeScript pass. Additional scratch mutations
fail with exit 1:

```text
restored instance tail:
  writing instance 2 changes another record
solver reverted to old 0.225 m radius:
  head-on bodies overlap at dt=1/60: 0.4510000050 m
arm moved outside shared disc:
  human geometry leaves collision disc at yaw
two legs collapsed onto center:
  human shin cross-section is not two separated supports
```

The body/solid/late-revision regressions now use the shared radius. Query
properties remain unchanged. A new independent reviewer must judge the wired
mesh in the next real frame; the implementer does not certify its appearance.

After the material-capture owner released its GPU slot, the final canonical
suite passed with the simultaneous relative-motion checks enabled for all
head-on/crossing dt cases and the large external-gust fixture. Pinned TypeScript
remained clean. These are specific nondegenerate fixtures, not a proof for every
possible velocity assignment. The orchestrator separately reported its explicit
`runSimSelfTest()` execution as `ALL PASS` after the shared-radius/ABI changes.

## Separate grounding audit — measured, not yet implemented

The held round-two instance buffer was checked against the actual tagged
triangles from a current LOD0 bake of its resident chunk `(0,-2)`, seed
6191639. The material work added tags but did not change these walking-surface
positions; the kerb geometry repair had not started. The probe is
`/tmp/syzygy-crowd-grounding-probe.ts` and does not update simulation state.

Saved instance 1853 is at `(114.2770996, 0.349999994, -416.1273193)`, 12.47 m
from the hero camera. Its xz point lies inside upward-wound tagged kerb-top
triangle 68272 at y=0.414999992, so the foot origin is **0.065 m below the
emitted walking surface**. The actual triangle vertices are:

```text
(110.0453033, 0.414999992, -418.9199524)
(114.7870102, 0.414999992, -415.7523193)
(114.8559952, 0.414999992, -416.4087219)
```

Other geometric contacts are 0.20 m above actor origins, but some of those
triangles are currently back-wound. They do not establish visible support.
The upward triangle above is sufficient to refute constant `groundAt=0.35`.
All earlier flat-height motion fixtures test horizontal clearance, not contact
with raised footways. The held mesh comparison remains unchanged.

The proposed separate grounding round would feed exact emitted walking
triangles through a revision-based neutral contract, index them once by local
cells, and query barycentric support height with the existing deck as fallback.
This is a proposal only. It would not regenerate street geometry per actor or
change the saved actor poses used for the mesh-only comparison.

## Reflection

This is still the dispatched task: repair the local query, then make body and
furniture clearance true on nondegenerate input. It produced a working local
solver and failing mutation controls, rather than another density histogram.
The visual crowd still requires the separate frame review; mechanical clearance
does not certify figure identity, market occupancy or a 60 FPS city.

## 2026-10-07 — mesh wired, walking support connected (3 frames)

**Mesh.** `renderer.ts` now uploads `pedestrianMesh()`; the old box figure in
`entityMeshes` is deleted. Also removed a dead upload that sent the whole 4 km
ground mesh to the GPU a second time as `ground2` and was overwritten on the next
line. Hero replay `shots/2026-10-07T15-19-13` against `13-19-01` (same saved
actors, camera, residency; no WGSL errors; grid `shots/compare/2026-10-07T15-19-35.png`):
figures now read as people — two legs with shoes, arms and hands, neck, head —
instead of orange signposts. Observations, not fixed: the per-instance tint
multiplies every vertex, so skin takes the coat colour (green/teal faces); the
small face box reads as a beak at close range (`15-21-41-01e-crowd-closeup.png`);
night is still too dark to judge bodies.

**Grounding.** Nothing called `CrowdSim.setWalkingSurfaces`, so every actor stood
at the 0.35 m deck. Now `walkingTriangles(mesh)` (walkingsurfaces.ts) extracts
tagged paving/kerb-top triangles at bake time into `BakedChunk.walking`; the
renderer concatenates resident chunks once per residency revision
(`crowdWalkingSurfaces()`, like `crowdObstacles()`), and `main.ts` feeds the crowd
beside its obstacles. The street winding fix (street report Round 6) is what makes
this complete: the index skips downward-wound triangles, which used to be half of
all footways. The separation suite now also checks the production extractor
against its independent extraction at the known hero point (mutation: an empty
extractor fails). Live: `crowd-closeup` reports `pop.maxY` 0.5 where every earlier
capture reported 0.3 (rounded foot origins), so actors stand on raised footways.
