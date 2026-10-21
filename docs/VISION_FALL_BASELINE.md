# Vision baseline — the fall zone against sheet B (round 0)

**Reviewer:** vision reviewer, read-only except `src/world/__probe_fallzone.ts`.
**Date:** 2026-10-20. **Section:** B, `cold-industrial`.
**Subject:** the fall zone's first ever photographs. Round 0 is placement and a
greybox; `src/render/fallvillage.ts` is being written in parallel and is not
ready. This document establishes the baseline and names what the *rendered*
village must deliver in each pose. It is not a complaint that a greybox is a
greybox.

**Two runs, two documents-worth of evidence.** Part 1 is the **BEFORE**: the
greybox baseline, run 15:55, before the village existed. Part 2 is the
**AFTER**: the round-0 village (`fae3058`), run 16:41, with the re-derived
cameras. Both are judged against sheet B; the AFTER is the one that counts.

---

## Close-out (DESIGN §6) — after the village run

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg
          references/sections/B-cold-industrial/{01-monolith,02-fog-tram,03-snow-ropeway,04-tram-bridge}.jpg
          shots/2026-10-20T22-55-25/{16,17,18,19}-*.png            (BEFORE, greybox)
          shots/2026-10-20T23-39-50/{16,17,18,19}-*.png            (AFTER, round-0 village)
          shots/2026-10-20T23-39-50/_capture.json
          shots/compare/2026-10-20T23-15-16.png (+ .txt)            (BEFORE grid)
          shots/compare/2026-10-20T23-41-55.png (+ .txt)            (AFTER grid)
JUDGED:   silhouette, mid-band height, material read, palette, value structure,
          atmospheric depth and human scale, per pose, in sheet-B vocabulary
GAP:      the village has no warm emissive points and no cold steel-blue material
          read, so at dusk the whole zone is 78-94% salmon-orange and the mid
          band cannot be told from the industrial belt it stands in
NEXT:     put the section's colour doctrine into the village: cold steel-blue
          and slate on the large surfaces, and one lit window row per pile top
          (D28's quarter of windows lit), so the band is a stratum of warm
          points at 300-1400 m instead of a field of rust chimneys
CONFIRMED: "no done-when can be met by a greybox" — and now, of the village:
          the mid band exists as a distinct stratum in frame (village in frame
          1.3% -> 4.1%, largest pile 29 px -> 87 px, background behind the band
          819 m -> 139 m); the pile crowns are stepped masses with masts, tanks
          and red panels, not the flat greybox slab; the close pose holds a
          subject with a corner edge, ribs and a water tank where the baseline
          held one untextured plane; no column top reads as a floating mass or
          a hard cut
```

**One blocking defect found in `fae3058` itself**, before any frame could be
taken: the app does not boot. `src/render/fallvillage.ts` reads `ROOMS` at
module scope (line 50) while `citymesh.ts` is still initialising, and the
import cycle `citymesh -> fallmesh -> fallvillage -> citymesh` makes that a
temporal-dead-zone read. The page dies with
`ReferenceError: Cannot access 'ROOMS' before initialization`, `window.__syzygy`
never appears, and the harness reports *"vite dev did not answer"* /
*"`window.__syzygy` is missing"*. **The one-line fix** is to build the palette
on demand instead of at module scope:

```ts
const containerPalette = (): Vec3[] => [
  ROOMS[1], ROOMS[0], ROOMS[4], ROOMS[9],
  ROOMS[2], ROOMS[7], ROOMS[8], ROOMS[6], ROOMS[8],
];   // used as containerPalette()[r.int(0, 8)]
```

Verified in a scratch worktree at `fae3058` (app boots, `ready: true`, 1167
frames, 60 fps). **The main tree still has the bug** — `src/render` is the
implementer's file and this review did not touch it. The AFTER frames were
taken in that scratch worktree with only this one-line, geometry-neutral fix
applied; nothing else differs from `fae3058`.

**Provenance of the AFTER frames.** They are evidence of the village, not of a
committed build: the worktree was scratch, it has since been removed, and the
only difference from `fae3058` is that one line, so the frames cannot be
re-derived from the repository as it stands. **The next capture on `main`,
after the boot fix lands, is the control that closes this** — same poses, same
seed, and the village's own pixels compared against these four.

---

---

# PART 1 — BEFORE: the greybox baseline (run 15:55, `shots/2026-10-20T22-55-25`)

## The capture (one run, nothing else on the GPU)

```
node tools/capture.mjs --dev --sequence --pose=fall --timeout 900
→ shots/2026-10-20T22-55-25/   PASS, 5 shots (4 poses + contact sheet), 52.2 s
```

No GPU error and no WGSL error was reported. That matters for pose 19, whose
frame is near-black: **a black screenshot is not a dark scene**, so the run was
checked for errors before the frame was read as a failure.

**Provenance.** These four frames are of the **pure greybox**: the parallel
agent's `fallvillage.ts` and its `fallmesh.ts` edit landed at 16:13-16:16, after
this run at 15:55. Nothing in the village rendering pass is in these frames, and
nothing below judges it.

**Artifact check (PROCESS rule 3).** All four PNGs exist, 1600 × 900, plus
`_capture.json` and `_contact-sheet.png`. From `_capture.json`:

| pose | dayPhase | lodHistogram | lights delivered / starved | notes |
|---|---|---|---|---|
| 16 | 0.243 | [9, 28, 98, 0] | 1090 / 0 | dusk |
| 17 | 0.57 | [9, 28, 98, 0] | 995 / 0 | mid-morning, sun ≈ 29° |
| 18 | 0.243 | [9, 20, 106, 0] | 1249 / 0 | dusk |
| 19 | 0.958 | [9, 28, 98, 0] | 1090 / 0 | high noon, sun ≈ 62° |

`dayPhase` is `(sun.elevation + 0.35) / 1.5`, so the four phases are the four
the poses asked for. No light was starved in any pose, so nothing here is a
lighting-budget symptom.

**The camera applied.** Requested-versus-held, per pose: view direction off by
≤ 0.008°, position off by ≤ 0.06 m. (`stats().camera.lookAt` is a 400 m ray
point, not the target; comparing it to the target directly is a false alarm.) The
held fov carries the camera's own speed bias: −7.4 % on 16 and −7.8 % on 18,
+1.9 % on 17 and +2.1 % on 19. So 16 and 18 are framed **narrower than the pose
asked** — a fact worth remembering before blaming the pose for a tight frame.

**The zone as placed** (seed 6191639 = 0x5e7a17, from `fallzone.ts`): 151
columns — 93 pier, 25 core, 17 lattice, 8 silo, 5 stack, 3 spire — 1 deck
fragment, 61 bridges, 69 wreck pieces, 4138 old buildings. Pile tops: min 53 m,
median 130.7 m, max 176.4 m; **127 of 151 columns have their whole pile inside
the DESIGN §8 band of 75-185 m.** The mid band exists in the placement. The
frames below are about whether it can be seen.

**Method note.** Every "in frame" number below is a screen-space projection of
the zone's own piles through the captured camera, not an eyeball estimate. The
frames were also sampled numerically (`tools/pixel_share.py` plus a raw RGB
patch grid) because two of the four frames are not what they look like at a
glance.

---

## Pose 16 — `16-fall-wreck-up`, the wreck field looking up at a knot of piles

**What the frame shows now.** 7 fall-zone columns have pixels in frame. The
three nearest shafts (48 m, 69 m, 87 m) run out of the bottom of the frame, and
their villages read as **thin dark caps** on warm-lit shafts. The camera is
2 m above the ground looking 65° up, so the frame is mostly sky.

- Palette: warm-dominant, the opposite of sheet B. Every sampled patch is
  R > G > B — sky (142, 98, 81) and (149, 102, 84), shaft (141, 48, 22) and
  (125, 33, 17). Luma mean 65, max 216.
- Value structure: inverted. The *shafts* are the brightest thing in frame
  (they take the dusk sun); the subject — the village — is the darkest thing.
- Atmospheric depth: none. The sky is a smooth brown gradient and the old city
  at the left is crisp, with individually legible windows. Sheet B's depth comes
  from fog flattening the distance into flat blue shapes.

**What sheet B asks for in this frame** (`02-fog-tram.jpg`, the pile-on-columns
shot, and the brief's own bar): a bare, windowless concrete column rising
steeply out of the bottom of frame; on top of it a stack of 6-8 boxy rooms,
**top-heavy and overhanging** the column, with a stepped, cluttered skyline of
aerials, satellite dishes, ladders, stairs and a white tarp; a railed catwalk at
the pile's foot; gridded warm windows; a few rust-red panels; and behind it all,
deep teal fog with distant flat blue towers. Value structure: near-black masses
against a mid teal, warmth only in the windows. The eye is drawn to the pile,
not to the shaft.

**The question the village must answer here.** *At 48 m, does the nearest pile
read as a stack of rooms hanging off its column, or as a box on a stick?*

**The single most valuable change.** **Silhouette before material: build the
pile as 3-10 rotated container layers that overhang the column 1.3-2× and step
down irregularly.** At this distance the village is ~100 px tall and the rest of
the frame is shaft; until the outline is right, no amount of panel detail will
read.

**Camera fault (corrected in the probe).** The old rule scored the knot by
**count** of piles in the cone, so the frame took the three furthest of the
seven and left the rest sky. It now scores by **angular mass** — how much of
the frame the village subtends — and aims at the village instead of past it.
6 piles, 121.9° of angular mass, nearest 20.2 m.

---

## Pose 17 — `17-fall-piles-level`, level with a deck fragment

**What the frame shows now.** The fall zone is 11 % of the frame: the deck
fragment as a **pale grey plank** (18.4 m wide, seen edge-on from 45 m away,
with a hole in it) and the two piles as **flat black boxes** either side
(pile id115 at x 1108-1322, y 357-624; id114 at x 248-509, y 451-628). The
remaining 89 % of the frame is the old city at clear morning — bright teal glass
towers under a near-white sky. Sampled: (87, 153, 163), (172, 191, 207),
(193, 202, 204), (163, 181, 196). Luma mean 122, max 225. That is sheet A/D's
register, not sheet B's.

**What sheet B asks for in this frame** (`01-monolith.jpg`, the frame the DESIGN
names for this pose): a **dark megastructure mass in the near field** with
platforms, catwalks and a long skybridge crossing the frame, aerials and
ropeways, against heavy teal fog in which the distant city is a **flat blue
silhouette** with speckled warm windows. The camera stands *at* the level of
the structure. Value structure: near-black foreground, mid teal middle, pale
blue distance.

**The question the village must answer here.** *Standing on the deck, does the
eye meet a lived-in structure — a rail, a lit window, a stair head, a line of
lamps — or a bare plank?*

**The single most valuable change.** **Build the deck fragment as a street.**
DESIGN already says what it is: *"Where two full-height piers still hold a deck
fragment between them, the fragment is a street in the sky."* That means railings
on both edges, rooms and boxes on it, a stair head, laundry, one warm lamp —
not a slab. A deck with no rail and no lit window is a plank at any exposure.

**Camera fault (corrected in the probe).** The old pose stood 45 m to the *side*
of the deck, which sees it **edge on** — a plank, not a street. It now stands on
the deck, clear of pier a's pile, and looks along it to pier b's village.
*(A first re-derivation put it off the far end of the deck instead; the AFTER
run caught that and it is corrected again in Part 2.)*

**Watch item for the renderer, not the camera.** At clear morning this frame
cannot be judged against sheet B's palette at all: a cold-blue city at noon is
not what the sheet shows. The zone's own identity has to come from its materials
and emissives, not from the time of day (see *the palette the village must
carry* below).

---

## Pose 18 — `18-fall-skyline`, the fall zone as a mid band on the skyline

**What the frame shows now.** The frame is **the old town at dusk**: warm brick
mid-rises with lit windows filling the lower two-thirds, downtown's towers
behind, a rust sky. Sampled: (141, 97, 80), (99, 61, 49), (40, 17, 14),
(133, 27, 0), (78, 8, 3). Luma mean 59.

The fall zone is in the frame but it is **1.3 % of it**: 64 piles project into
view, but the largest is 29 px tall and most are 15-47 px, scattered in a ~110 px
band around y = 400-500, with the old town in front of them and the heart's
**819.1 m** towers behind. Those towers are the dark needle silhouettes in the
upper left of the frame; they stand 22.7° off the view axis. The band's tops
span 5.7° of a 64° frame.

So the recorded fault — "does not yet show a distinct mid band" — is not a
matter of degree. **The band is a 1.3 %-of-frame smudge behind a forest of
819 m towers.**

**What sheet B asks for in this frame.** Sheet B's own vocabulary for a distance
band is frame 3 (`03-snow-ropeway.jpg`): a mass of **warm window light** in the
middle distance, held between darker masses, in cold blue; and frame 1, where
the far city is a flat blue silhouette with speckled warm points. A "mid band"
in sheet-B terms is a **stratum of warm points with a legible top edge**, sitting
between the darker hangars below and the taller downtown above.

**The question the village must answer here.** *Does the fall zone read as a
layer of its own — a distinct row of lit tops between the hangars and downtown
— or as a few grey specks?*

**The single most valuable change.** **Every pile top must carry a legible lit
row** (a line of warm windows, one lamp, an aerial breaking the edge). A pile
that is 29 px tall at 300 m and 1.3 % of the frame can only be read as a warm
point; nothing else survives the distance.

**Camera fault (corrected in the probe) — the largest fault of the four.** The
old rule aimed at the closest pair of spire stumps from 900 m across the belt,
which put the 819 m heart directly behind the band. The new rule takes the
**stretch of the band with the lowest old city behind it** (anchor id122, 483.8 m
clear of any taller building), stands 300 m off it on the downtown side and
looks **out** over the low city. Measured on the derived camera: 55 band columns
in frame, band tops spanning 11.1°, and the tallest old building behind the
band **139 m instead of 819 m**. The village's share of the frame goes from
1.3 % to 4.1 %, and the largest pile from 29 px to 87 px.

**Note for the placement owner.** The band is 3 km across, and the old city
stands in and among it — 1170 of 4138 buildings are over 190 m and the heart's
819 m towers are 942 m from the band centroid. A clean skyline edge for the
band is therefore a *placement* question as much as a camera question, and the
probe's answer is the best available at this seed, not a proof.

---

## Pose 19 — `19-fall-pile-close`, 3 m from a village pile

**What the frame shows now.** One flat plane. Pile id114's box covers **62.8 % of
the frame** (x 230-1375, y 110-900); the camera stood 4.1 m off its face, dead
on, and the face's vertical span of −37° to +56.5° is wider than the 64.3°
frame, so the face covers everything.

Measured, it is not a wall — it is a **void**: uniform blue-navy, luma mean
35.9, min 22, max 55, a smooth gradient from (38, 55, 77) top-left to
(17, 27, 42) bottom-right, and no structure anywhere in the frame.
`tools/pixel_share.py` reports 0.0 % near-black and 0.0 % warm-bright: the
tool's thresholds do not even register it. The cause is not a bug: the greybox
face is one untextured plane with albedo 0.13/0.15/0.18, and at high noon a
near-vertical face is in shadow, lit only by blue sky ambient.

**What sheet B asks for in this frame.** At 3 m, sheet B's surfaces are the
subject, not the skyline: corrugated container walls, panel seams, rust
streaks, a framed window with a lit pane, a railed balcony, a zig-zag ladder,
laundry, a plant box, a solar panel on a roof. The doctrine is explicit —
*"a facade needs to survive a 3 m inspection, not just a 400 m one"* — and this
is the close-focus pose the project has been missing.

**The question the village must answer here.** *Does the village hold up at 3 m
— is there a face on it with panels, a seam, a lit window and a rail?*

**The single most valuable change.** **Build the pile's faces.** `weatherRoom`
already knows how to dress a room (seams, a grime skirt, soot runs, framed
windows with a lit side pane, a railed balcony, a canvas tarp over the roof);
that dressing has to be applied to the pile boxes, and at least one lit window
has to fall in this frame's field. Without a face there is nothing to inspect.

**Camera fault (corrected in the probe).** The old pose was dead-on to a flat
face. It now stands **3 m off the pile's corner**, so the frame holds a vertical
edge, two faces at different values, and the sky above the pile's top instead of
one plane.

---

## The palette the village must carry (applies to 16, 17 and 18)

Sheet B is *near-monochrome steel blue and grey-green across every large
surface, with warmth restricted almost entirely to emissive windows, lamps and
vehicle interiors* — and *"value range carries the image, not hue"*. Two of the
four captured frames are warm-dominant (16, 18) and two are bright cyan
daylight (17), and in all four the fall zone's own surfaces take their colour
from the light rig rather than from the section.

**So the zone's identity has to live in its materials, not in the hour.** The
piles and the shafts want the `ROOMS` palette's own weighting — desaturated
steel blue, slate, soot, rust and red panels — and the *warmth* has to be
emissive: lit windows, a work lamp on a stair head, the string lights on a
mast. The captured frames show the opposite: a warm rust shaft lit by the dusk
sun and a black pile with no window in it, so the warmth is on the wrong
material and the section's accent is missing from the subject.

---

## Camera corrections (implemented in `src/world/__probe_fallzone.ts` only)

These are **derived and measured**, and 16, 18 and 19 were then **photographed**
in the AFTER run. The probe prints each pose with the numbers behind it; the
positions below are its output for seed 0x5e7a17.

| pose | captured (old rule) | re-derived (new rule) | measured effect |
|---|---|---|---|
| 16 | `[540, 2.1, -504]` → `[600, 130.1, -504]`, fov 1.05 | `[570, 2.1, -516]` → `[615.4, 122.4, -495.6]`, fov 1.05 | scores by angular mass, not count: 6 piles, 121.9° of mass, nearest 20.2 m (was 7 piles, nearest 48 m). Photographed: the crowns now read as stepped masses with masts |
| 17 | `[798.2, 156.4, -445.1]` → `[768.5, 158.4, -478.9]`, fov 1.05 | first pass `[735.5, 152, -449.9]` → `[786.5, 159.4, -494.7]`; **corrected** `[765.5, 152, -476.2]` → `[786.5, 159.4, -494.7]`, fov 1.05 | stands on the deck clear of pier a's pile and looks along it; was 45 m off the side, seeing the deck edge-on. The first pass stood *off the end* of the deck (`ux` runs b→a) and put a's whole pile in frame as an unsupported mass — corrected after the AFTER run, **not yet photographed** |
| 18 | `[1322.1, 160, 41]` → `[727.4, 110.4, -634.5]`, fov 1.12 | `[-633.8, 123, 438.5]` → `[-669.5, 135.9, 736.3]`, fov 1.12 | background behind the band **819 m → 139 m**; village 1.3 % → 4.1 % of frame; largest pile 29 px → 87 px; band tops 5.7° → 11.1°. Photographed: the band reads as a ragged stratum of crowns |
| 19 | `[759.5, 152, -470.9]` → `[750.5, 155.4, -463]`, fov 1.1 | `[765.3, 152, -463.2]` → `[761.9, 153, -463.2]`, fov 1.0 | 3 m off the pile's corner: the frame gains a vertical edge, two faces and sky, instead of one flat plane covering 63 % of it. Photographed: ribs, a rust panel, a water tank and a mast |

**What was deliberately not changed.** The poses' times and skies (16/18 dusk,
17 morning, 19 noon) are authored, not derived, and re-timing a section is an
owner's call, not a reviewer's. The times are also what make the palette
question above visible rather than hidden.

---

# PART 2 — AFTER: the round-0 village (run 16:41, `shots/2026-10-20T23-39-50`)

**The run.** `node tools/orchestrate.mjs capture -- node tools/capture.mjs --dev
--sequence --pose=fall --timeout 900` → PASS, 5 shots, 51.0 s, no GPU error and
no WGSL error. Seed 6191639, dayPhase 0.244 / 0.56 / 0.244 / 0.959 (dusk,
morning, dusk, noon — the same four phases as the baseline), lodHistogram
`[9,111,14,0]` on 16 and `[9,28,100,0]`, `[9,34,124,0]`, `[9,34,124,0]` on the
other three, lights delivered 1090-1371 and **starved 0** in all four. The
cameras are the re-derived ones, to the last decimal (16 at `[570, 2.3, -516]`,
17 at `[735.5, 152, -449.9]`, 18 at `[-633.8, 123, 438.5]`, 19 at
`[765.3, 152, -463.2]`).

**What changed in the picture, in one line:** the village is now a real stepped
mass of boxes, awnings, masts and water tanks instead of a flat grey slab, and
the mid band finally reads as a stratum — but the zone is still lit and
coloured like an oil refinery at sunset, and the sheet's cold blue with its
warmth held in emissive points is nowhere in it.

---

## Pose 16 — the wreck field looking up at a knot of piles

**BEFORE:** three bare, warm-lit shafts with thin dark caps; 84 % of the pixels
warm; the village ~2 % of the frame.

**AFTER:** the same three shafts, but each now carries a **crown that reads as
a village** — a stepped cluster of red and slate boxes with two thin masts
breaking the skyline (crop-verified at 2×). The flat greybox slab is gone and
the silhouette is now the stepped one the DESIGN asks for. But the frame is
**94 % warm pixels** (mean RGB 107, 54, 41 — the baseline was 99, 52, 42), so
the village got *warmer* than the greybox, not colder: the shafts and the
crowns are all the same rust-orange as the sky, and the crowns are the only
cold thing in frame.

**Sheet B asks (frame 2):** a bare windowless concrete column with a *stack of
6-8 boxy rooms on top*, top-heavy and overhanging, a stepped cluttered crown,
warm gridded windows, rust-red panels — against **deep teal fog**. The
silhouette language is now half there; the colour doctrine is not.

**Question the village must still answer here:** *can the pile read as a
cluster of lit rooms at dusk, rather than a red cap on an orange shaft?*

**Most valuable change:** the same one as everywhere — cold material and warm
emissive. The crowns must be cold slate/steel-blue with **lit windows**, so
that the one warm thing in the frame is the village and the shaft is cold.

## Pose 17 — level with a deck fragment

**BEFORE:** a pale grey plank seen edge-on with two black boxes either side, in
a bright cyan daylight city; the fall zone was 11 % of the frame.

**AFTER:** the village *is* in the frame now, and it reads: pier b's pile is a
stepped stack of slate and **rust-red** boxes with a **black water tank on legs
and a mast** on top — exactly the "uneven, stepped top with antennas, a water
tank and a white tarp" the DESIGN specifies, and the silhouette is legible
against the sky. The two pier tops and the deck slab read as the "street in the
sky" the DESIGN asks for.

**But this pose is not a fair test, because of a camera fault of mine.** The
re-derived camera stands 19.9 m from pier a — and `ux` runs *from b to a*, so
`a + ux*stand` put the camera **off the far end of the deck**, hovering in
mid-air, with the whole of a's pile (id114, 1088 px wide, 626 px tall) filling
the left half of the frame as a large black mass with no visible support. That
mass is not a cantilever and not a defect in the village: it is pier a's own
pile, seen from beyond the deck's end, with its 9.6 m shaft hidden behind the
pile's own overhanging boxes. **The probe is fixed** (`a - ux*stand`, i.e.
toward b, so the camera stands on the deck between the piers) and
`tools/capture.mjs` now carries the corrected `[765.5, 152, -476.2]`. It is
**unphotographed** — the one capture this round was already spent.

**Sheet B asks (frame 1):** a dark near megastructure with platforms, catwalks
and a skybridge, against heavy teal fog with a flat blue distance.

**Question:** *once the camera is on the deck, does the street in the sky have
railings, rooms, a stair head and one warm lamp — or is it a slab between two
piles?* It is still a slab: the deck carries no rail, no rooms, no lamp.

**Most valuable change:** **build the deck fragment as a street** — railings on
both edges, rooms and boxes on it, a stair head, laundry, one warm lamp.

## Pose 18 — the fall zone as a mid band on the skyline

**BEFORE:** the fall zone was **1.3 % of the frame**, its largest pile 29 px
tall, with the 819 m heart towers standing behind it.

**AFTER:** the mid band now exists. Across the frame there is a **ragged stratum
of village crowns** at roughly y 350-520 — a row of pier tops, each carrying a
cluttered crown of red boxes, masts and tanks (crop-verified at 2×). The
background behind the band is now the low city and the haze, not the 819 m
heart. The camera correction did what it was measured to do.

**And the band still does not read as sheet B.** The frame is **78 % warm
pixels, 0 % cool** (mean RGB 93, 52, 42): sky, piers, crowns, haze and the
city below are all one salmon-orange. Sheet B's rule is the opposite — *"value
range carries the image, not hue"*, warmth *"almost entirely to emissive
windows"* — and **the village has no emissive windows at all**, so at dusk
there is not a single warm *point* anywhere in the zone to sit against the
cold. What the frame shows is a field of rust chimneys with orange hats.

The one thing that *is* sheet B in this frame is the **atmospheric depth**:
the far city is flat, cool and low-contrast, and the haze separates the
layers. The value structure is right; the hue is wrong.

**Sheet B asks (frame 3):** a middle distance that is a **mass of warm window
light** held in cold blue, between darker masses.

**Question:** *does the band read as a stratum of lit villages, or as a row of
orange columns?*

**Most valuable change:** **one lit window row per pile top.** At 300-1400 m a
pile is 30-90 px; the only thing that can make it a *point of light* rather
than a dark speck is an emissive window row, and 127 columns of them are what
would turn this frame into sheet B.

## Pose 19 — 3 m from a village pile

**BEFORE:** one flat plane, 63 % of the frame, luma 22-55, no structure — a
void, not a wall.

**AFTER:** the frame holds a **subject**. The camera is 3 m off the pile's
corner, and the frame now carries: the vertical corner edge with two faces at
different values, a **rust-red container with its corrugation ribs reading as
dark vertical lines** (the kit-1 ribs work), a slate box above it, a **black
water tank on legs** and a mast on top, the deck below and the city behind.
Mean RGB is now 118, 133, 149 (93 % cool) against the baseline's 26, 38, 55:
the frame is no longer a void, it is a lit daylight close-up of a pile.

**And the material read is still thin.** At 3 m the surfaces are flat, untextured
and unlit: no seams beyond the ribs, no grime, no soot run, no framed window,
no lit pane, no door leaves visible, no balcony rail, no ladder, no laundry, no
planter. The DESIGN's "faces" paragraph is rounds 1-2, and it is the whole
remaining content of this pose. The doctrine is explicit — *"a facade needs to
survive a 3 m inspection"* — and this one would not.

**Sheet B asks:** corrugated container walls, panel seams, rust streaks, a
framed lit window, a railed balcony, a zig-zag ladder, laundry, a plant box.

**Question:** *is there a face on the pile with a lit window and a rail on it?*

**Most valuable change:** **`weatherRoom` on the pile boxes, and at least one
lit window in this frame's field.** Form is now there; faces are not.

---

## The two risks the implementer flagged — checked in the frames

**(a) Removing the greybox pile slab: does any column top read as floating or
as a hard cut?** **No, and the removal is a clear win.** The crowns now read as
stepped stacks with masts, tanks and red panels in every frame (16's caps, 17's
centre mass, 18's stratum, 19's pile) — a flat slab capping every pile at
`pileTop` would have flattened exactly the silhouette the DESIGN asks for.
Measured against the placement, three kinds deliberately leave shaft above
their village — a stack 4 m, a lattice cage 3 m, a spire crown 4 m — and in the
frames those read as the intended crown rim, cage top and collar, not as a cut.
**One exception, and it is not a cut:** at 305 m in pose 19, pier id93's pile
(id93, x 296-374, y 596-751) reads as **floating boxes** because its 10.5 m
shaft is 16 px wide and is lost against the bright city behind. That is a
contrast problem at distance, not a geometry fault, and it will be fixed by
anything that gives the shafts value separation from the background.

**(b) Cantilevered boxes up to 3.6 m past the registered pile extent, where
the deck fragments and bridges anchor — a collision read in pose 17?** **No
collision found.** The code puts a cantilever's far edge at `extent + out`,
up to 3.6 m past the registered extent, which is a real overhang; the
implementer's own probe reports the village bounds *"WITHIN"* its tolerance
(`y+7.0 / y-4.6 / xz cantilever`). In pose 17 no cantilevered box intersects
the deck slab or a bridge: the deck's near edge is at pier a and the cantilever
boxes hang at 2-4 m above the pile base, below the deck's underside. **The
floating mass in pose 17 is not a cantilever** — it is pier a's entire pile
(id114), and the cause is the camera sign error above. One real consequence of
the cantilever does show in pose 19: at frame x 310-345, y 585-650 a vertical
column of small boxes hangs with **visible gaps and nothing under it** — a
cantilever stack reading as debris in the air, because there is no outrigger
or bracket under a cantilevered box and none is drawn.

---

## The palette the village must carry (16, 17, 18 — and the gap)

Sheet B is *near-monochrome steel blue and grey-green across every large
surface, with warmth restricted almost entirely to emissive windows, lamps and
vehicle interiors* — and *"value range carries the image, not hue"*.

Measured on the AFTER frames, as a share of pixels that are warm (R>G>B):

| pose | BEFORE | AFTER | sheet B wants |
|---|---|---|---|
| 16 (dusk) | 84 % warm | **94 % warm** | cold surfaces, warm points |
| 18 (dusk) | 81 % warm, 0 % cool | **78 % warm, 0 % cool** | cold surfaces, warm points |
| 17 (morning) | 8 % warm, 90 % cool | 0 % warm, 95 % cool | cold surfaces, warm points |
| 19 (noon) | 0 % warm, 100 % cool | 4 % warm, 93 % cool | cold surfaces, warm points |

17 and 19 are cold, but that is the *city* being cold, at clear morning and
noon; the village in them is black. 16 and 18 are the two dusk frames, and in
both the zone's own large surfaces — the shafts and the crowns — take the
dusk sun's rust. **This is the gap.** Round 0 delivered form and the form is
good; what it cannot deliver yet is the section's colour doctrine, because the
doctrine lives in the emissives (a lit window is the only warm thing sheet B
allows on a large surface) and in the material's own value, and round 0 has
neither. It is also the thing that decides whether the mid band reads at
300-1400 m: a band of dark specks is invisible; a band of warm points is the
sheet's own middle distance.

---

## Open, and not settled by this round

1. **The boot bug in `fae3058` is still in the main tree.** One line in
   `src/render/fallvillage.ts`; verified in a scratch worktree. Until it is
   applied, **the app does not boot and no capture of anything is possible** —
   including the harness's other 23 poses.
2. **Pose 17's corrected camera is unphotographed.** The re-derivation put the
   camera off the end of the deck; it is fixed in the probe and in
   `tools/capture.mjs` (`[765.5, 152, -476.2]`), but this round's capture
   budget was already spent, so the "street in the sky" read is still unproven.
3. **The mid band's skyline edge is partly a placement question.** The band is
   3 km across and the old city stands in among it; the probe picks the cleanest
   stretch at this seed, and a different seed may have no clean stretch.
4. **No city-wide check was run.** `wide-skyline` and `aerial-top` were not in
   this run, so the homogenisation check (DESIGN §6.4) is outstanding for
   anything the village rendering changes.
5. **The village has no faces.** Windows, doors, rails, ladders, laundry and
   the revival kit are rounds 1-2; the close-focus pose 19 is the one that
   cannot be judged until they land.
