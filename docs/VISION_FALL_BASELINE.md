# Vision — the fall zone against sheet B (rounds 0 and 1)

**Reviewer:** vision reviewer, read-only except `src/world/__probe_fallzone.ts`.
**Date:** 2026-10-20. **Section:** B, `cold-industrial`.
**Subject:** the fall zone's first ever photographs. Round 0 is placement and a
greybox; `src/render/fallvillage.ts` is being written in parallel and is not
ready. This document establishes the baseline and names what the *rendered*
village must deliver in each pose. It is not a complaint that a greybox is a
greybox.

**Three runs, three documents-worth of evidence.** Part 1 is the **BEFORE**:
the greybox baseline, run 15:55, before the village existed. Part 2 is the
round-0 village (`fae3058`), run 16:41, with the re-derived cameras. Part 3 is
the round-1 village (`b0d7bf3`, on the boot fix `7f06ac4`), run 20:14, **on
`main`** — so unlike round 0's frames these are evidence of a committed build.

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

---

# PART 3 — ROUND 1: the cold village (`b0d7bf3`, run 20:14, `shots/2026-10-21T03-14-12`)

## Close-out (DESIGN §6) — round 1

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg
          references/sections/B-cold-industrial/{01-monolith,02-fog-tram,03-snow-ropeway,04-tram-bridge}.jpg
          shots/2026-10-21T03-14-12/{16-fall-wreck-up,17-fall-piles-level,18-fall-skyline,19-fall-pile-close}.png
          shots/2026-10-21T03-14-12/_capture.json
          shots/compare/2026-10-21T03-21-18.png (+ .txt)
          (earlier: shots/2026-10-20T22-55-25 = greybox, shots/2026-10-20T23-39-50 = round 0)
JUDGED:   silhouette, mid-band height, material read, palette, value structure,
          atmospheric depth and human scale, per pose, in sheet-B vocabulary
GAP:      the zone's largest surfaces are still plain smooth prisms — the column
          shafts carry no break, no rebar, no stain and no salvage cut, and at
          dusk they are the brightest, warmest thing in the frame, so the warm
          is on the wrong objects
NEXT:     model the column break: a sheared or cratered top with rebar, a
          spalled face and a stain running down from it, on the shafts that
          face the camera — then the village's crowns can be the brightest
          thing in the dusk frames instead of the bare concrete
CONFIRMED: the mid band now exists as a legible stratum of village crowns
          (the largest crown reads at ~60 px in the frame, where the pile
          record's own extent projects to 87 px and round 0's pile slab was
          29 px; and the background behind the band is the low city at 139 m,
          not the 819 m heart); the crowns are stepped masses with masts,
          tanks, ribs and door leaves, not the flat greybox slab; the close
          pose holds a real material read — a corrugated rust container, a door
          leaf, two lit windows, a water tank on legs; the app boots, which is
          the first boot check the fix ever had; 212 crown lights delivered,
          0 starved, 0 refused tiles
```

**The run.** `node tools/orchestrate.mjs capture -- node tools/capture.mjs
--dev --sequence --pose=fall --timeout 900` → PASS, 5 shots, 54.8 s, no GPU
error, no WGSL error, **app ready (frameCount=569)** — the boot fix works, and
this is the first time anything has booted it. The preflight gate was
respected throughout: it blocked on disk (9.2 GB) and then on memory (72-244 MB)
for about forty minutes, and was never bypassed.

**Artifact, from `_capture.json`.** `dayPhase` 0.242 / 0.569 / 0.244 / 0.959 —
the same four phases as the greybox and round-0 runs, so every frame here is
phase-matched against them. `lodHistogram` [9,28,97,0] / [9,28,100,0] /
[9,34,124,0] / [9,34,124,0]. **Lights: delivered 1189 / 1107 / 1383 / 1107
against a 3072 cap, `starved 0` in all four poses, 5700/5700 tile bins, 0
refused tiles.** The 212 crown lights are therefore *not* starved and the
light budget is *not* the constraint in any of these frames.

---

## Pose 16 — the wreck field looking up at a knot of piles

**What the frame shows now.** Three shafts rise out of the bottom of the frame
and converge; they are **smooth, untextured, rust-orange prisms with clean
flat tops**, and each carries a small dark crown of stepped boxes with two thin
masts. The old city is at the upper left with warm lit windows, a black cable
crosses the frame, and the sky is a smooth salmon-brown wash with no fog
structure.

**The palette did not move.** Measured over the whole frame: **94 % of pixels
warm, mean RGB (107, 54, 40)** — against round 0's 94 % and (107, 54, 41). The
warm-bright point count is 0.04 %, also unchanged. The village's own surfaces
are cold; **the shafts are what is warm**, and the shafts are 80 % of the frame.

**And the shafts are not modelled at all.** `fallmesh.ts` still draws a pier as
one `pushOrientedBox` of `CONCRETE`. DESIGN §8's column table asks for
"diagonal shears, spalled craters, rebar bristling, a few at clean salvage
cuts, water stains running down from the breaks" — the *break kind* is in the
placement data (`c.break`: intact, shear, crater, cut) and **nothing renders
it**. Every one of the 93 piers is a clean-cut rectangular prism. At dusk that
prism is the brightest surface in the zone, which is why the frame is 94 %
salmon.

**Sheet B asks (frame 2):** a bare, windowless, *dark* concrete column, with
the pile — not the column — as the subject: a top-heavy stack of 6-8 boxy
rooms overhanging the column, a stepped crown of aerials, dishes, ladders and
a white tarp, warm gridded windows, rust-red panels, a railed catwalk, all
against **deep teal fog**.

**Question:** *does the eye land on the village or on the shaft?* Round 1: the
shaft, by a distance. The crown is legible now — it has a silhouette with
masts — but it is a hat on a stick: the pile is 9-26 m on a 60-150 m shaft, and
no camera change fixes that ratio.

**Most valuable change:** **model the column break** (see NEXT in the close-out).
Second: the crown needs a *lit row* that reads at 20-100 m, not only at 3 m.

## Pose 17 — level with a deck fragment

**What the frame shows now.** The camera fix worked: we stand **on** the deck
and look along it. Pier b's village is in the centre — a stepped stack of
near-black boxes, narrowing as it rises, with a **grey cylinder water tank on
legs** on top and one rust-red box at the left. The city behind is cold and
deeply atmospheric (pale blue-white towers, teal, warm roof lights), and the
deck is a large **blank white plane** across the bottom third.

**The value structure is inverted for sheet B.** 0 % warm, 98 % cool, mean RGB
(118, 135, 153) — and the subject is a **black silhouette** against a pale sky
over a white ground. Sheet B is the other way round: a near-black mass read
against a *mid* teal fog, with the ground dark. Here the frame is high-key
everywhere except the subject, so the village reads as a cut-out.

**And the deck is still a slab.** Nothing on it: no railing, no rooms, no stair
head, no lamp, no cable run. The DESIGN calls it a street in the sky; at
present it is a white table-top with a village at the far end.

**The pile reads as a wedding cake.** The courses narrow as they rise, so the
silhouette tapers; DESIGN wants the opposite — a pile 1.3-2× the column top,
overhanging, hung on outriggers with the bracing visible below, top-heavy. At
this camera the outriggers are hidden behind the pile's own footprint.

**Sheet B asks (frame 1):** a dark near megastructure with platforms, catwalks
and a skybridge, against heavy teal fog, with the far city a flat blue
silhouette.

**Question:** *is the street in the sky a street?* Round 1: no — it is a slab
with a village at the end of it.

**Most valuable change:** **the deck.** Railings, a line of boxes, a stair
head, one warm lamp, a cable run — the same change as round 0's note, still
unbuilt, and it is a third of the frame.

## Pose 18 — the fall zone as a mid band on the skyline

**What the frame shows now. This is the round-1 win.** The band exists and is
legible: a field of piers, each carrying a stepped crown of rust-red and
near-black boxes with thin masts, the largest crown reading at roughly 60 px
(round 0's largest pile slab was 29 px). The background behind the band is the
low city and the haze, not the 819 m heart. **The mid band is now a stratum.**

**And it still does not read as sheet B.** Measured over the whole frame:
**78 % warm, 0 % cool, mean RGB (93, 52, 42)** — against round 0's 78 %, 0 %
and (93, 52, 42). The warm-bright point count is 0.21 %, again unchanged. At
2.6× the crowns are clearly **dark red and black boxes with no lit row on
any of them**; the only warm points in the frame belong to the *old city's*
towers behind the zone. So the band reads as **dark hats on bright orange
needles** — the inverse of sheet B, where the middle distance is a mass of
warm window light held in cold blue.

**Why, when 212 crown lights are delivered and none is starved:** the light
budget is not the constraint. The crown light falls on surfaces whose albedo is
dark slate, while the dusk sun on the bare piers is two orders of magnitude
brighter; the lit patch is therefore dimmer than its neighbour and disappears
at 300-1400 m. **This is a value relationship, not a delivery failure** — the
same lesson as the market-lantern row in `COVERAGE.md` §"Market lantern hang
height", where the fix was never brightness but the value of what the light
lands on.

**Sheet B asks (frame 3):** the middle distance is a **mass of warm window
light** in cold blue, held between darker masses.

**Question:** *does the band read as a stratum of lit villages, or as a row of
orange columns?* Round 1: the latter, with the villages as dark hats on top.

**Most valuable change:** the same as everywhere — **the warm has to be on the
village and off the shafts.** Concretely: break the shafts (so their value
drops and their hue stops being the sun's), and give each crown an emissive
window row that is large enough to survive at 300 m.

## Pose 19 — 3 m from a village pile

**What the frame shows now. The best frame of the three rounds.** A rust-red
container with visible **corrugation ribs and a door leaf**; above it a slate
box room with **two lit windows** and a black box with a third; on top a **grey
water tank on legs** with a mast; the pile on a grey base course on the white
deck; behind it a cold blue-teal city with real atmospheric depth and warm
roof lights. Measured 1 % warm, 93 % cool, mean RGB (117, 132, 149) — and
unlike the other three frames, the *village's own surfaces* are the subject
and they are cold slate and rust, as round 1 claimed.

**The faces are partially delivered, and the lit windows read as spots.** At
1.9×: ribs, a door leaf, and lit windows with a frame are all present. But the
surfaces are **flat and clean** — no grime skirt, no soot run, no panel seam
beyond the ribs, no balcony rail, no ladder, no laundry, no planter, no tarp.
And the answer to "do the crown lights read as light, or as spots pasted on
the surface?" is **spots**: the lit windows are emissive rectangles and the
wall either side of them is the same value as the wall elsewhere. Nothing
spills, nothing falls off, no pool forms under the sill.

**Sheet B asks:** corrugated walls, seams, rust streaks, a framed lit window,
a railed balcony, a zig-zag ladder, laundry, a plant box — and the doctrine's
"a facade needs to survive a 3 m inspection".

**Question:** *is there a face on the pile with a panel, a seam, a lit window
and a rail on it?* Round 1: a face with a window, a rib and a door leaf, and
nothing else.

**Most valuable change:** **make the lit windows light.** Give them a spill
(an emissive that also brightens the surface around it, or a crown light
placed to graze the wall) and put the missing furniture on the faces —
weatherRoom's grime skirt and soot runs, a railed balcony, a ladder, one
planter. This is the frame that tests the doctrine and it is still empty.

---

## What round 1 actually moved, measured

| | round 0 | round 1 | sheet B |
| --- | --- | --- | --- |
| 16 warm pixels / mean RGB | 94 % / (107, 54, 41) | 94 % / (107, 54, 40) | cold surfaces, warm points |
| 18 warm pixels / mean RGB | 78 % / (93, 52, 42) | 78 % / (93, 52, 42) | cold surfaces, warm points |
| 18 warm-bright points | 0.21 % | 0.21 % | a stratum of them |
| 17 warm / cool | 0 % / 95 % | 0 % / 98 % | a mid-teal fog, not a pale sky |
| 19 warm / cool | 4 % / 93 % | 1 % / 93 % | the village's own surfaces cold, rust as accent |
| largest crown in 18 | 29 px | ~60-80 px | legible as a stratum |
| lit row visible on a crown at 300-1400 m | no | **no** | yes |
| lights starved | 0 | 0 | — |

The village's **form** moved: stepped crowns, masts, tanks, ribs, door leaves,
lit windows, and a band that now reads. The **section** did not move: the
palette statistics of the dusk frames are the same numbers to the digit, and
they will stay there until the surfaces that are warm in those frames — the
column shafts — are modelled and darkened.

## Open, after round 1

1. **The column shafts are still plain prisms.** The largest surfaces in the
   zone, unmodelled: no break, no rebar, no stain, no salvage cut, and a warm
   sun on all of it. This is the gap.
2. **The lit rows do not survive 300 m.** They are real at 19 and absent at 18.
   The crown lights are delivered and invisible.
3. **The deck fragment is still a slab**, and pose 17's frame is a third blank
   plane.
4. **The faces are flat and clean**; the lit windows do not light anything.
5. **No city-wide check was run.** `wide-skyline` and `aerial-top` were not in
   this run, so the homogenisation check (DESIGN §6.4) is still outstanding for
   the village rendering.
6. **The cantilever still reads as floating boxes** (pose 19, frame x 310-345,
   y 585-650: a vertical column of small boxes with visible gaps and nothing
   under them). Round 1 seated the cantilevers 0.3 m inside the record and
   put a brace under each, which is right; the *read* is still a stack of
   boxes hanging in the air at 300 m, because the shaft that should carry them
   is 16 px wide against a bright city.

---

# PART 4 — ROUND 2: the break (`bb92f87`, run 10:14, `shots/2026-10-21T17-14-22`)

## Close-out (DESIGN §6) — round 2

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg
          references/sections/B-cold-industrial/{01-monolith,02-fog-tram,03-snow-ropeway,04-tram-bridge}.jpg
          shots/2026-10-21T17-14-22/{16-fall-wreck-up,17-fall-piles-level,18-fall-skyline,19-fall-pile-close}.png
          shots/2026-10-21T17-14-22/_capture.json
          shots/compare/2026-10-21T17-16-56.png (+ .txt)   BASELINE | CURRENT | REFERENCE
          (baseline: shots/2026-10-21T03-14-12, round 1)
JUDGED:   silhouette, mid-band height, material read, palette, value structure,
          atmospheric depth and human scale, per pose, in sheet-B vocabulary
GAP:      the break is a notch in the silhouette, not broken concrete — there is
          no rebar bristling from the shear, no spalled crater, and no stain
          running down the face from the break, so the shafts read as clean
          prisms with a bite taken out of the top
NEXT:     dress the break itself: rebar out of the shear, a spall crater, and a
          stain running down from the break line (DESIGN §8's own words), on
          the shafts that read against the sky
CONFIRMED: the break reads as a break, at 48 m and at skyline distance, and at
          the far LOD — the near piers' tops go from flat cuts to stepped,
          sheared, notched tops, and the mid-distance crowns sit on ragged
          tops (round 2's "in geometry at both LODs" is true and visible); the
          shafts' value dropped and their shadow sides are now violet-grey
          rather than orange; the app boots, the 212 crown lights are still
          delivered with 0 starved, and the light counts are identical to round
          1; the break cost ~5k triangles
```

**The run.** `node tools/orchestrate.mjs capture -- node tools/capture.mjs
--dev --sequence --pose=fall --timeout 900` → PASS, 5 shots, 54.7 s, no GPU or
WGSL error, **app ready (frameCount=1025)**. Preflight OK (4.2 GB free).

**Artifact, against round 1.** Same seed (6191639). `dayPhase` **identical in
all four** — 0.242 / 0.569 / 0.244 / 0.959 — so this is a phase-matched A/B.
`lodHistogram` identical: [9,28,97,0] / [9,28,100,0] / [9,34,124,0] /
[9,34,124,0]. **Lights delivered 1189 / 1107 / 1383 / 1107, starved 0 in all
four, the same counts as round 1** — nothing was starved and the light budget
did not move. G-buffer triangles rose by 4.8k / 5.0k / 6.4k / 4.5k: the break
is cheap. Pixels changed between the two runs: **49.6 %** of 16, 49.1 % of 18,
8.4 % of 17, 13.1 % of 19 — one localised change, in the shafts.

---

## (a) At dusk, are the shafts still the brightest and warmest thing, or has the warm moved onto the crowns?

**No. The warm has not moved.** Measured over the whole frame:

| | round 1 | round 2 | change |
| --- | --- | --- | --- |
| 16 warm pixels | 94 % | 92 % | −2 |
| 16 mean RGB | (107, 54, 40) | (100, 52, 41) | luma 68 → 64 |
| 18 warm pixels | 78 % | 78 % | 0 |
| 18 mean RGB | (93, 52, 42) | (91, 52, 42) | luma 63 → 62 |

What the frames do show is the cold soot-slate arriving on the shafts' **shadow
sides** (violet-grey instead of orange), and the shafts dropping a little in
value. But a grey albedo under an orange light is orange, and at dusk the light
is a sunset: the sun is at 0.75° elevation (`dayPhase` 0.242 → elevation
`0.242 × 1.5 − 0.35 = 0.013 rad`) and the horizon sky is salmon. So the
sunlit faces are still terracotta and the frame is still 92 % and 78 % warm.

And the crowns carry no warmth at all: their red is **material**, and the
warm-bright population of the band is 0.21 % of the frame — the lit windows of
round 1 are 1-2 px at 300-1400 m. The nearest crown in 18 does show a single
cream lit window, which is the first warm point on a village crown in any
frame of this project, but one window on one crown is not a stratum.

**So the value structure is still inverted for sheet B:** the zone is a field of
warm shafts with dark hats on them, where sheet B is a cold mass with warm
points in it.

**A caveat the owner should have, because it changes what the dusk frames can
be used for.** *No frame in the sheet B set is a warm sunset.* Three are cold
fog (01, 02, 04) and one is cold blue daylight (03, the snow canyon). The two
dusk poses are therefore the two frames that **cannot be judged against sheet
B as a palette at all** — they measure the hour, not the zone. The material
has to be judged at 17 and 19, which are cold blue daylight, and there round
2's soot-slate does read: at 19 the pile is rust-red, slate and near-black
against a cold blue city. That is a decision for the owner, not for the
renderer: either the zone gets one review pose in the section's own register
(overcast or blue hour, no sun), or the dusk frames are accepted as a
different hour and judged against the section's *materials* rather than its
light.

## (b) Do the breaks read as breaks at 48 m (16) and at skyline distance (18)?

**Yes as silhouette, no as material.** In the A/B crop of the same band region
(round 1 above, round 2 below) the near piers' tops go from flat cuts to
**stepped, notched, sheared tops**, and the mid-distance crowns sit on visibly
ragged tops. In 16 the central shaft's top is notched, the left shaft is
sheared on a diagonal, and the right is jagged. That is a legible change of
outline and not noise — the claim holds.

**But the break is a notch, not broken concrete.** At 3× on the near pier in 18
the new top edge is clear — a step, a shoulder, a bite out of the rim — and the
shaft faces are still **smooth planes**: no rebar bristling from the shear, no
spalled crater, no stain running down from the break line. DESIGN §8 asks for
exactly those three things, and none of them is in the frame. What the eye
reads is a clean concrete prism with a bite taken out of it.

## (c) At 19, does the near pier read as broken concrete rather than a beige plane?

**There is no pier in the frame at all.** The camera stands 3 m off pile a's
corner at deck height (152 m); pier a's shaft stops at 150.4 m, *below* the
deck slab's top (151.55 m), so the near pier is out of frame entirely and the
close-focus pose cannot judge the break at any resolution.

What fills the lower third instead is the **deck fragment's blank top face** —
mean luma 138 against the pile stack's 73 and the sky's 173. So the largest
surface in the frame is an untextured mid-bright card, and the *subject is the
darkest thing in frame*, which inverts sheet B's value structure (near mass
dark, distance light). The pile itself is good — a rust-red container with
corrugation ribs and door leaves, a slate room with a lit cream window, a
near-black box with a second lit window, a grey water tank on legs — and the
cold city behind it has real depth. The floating cantilever stack is still
there at x 310-345.

## (d) Did the far LOD keep the broken silhouette?

**Yes.** The mid-distance group in the A/B crop (roughly 500-900 m, LOD 2)
shows ragged, notched tops in round 2 where round 1 showed flat cuts, so the
break survives where the merged blocks cannot know about it, exactly as the
round-2 note says: the break is in the shaft geometry, and the shaft is drawn
per kind at both LODs. What survives at that distance is the **silhouette**;
the break's material is sub-pixel there and will stay so.

---

## What round 2 moved, measured

| | round 1 | round 2 |
| --- | --- | --- |
| break reads as a notch (16, 18) | no — flat cuts | **yes** |
| break reads as broken concrete | no | **no** |
| shaft shadow-side hue | orange-brown | **violet-grey** |
| 16 / 18 warm pixels | 94 % / 78 % | 92 % / 78 % |
| 18 largest crown | ~60 px | ~60 px, ragged base |
| warm-bright points in 18 | 0.21 % | 0.21 % |
| lights starved | 0 | 0 |
| g-buffer triangles | — | +5k |

The zone's **silhouette** is now right: broken shafts, village crowns sitting
on the breaks, a band that reads as a stratum. Its **material** and its
**light** are not: the break is still a clean notch, the frames are still a
warm sunset, and the warm in them is still on the shafts rather than in the
village's windows.

---

# METHODOLOGICAL NOTE — three rounds were judged on the wrong hour

**Added 2026-10-21, between rounds 2 and 3. No verdict above is changed by this
note; it changes what the gap means, and it is a testable claim, not a
conclusion.**

**The claim.** Sheet B is a **blue-hour** section. All four frames are
teal-blue, the light source is the sky, and the warmth is emissive — windows
and signs (frame 2: dark teal masses, scattered warm windows, a white tarp).
**None of it is sunlit material.** Our two dusk poses were shot at `dusk`,
whose rig is `sunColor #ff7a2e` at 0.5° of elevation, exposure 1.14 and a
warm colourGrade — so those frames were orange *by construction*, and this
review's own measurement says so: 94 % → 92 % warm pixels at 16 and 78 % → 78 %
at 18 across the material round. "A grey albedo under an orange light is
orange" was the right diagnosis; the inference that the *material* was the
problem was not tested, and the numbers that came back did not move, which is
what an untested inference looks like.

**What exists and has never been photographed.** `src/sim/weather.ts:233-246`
already carries a `bluehour` phase: saturated blue ambient `#2b4a9a` at 0.8,
sun `#5a78d8` at 0.9 with the elevation **-0.11 rad** (6.3° under the
horizon), exposure 1.4, colourGrade `[0.94, 1.0, 1.1]`, sky `bluehour`,
godRays 0.2 — "no direct light worth the name; the sky is the light source, so
the windows are already coming on". It is in `PHASES`, aliased (`blue hour`,
`blue-hour`, `twilight`), wired through `SkyState`, the agent tools and the
local brain, and the sim self-test asserts the day cycle spends time in it.
**No capture pose has ever used it**: `tools/capture.mjs` had 4 dusk, 2
morning, 5 night and 4 noon, and not one bluehour. The one rig written for this
section's light has never been photographed.

**The control (round 3).** `time` on **16-fall-wreck-up** and
**18-fall-skyline** becomes `bluehour`; the cameras, the lens, the poses and
everything else stay exactly where rounds 0-2 put them. The next capture is
therefore a control on the hour and on nothing else, and it is judged on three
questions:

- **(a)** does the frame turn teal — i.e. does the zone's own material read as
  steel blue and slate once the light is the sheet's light?
- **(b)** do the crowns' lit windows read as **warm points against** the cold
  field, rather than as 1-2 px specks (the band is 0.21 % warm-bright pixels
  today)?
- **(c)** do the shafts stop being the brightest, warmest thing in frame
  **without any further material work**?

**A clean refutation is a useful result.** If the frame does not turn teal, or
the warm points still do not read, then the hour was not the binding constraint
and the gap reverts to the material — and the section's own register still
needs a pose shot in it. Either answer is worth the capture; what is not worth
it is a fourth round of judging a sunset against a blue hour.

**A mechanical note, because it changes how the control reads.** A pose's
`weather` block in `tools/capture.mjs` is **inert**. `setWeather` assigns it
(`src/main.ts:974-976`) and the director's next `snap()` writes the *phase's*
own values over it — `seedTargets()` copies the phase look into the base for
every `WX_KEYS` entry, and `snap()` then sets `wx.sky = this.targetSky`. So
the rig — sky, sun, ambient, exposure, grade, haze — comes from `time` alone,
and the `weather` lines in the poses have never done anything. The control is
therefore clean: `time: 'bluehour'` moves the whole rig, sky included, and
"same weather otherwise" is satisfied by construction. The `weather` blocks
have been left in place and are now labelled as documentation; the two blue
hour poses' `sky` fields were changed to match, which changes nothing in the
render.

**What this note does not do.** It does not reopen the verdicts above, and it
does not retract the findings that do not depend on the hour: the pose
derivations and their measurements (the 819 m heart behind the band, the deck
seen edge-on, the void at 3 m), the **break** — a notch, not broken concrete,
which was judged on silhouette and material and not on hue — the near-black
value of the pile against a pale sky, the blank deck, the floating cantilever
stack, and the fact that the zone's *ground* is in none of the four poses. It
also does not excuse the dusk frames: they were read as "the zone is 78-92 %
warm", and that measurement was a measurement of the *hour*, not of the zone.
Both of the dusk reviews should be read as measurements of a sunset.

---

# PART 5 — THE HOUR CONTROL (`6d5e81a`, run 22:19, `shots/2026-10-21T22-19-59`)

**Scope.** This part judges **one change**: poses 16 and 18 were moved from `dusk` to the
existing `bluehour` rig. Same camera, same lens, same geometry, same seed. It is a control
on the hour and nothing else. Rounds 0-2's break dressing is **not** re-judged here; the
round-2 verdict above stands as written.

## Close-out (DESIGN §6) — the blue-hour control

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg (read first)
          shots/compare/2026-10-21T22-21-08.png (+ .txt)   BASELINE | CURRENT | REFERENCE
            baseline: shots/2026-10-21T17-14-22 (round 2, dusk)
            current:  shots/2026-10-21T22-19-59 (bluehour)
            reference column: references/sections/B-cold-industrial/
          full-size: shots/2026-10-21T22-19-59/{16,17,18,19}.png
          same-build control: shots/2026-10-21T22-24-43 (identical command, same HEAD)
          shots/2026-10-21T22-19-59/_capture.json
JUDGED:   palette, value structure, atmospheric depth and material read at poses
          16 and 18; control integrity at 17 and 19 by pixel diff against a
          same-build run
GAP:      the hour is now right and the village is still not lit. At 18 the fall
          zone's crown carries ONE warm point, about 2 px, where every crown in
          sheet B carries rows of window blocks; at 16 the fall zone shows no
          lit window at all and the frame is a near-monochrome indigo wash with
          no value structure to read material against. Warm pixels went 96.9 %
          -> 0.0 % at 16 and 68.8 % -> 0.6 % at 18: the sunset is gone from the
          zone entirely, and nothing warm replaced it
NEXT:     give the fall zone's crowns and pile faces a lit row that holds at
          18's distance — several window blocks per crown, emitted as blocks
          rather than one small point (the day pose 19 already shows cream
          window blocks reading clearly on a pile, so the mechanism works; the
          blue-hour crowns get one dot). One change, then re-shoot 16 and 18
CONFIRMED: the frame turned cold — 18's mean RGB (92,52,42) -> (18,34,79), blue-
          dominant pixels 0.0 % -> 82.3 %, and it now reads as a hazy blue-hour
          city with the distant warm points the sheet is built from; the shafts
          are no longer the brightest warm thing at either blue-hour pose,
          because at the blue hour they are not warm at all; 17 and 19 did not
          regress (below); the app booted (frameCount=980), zero GPU/WGSL
          errors, 1189 / 1107 / 1383 / 1107 lights delivered with 0 starved
```

## The run, and whether the control is valid

`node tools/orchestrate.mjs capture -- node tools/capture.mjs --dev --sequence
--pose=fall --timeout 900` → PASS, 5 shots, 48.4 s. Preflight OK (2248 MB unused; the
benchmark's own gate had refused twice earlier in the session at 168 and 142 MB and passed
on retry). Four PNGs and `_capture.json` present. `"error": null` on every shot, no GPU or
WGSL line in the run, **app ready (frameCount=980)** — the app boots, which `tsc` and
`vite build` do not prove.

Phase, from `_capture.json`:

| pose | round 2 (dusk) | this run | changed? |
|---|---|---|---|
| 16 | dusk, dayPhase 0.242 | **bluehour, 0.164** | yes, by design |
| 17 | clear, 0.569 | clear, 0.564 | no |
| 18 | dusk, 0.244 | **bluehour, 0.164** | yes, by design |
| 19 | clear, 0.959 | clear, 0.958 | no |

Only 16 and 18 changed hour, as `6d5e81a` claims. Lights are identical to round 2 —
1189 / 1107 / 1383 / 1107 delivered, **starved 0** in all four — so the light budget did
not move and nothing was starved by the rig change.

**Control validity, measured rather than assumed.** A raw `BASE -> CURRENT` pixel diff
cannot answer "did 17/19 regress", because this harness lets the day clock drift and the
crowd move between runs. So the same command was run again at the same HEAD
(`shots/2026-10-21T22-24-43`) and used as the noise floor:

| pose | base → current | current → current (same build) | base → current-build control |
|---|---|---|---|
| 16 | 51.08 | 4.19 | 51.03 |
| 17 | 7.02 | 6.78 | **0.96** |
| 18 | 45.08 | 5.81 | 45.07 |
| 19 | 2.52 | 2.48 | **0.82** |

- **16 and 18:** the change is 10x the same-build noise. Real.
- **17 and 19: no regression.** `base -> current-build control` is 0.96 and 0.82 MAE, and
  `base -> current` matches the same-build noise (7.02 against 6.78 at 17; 2.52 against
  2.48 at 19). The 17 frame differs run to run by as much as it differs from base — that is
  the crowd and the 0.005 dayPhase drift, not this commit. The control is valid.
- One pose detail: 16's camera y moved 2.00 -> 2.26 m. The pose is derived and picks up
  ground height; the composition is unchanged between the two frames.

## (a) Did the frame turn teal?

**It turned cold, and it did not turn teal.** The sheet's blue is a pale, hazy
**teal-cyan**; this is a deep saturated **indigo**.

| | round 2 | this run | sheet B |
|---|---|---|---|
| 16 mean RGB | (100, 52, 41) | **(15, 34, 87)** | (50, 94, 109) |
| 18 mean RGB | (92, 52, 42) | **(18, 34, 79)** | (50, 94, 109) |
| 16 warm pixels | 96.9 % | **0.0 %** | 1.1 % |
| 18 warm pixels | 68.8 % | **0.6 %** | 1.1 % |
| 16 blue-dominant pixels | 0.0 % | **98.5 %** | — |
| 18 blue-dominant pixels | 0.0 % | **82.3 %** | — |

The frames are about **2.5-3x darker than the sheet** in each channel and far more
saturated. That is a **rig** observation, not a material one, and it is written down rather
than acted on here: the control changed the hour, and one change at a time. It is the
second thing to fix, after the gap above.

Judged by eye at 18, the frame is nevertheless a real improvement in register: it reads as
a hazy blue-hour city seen across rooftops, with the warm distant points the sheet is built
from, and the value structure of a skyline against a paler sky. At **16** it is worse than
that: two piers filling the frame in one flat indigo, no haze gradation, no value structure,
and **no village in it at all**. Whether 16's camera can show this section is now a fair
question — it frames two bare piers, and the zone's material may simply not be in shot
(PROCESS rule 4). **That is a hypothesis, not a finding**; it needs the pose's own
projection to settle it, and it is not what this control was for.

## (b) Do the crowns' lit windows read as warm points, or still 1-2 px?

**Still dots, and at 16 there are none.** At 18, cropped at 2x around the fall-zone crown,
the crown is a stack of blue boxes with **one** warm point on it, roughly 2 px at 1x. The
ordinary city towers behind it carry window grids that read as points; the zone's own
crowns do not.

The mechanism is not broken — pose 19 (unchanged, still clear) shows **cream window blocks
on a pile reading clearly**, tens of pixels across. What fails is scale and count at
blue-hour skyline distance: one emitter per crown is one dot. Sheet B's crowns carry rows of
lit blocks, several per face, and that density is most of what makes the section read. This
is the gap, and it is the next change.

## (c) Are the shafts still the brightest warm thing?

**At the blue hour the question dissolves: the shafts are not warm.** They are blue
ambient-lit concrete, and the warmest things left in 16 are a handful of distant tower
windows on the left edge. So the round-2 answer ("the shafts are still the brightest warm
thing") was a property of the **sunset**, exactly as `6d5e81a` predicted — remove the sun
and the zone has no warm of its own to compete with them.

At 19, unchanged and still daylight, the red-brown shafts **are** still the brightest warm
thing in frame, which is consistent and expected: nothing about this control touched the
day pose.

## (d) Did 17 and 19 regress?

**No.** `base -> current-build control` is 0.96 and 0.82 MAE; `base -> current` is at the
same-build noise floor for both. See the table above. 17's camera, crown and piles are
identical in composition and hue across all three runs, and 19's cream pile windows, pale
sky and teal towers are unchanged.

## What this control establishes, and what it does not

- **Establishes:** the sunset was doing most of the colour work at 16 and 18, and blue hour
  is the right register for the section — 18 in particular now sits in the sheet's family
  even though it is too dark and too saturated. The hour was a real part of the problem.
- **Establishes:** 17 and 19 are untouched by the commit, measured against a same-build run
  rather than argued from the code.
- **Does not establish** that material work is now sufficient. It is not: at the hour that
  suits the section, the village has no warm inventory of its own and the fall zone is
  legible only as silhouette.
- **Does not re-judge** round 2. The break is still a notch rather than broken concrete on
  the same evidence as PART 4, and the round-2 verdict stands.

---

# PART 6 — ROUND 3A: the lit row (`9b157dd`, run 23:54, `shots/2026-10-21T23-54-59`)

**Scope.** This part judges **one change**: lit *area* instead of intensity — a framed bay on
every dressed face, and a row of 1.7-2.9 m bays on two heights of the merged far mass, in
`src/render/fallvillage.ts`. The baseline is the blue-hour control `shots/2026-10-21T22-24-43`
(parent build `6d5e81a`; the only commits between it and `9b157dd` are docs, and `9b157dd`
touches only `fallvillage.ts` + its own doc). Same hour, same rig, same seed. This is the A/B,
not round 2's dusk run. Round 2's break verdict is not re-judged.

## Close-out (DESIGN §6) — round 3a

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg (read first)
          shots/compare/2026-10-21T23-57-43.png (+ .txt)   BASELINE | CURRENT | REFERENCE
            baseline: shots/2026-10-21T22-24-43 (blue-hour control, parent build)
            current:  shots/2026-10-21T23-54-59 (round 3a, shot after 9b157dd)
            reference column: references/sections/B-cold-industrial/
          full-size: shots/2026-10-21T23-54-59/{16,18}.png (this round)
                     shots/2026-10-21T23-54-59/{17,19}.png (control)
          shots/2026-10-21T23-54-59/_capture.json
JUDGED:   lit area vs lit points at 18 (a count, not an impression); whether 16
          has the fall zone in shot at all; 17/19 against the same-build control;
          warm/dark balance at 18 against sheet B frame 2
GAP:      at 18 the lit row is still a point, not a row: ZERO window blocks on
          any fall crown. The nearest crowns carry one mark each, and the whole
          fall band gained 2.0 % warm pixels (8009 -> 8171). The cause is a LOD
          mismatch, not the bay size: the merged row is drawn only at LOD 2,
          which the renderer reaches at ~819 m (chunk 256 m, LOD = floor(chunks
          / 1.6)), where a 2.9 m bay is 1.9-2.7 px; at 18's nearest columns
          (193-410 m, LOD 0-1) the near path lights one bay per face, which is
          the same single point as the control. 16 is blank for a different
          reason: no fall crown is in the frame at all (the pose).
NEXT:     one change: on the LOD 0-1 path, light a contiguous row of 2-3 bays
          at one height per dressed face (not one bay), so the crowns at 18's
          actual 193-410 m carry blocks; keep the merged row for LOD 2. Re-shoot
          18 and count blocks. Pose 16 is a separate, already-named camera item.
CONFIRMED: cost is inside D32 (+0.06 % G-buffer triangles; lights identical to
          the control, 1189/1107/1383/1107 delivered, 0 starved, app ready
          frameCount=1025); 17 did not change (0.38 -> 0.38 % warm; all diff
          components <= 19 px); 19's near bay is larger and reads better, not a
          regression; 16 shows no fall village, only old-city towers.
```

## (a) At 18, count the blocks on the fall crowns

The fall columns are the dark, windowless stacks; the towers with dense window grids behind
them are the old city. Six nearest fall columns were inspected at 4x, at the screen positions
`src/render/__probe_litrow.ts` prints, in both runs:

| column (screen) | distance | warm px, control | warm px, this run | blocks added |
|---|---|---|---|---|
| id109 (206,422) | 193 m | 12 | 14 | 0 |
| id89 (655,426) | 228 m | 6 | 10 | 0 |
| id108 (554,472) | 264 m | 29 | 30 | 0 |
| id123 (328,520) | 262 m | 70 | 84 | 0 |

(`warm` = R > B + 15 and R > 60, in a 90 x 90 px box centred on the column.) Each crown still
carries **one** mark of about 2-3 px, as in PART 5. Across the whole frame, no new warm
component larger than 16 px exists anywhere; the largest within 45 px of a fall column is
13 px at (373,559), a point. City-wide warm pixels went **1.62 % -> 1.63 %** and strong warm
**0.82 % -> 0.84 %**: the lit area did not arrive.

Why the geometry does not show: the probe's own line `const lod = p.d > 160 ? 2 : 0`
(`__probe_litrow.ts:106`) is an assumption about the renderer, not the renderer. The real rule
is `floor(chunkDistance / 1.6)` with 256 m chunks (`quality.ts:56,67`): LOD 2 starts at 3.2
chunks, about **819 m**. So at 18 the row is drawn only where it is 1.9-2.7 px, and at the
distances where a bay would be 10 px (193-410 m) the near path is what draws — one bay per
face. The "11.7 x 5.8 px at 193 m" in the round's account is the size of a bay that path does
not draw there. This is PROCESS rule 4: the diagnostic measured a distance, not the code path.

## (b) At 16, is there anything to read the shaft against?

**No — and the cause is the pose, confirmed from the frame.** The two piers fill the frame and
run off the top edge; neither crown is in shot. The only lit objects are the old-city towers
at the top-left and left edge, and they are pixel-unchanged: a same-threshold difference of
the two 16 frames finds **0** new strong-warm components >= 6 px, and the 4x crops of the
top-left cluster are the same window grid in both runs. That cluster is the facade shader, not
the fall village (the village's lit marks are sparse warm rooms, not a regular grid).

So the implementer's account is right about 16 for the wrong reason to act on: material did
not fail there, material was **not in the frame**. The pose is the defect (PROCESS rule 4;
D21: a diagnostic pose derives from live state, and this one frames two bare shafts). 16
cannot be used to judge round 3a and must be re-derived before it can judge the next round.

## (c) 17 and 19 — control

**17 did not regress.** Warm pixels 0.38 % -> 0.38 %; 66 diff components, all <= 19 px; the
composition, hue and crowd are the same as the control.

**19 did change, by design, and did not regress.** `9b157dd` changed the shared
`dressFaces` bay, and 19 is drawn at lod < 2, so the near path applies there. The left face
of the near pile now carries a framed three-pane bay where the control had one small pane;
the two changed components are 814 px and 528 px. It is closer to sheet B's window blocks and
is an improvement. The claim that 19 "did not change" is wrong on the frame; the claim that it
did not regress is right.

## (d) Warm/dark balance against sheet B frame 2

18's mean RGB is (17.9, 33.7, 78.7) against the sheet's roughly (50, 94, 109): still 2.5-3x
darker and more saturated, as PART 5 measured. The warm fraction is 1.63 % against the sheet's
1.1 %, but the warm is the old city's window points, not the zone's: the crowns carry one mark
each. The balance is **not** closer to frame 2, because the zone's own warm inventory is still
one point per crown. The sheet's frame 2 carries blocks at several heights on one column; this
frame carries one point.

## What this round establishes, and what it does not

- **Establishes:** the mechanism renders. 19's near bay is a real framed opening, and the
  emissive geometry costs +0.06 % triangles and zero lights. The lever is right; the placement
  of the lever at distance is not.
- **Establishes:** 17 is untouched, and the control is valid.
- **Does not establish** that lit area holds at 18. It does not: zero blocks, one point per
  crown, warm pixels flat.
- **Does not establish** anything about 16's material, because the village is not in the frame.
- **Does not re-judge** round 2.

**One next change, not three.** Put a 2-3 bay row on the LOD 0-1 dressed face, where 18's
columns actually are, and count at 18. The merged row stays for LOD 2. The pose 16 fix is
already named and is a separate item; it does not belong in this round's change.

---

# PART 7 — ROUND 3B: the ground (`0b52d9d`/`fe6bf11`/`b37d74b`, run 01:00, `shots/2026-10-22T01-00-11`)

**Scope.** Three commits, one ground pass: lifelines and work lamps, wreck dressing, and the
flooded lows. The baseline is round 3a (`shots/2026-10-21T23-54-59`), same four poses and
hours, one round between them. The implementer's record
(`docs/FALL_GROUND_ROUND3.md`) was read for what was built; the frames decide. PART 6's next
change (the lit row on the LOD 0-1 path) was not taken; 18's crowns are still one point, and
this part does not re-judge that.

## Close-out (DESIGN §6) — round 3b

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg (read first)
          shots/compare/2026-10-22T01-17-40.png (+ .txt)   BASELINE | CURRENT | REFERENCE
            baseline: shots/2026-10-21T23-54-59 (round 3a)
            current:  shots/2026-10-22T01-00-11 (round 3b, shot after b37d74b)
            reference column: references/sections/B-cold-industrial/
          full-size: shots/2026-10-22T01-00-11/{16,17,18,19}.png
          shots/2026-10-22T01-00-11/_capture.json
JUDGED:   whether the ground pass exists in any of the four frames; what changed
          that is actually visible; 17/18/19 regression; material read at the
          daylight poses and light read at the blue-hour poses, kept separate
GAP:      the round's own subject is photographed NOWHERE. 0 of 4 frames
          contains the zone's floor. 16 looks up from 2.3 m and the lifeline feet
          are below the frame; 17 and 19 stand 152 m above the floor; 18 is
          193-1185 m out and the floor at 193 m lies ~32 deg below the horizon
          against a ~2 deg camera pitch (out of the bottom), while at 1185 m it
          is behind the near roofline. Pose 20 does not exist (grep: no
          "20-fall", no "ground-level"). The measured frame yield is a light
          count, not an image: 16 has 0 new warm components; 18 gains +0.03 %
          warm, its largest new mark in the fall band is 9 px at (1228,480) —
          a point. No pool, silt rim, rubble, rebar or lifeline is readable.
NEXT:     one change: add pose 20-fall-ground-level. Derived from fallZone, not
          typed coordinates (D21): eye at GROUND_Y + 1.7 m in the belt, a
          flooded patch 15-30 m ahead with its near edge in the lower third and
          the sky glint on the water, one winch house or stair-tower foot with
          its warm lamp at the frame edge, and one shaft running out of the top
          edge for scale, the old city behind. Blue hour. Shoot it, then judge
          the ground; do not add more ground geometry before that frame exists.
CONFIRMED: the ground pass is built and compiles: 51,370 tris / 27 chunks (mean
          1,903, max 4,206), 104 work lamps, 0 of 51,370 triangles wound away
          from their normal; lights 1215/1128/1401/1128 delivered (+26/+21/+18/
          +21), 0 starved, app ready frameCount=1025, no GPU/WGSL error; the
          flood branch compiled and the parity test was proved to fail on both
          re-introduced faults; 17/18/19 show no regression in frame.
```

## (a) Is the round in the frames?

**No.** Counted from the poses, not from the record:

- **16** — camera at y = 2.3 m, pitch about 68 deg up. The frame's bottom edge is the two
  shafts; their feet, the winch houses and the stair-tower landings are below it. The only
  warm objects are old-city towers at the top-left, unchanged.
- **17, 19** — both at y = 152 m, on or beside the deck fragment. The floor is 150 m below;
  the frame bottom is the deck (17) and the pile's base (19). Nothing on the floor can be in
  shot.
- **18** — camera at y = 123 m, 193-1185 m out, pitch +2 deg. The floor at 193 m is ~32 deg
  below the horizon, outside the bottom of the field; at 1185 m it sits at the horizon behind
  the near city's roofline. The fall zone reads as crowns and shafts, never as ground.

There is no pose 20 in `tools/capture.mjs` or in `references/sections.json`. The ground pass
is therefore verified by geometry, a shader that compiled, and a parity test — not by a frame.
That is the round-0 failure one level down, exactly as the plan predicted.

## (b) What did change that exists

The only visible change in the four frames is small warm points, and only at 18: warm pixels
1.63 % -> 1.66 %, 99 new warm components >= 4 px, largest 39 px at (813,782) in the near
street (clock/crowd/old-city, not the fall zone). The largest new mark in the fall band is
9 px at (1228,480) — consistent with a work lamp seen end-on at 1.2 km, not with a lit floor.
16 has **zero** new warm components. 17 and 19 are visually identical in composition; their
MAE is 2.41 and 2.25, all diffuse (clock, crowd, the new lights in the chunk), and 19's mean
RGB is unchanged.

So what exists in the frames of this round's work is: the light count, and two or three points
at 18 that could be lamps. Rubble, rebar, slab edges, silt, water and lifelines are not in any
frame at any size. The round's own measured cost (1,903 tris/chunk mean) is a fact about the
mesh, not evidence about the image.

## (c) Regression

**None in frame.** 18's MAE 5.88 is within the same-build/clock noise band PART 5 measured
(5.81) and its silhouette and value structure are unchanged; 17 and 19 read exactly as in 3a;
16's two piers are unchanged. The citywide ground pass touched 27 fall chunks, and no old-city
district changed. Lights rose but nothing starved, and the values did not shift.

## (d) Daylight and blue hour, kept separate

17 and 19 are daylight: their material read (pile, deck, distant towers, cream windows) is
unchanged, and that is a material statement. 16 and 18 are blue hour: their darkness and
indigo are a **light** statement. The absence of the flood, the silt and the rubble from 16
and 18 is not a material failure — those things are not in the frame. No blue-hour frame is
used here to judge a material.

## What this round establishes, and what it does not

- **Establishes:** the geometry exists, compiles, costs about 1 % of the G-buffer, adds 104
  lamps with 0 starved, and the flood branch and its parity guard work (the guard was shown
  to fail on both faults it was written for).
- **Does not establish** that any of it reads. The subject is unphotographed.
- **Does not establish** the flood's material or its reflection, the lifelines' scale, or the
  wreck dressing's read, because no frame contains them.
- **Does not re-judge** round 3a's lit row, or round 2's break.

**One next change, not three.** Pose 20. Until the floor is in a frame, more ground geometry
is unjudgeable, and the reviewer cannot tell a good lifeline from a bad one.

---

# PART 8 — ROUND 3D: pose 20, the zone's floor (runs `01-39-10`, control `01-45-37`)

**VERDICT: more work needed.** Pose 20 is eye 2.05 m at (521.5, −468.1), target
(579, −439.9), blue hour, fov 1.1; derived in `__probe_fallzone.ts`, copied to
`capture.mjs`, explicit in `sections.json` as B. Run `shots/2026-10-22T01-39-10`
(PASS, 65.4 s, frameCount 1089, 0 GPU/WGSL errors; held y 2.019 vs requested 2.1,
8 cm from the ground clamp; direction 5.95° vs 6.0°). Control
`shots/2026-10-22T01-45-37` is the same camera at noon.

**The ground pass is not visible from ground level.** The frame is at the floor
and shows the shaft out of the top and the old city behind, but the floor reads
as a flat dark band: no pool outline, no waterline, no rubble/rebar, and no warm
lamp (0 strong-warm pixels below y 600; the flood band's max is 101/255). At noon
the barrels and hut walls show, still with no water surface and no lamp.

**Why the lamp is not in frame:** `winchHouse`/`stairTower` place the hut on the
column's +b side (`b0 = c.halfZ + 2.9` / `+1.7`); pose 20's camera is on the −b
side (camera local b −11.1 m, house +10.3 m), so the pile stands between it and
the lamp.

**NEXT:** stand 10–18 m from a winch/stair foot on its lamp side, at a pool's
near edge, shaft out of the top; accept the pose only on a warm component below
the horizon.

---

# PART 9 — ROUND 3C: the lit row on the LOD 0-1 path (`d949bf5`, run `01-23-07`, `shots/2026-10-22T01-23-07`)

**Scope.** One change judged: `dressFaces` now lights a contiguous row of 2-3 bays on the
LOD 0-1 path instead of one bay per face. Baseline is round 3a (`shots/2026-10-21T23-54-59`),
same hour, same rig, same seed, one round between them (3b's ground pass, which changed no
fall crown). The implementer's record (`docs/FALL_LITROWS_ROUND3C.md`) was read for what was
built; the frames decide, and the acceptance is a **count**, not an impression: 2-3 contiguous
lit blocks per crown at 193-410 m, at the six nearest columns.

## Close-out (DESIGN §6) — round 3c

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg (read first)
          shots/compare/2026-10-22T02-25-33.png (+ .txt)   BASELINE | CURRENT | REFERENCE
            baseline: shots/2026-10-21T23-54-59 (round 3a)
            current:  shots/2026-10-22T01-23-07 (round 3c, shot after d949bf5)
            reference column: references/sections/B-cold-industrial/
          full-size: shots/2026-10-22T01-23-07/{16,17,18,19}.png, both runs; 4x-8x crops
            of each of the six nearest crowns, both runs; _capture.json (4 shots,
            error null on every shot, starved 0)
JUDGED:   the acceptance as a count at 18's six nearest fall columns (193-264 m, LOD 0);
          whether the row reads as a row and not a bar at 193 m; the near control (19);
          17 as control; 16 as unjudgeable; warm/dark against sheet B frame 2
GAP:      the row is drawn on faces the camera cannot see. Of the 56 lit panes that
          turn toward 18's camera at the six nearest columns, 36 are behind the pile's
          own boxes. Clear of the pile's geometry, per column: id109 13/22, id89 5/12,
          id108 2/8, and id76, id124, id123 0/6, 0/4, 0/4. Counted on the frame:
          id109 5 blocks (runs of 2 and 3), id89 2-3, id108 1 (a 4 px mark),
          id76/id124/id123 none. TWO of the six meet the acceptance, not six.
NEXT:     one change: select the row's face by line of sight, not by the pile's
          crown-first 3-5 face roll — put the row on the outermost face at each level,
          where a stepped pile cannot hide it. Re-shoot 18 and count on the frame at the
          positions the rows are actually drawn (not the probe's; see (b)).
CONFIRMED: the mechanism renders and reads as a row, not a bar — 5 separate blocks with
          1-2 px panels at 193 m, where 3a had one mark; 19 improved, not regressed
          (a 4-block band where 3a had one framed bay); 17 unchanged in composition;
          16 still has no fall crown in frame and cannot judge this; cost inside D32
          (lights +22..+32 delivered — 1221/1133/1405/1133 — starved 0, no GPU/WGSL
          error); warm at 18 flat at 1.31 % (1.32 % in 3a), so no light flood.
```

## (a) The count, at the six nearest columns

Method is PART 6's, unchanged: warm = `R > B + 15 && R > 60`, components at 8x, in a box round
the row the frame actually carries. The right-hand columns are not a guess: each column's own
lit panes were ray-cast against that column's baked mesh (`pushFallVillage`, the renderer's
LOD), and a pane counts as **clear** only if no other box of the same pile stands between it and
the camera.

| column | dist | LOD | panes facing camera | clear of the pile | blocks counted on the frame |
| --- | --- | --- | --- | --- | --- |
| id109 | 193 m | 0 | 22 | 13 | 1 -> **5** (runs of 2 and 3; x 137-177, y 388-396) |
| id76 | 198 m | 0 | 6 | 0 | 0 -> **0** |
| id124 | 225 m | 0 | 4 | 0 | 0 -> **0** |
| id89 | 228 m | 0 | 12 | 5 | 1 -> **2-3** (x 621-641, y 377-383) |
| id123 | 262 m | 0 | 4 | 0 | 0 -> **0** |
| id108 | 264 m | 0 | 8 | 2 | 0 -> **1** (4 px, x 512-513, y 478-481) |

Two of six. Where the row is visible it is better than the spec asked: id109's five blocks
resolve into a run of two and a run of three with a 12 px gap between them, so the crown carries
two rows at one height, and at 193 m the 0.45 m panels survive as 1-2 dark columns — the row is
**not** the 31 px bar the implementer was right to fear. The failure is elsewhere: on four of
the six crowns the row exists only on faces the pile hides from this camera.

This is not the implementer's reading. They report 3 blocks at id109, 3 at id89, **4 at id124**,
**3 at id108**, 2 at id76 and 2 at id123. The last four are not in the frame: at id124, id123
and id76 the pixels where the probe puts the panes are cold (max `R-B` −33, −58 and the old-city
grid), and the probe itself says every one of those panes is occluded. id124's "4" is id109's row:
id124's 130 px box (x 100-230) contains id109's crown.

## (b) The probe's screen map is about 12 % too close to the frame centre

Four independent bands agree on one factor, `800 + (predicted - 800) x ~1.1`:

| what | probe predicts | drawn at |
| --- | --- | --- |
| id109's clear row | x 185-225, y 395-398 | x 137-177, y 388-396 |
| id89's clear row | x 645-663, y 386-388 | x 621-641, y 377-383 |
| column 74's row | x 1015-1028, y 477-479 | x 1039-1052, y 478-482 |
| id108's 2 clear panes | x 543-544, y 475-476 | x 512-513, y 478-481 |

The **world** positions, distances and LODs are unaffected — that part of round 3a's fix is
sound — but `project()` is not the renderer's screen. Consequence: anything counted in a box at
the probe's screen position is counted in the wrong place. PART 6's 90 px box at id109 read
12-14 px while the row is 40 px wide; 3c inherited the same positions and reported four rows it
could not see. This is PROCESS rule 4 again, in the other half of the same probe: it measured a
projection, not the frame. The cause is not established — the recorded held fov (1.04821) and
the fov the probe uses (1.04840) agree, so a focal/aspect convention in the capture path is the
hypothesis, not a finding.

## (c) 19 is the clearest evidence the mechanism works

At 3 m the near pile's upper container carries a **4-block lit band** where 3a had one framed
bay. It reads as a window wall with jambs and mullions, not a decal, and it is the one frame
where the row is unambiguously on a visible face. Not a regression — an improvement on a pose
PART 6 already called a pass.

## (d) 17, 16, and the balance

**17** is the same frame as 3a: same composition, no new lit geometry in the grid, no row visible.
That is consistent, not reassuring — 17 sees the pies from the deck, and its dressed faces are
not the ones turned to the camera either.

**16** has no fall crown in frame (PART 6 (b)); it cannot judge this round and was not counted.

**Against sheet B frame 2:** the sheet's tower carries eight to ten blocks at several heights;
this frame carries five on one crown and two to three on another, and nothing on the other four
nearest crowns. The value structure has not moved — whole-frame warm 1.32 -> 1.31 % — because
~600 new lit pixels in a 1.44 M px frame is what two crowns look like, not what a lit zone looks
like.

## What this round establishes, and what it does not

- **Establishes:** the row renders, and at 193 m it is countable blocks, not a bar. The bay
  size, the 0.45 m panel and the per-face key are all right.
- **Establishes:** where the row is on a visible face it beats the acceptance (19 at 3 m,
  id109 at 193 m).
- **Establishes:** the probe counts geometry that the frame cannot see. 36 of 56 camera-facing
  panes at the six nearest columns are behind the pile's own boxes. A probe that admits a face
  by the sign of `n · toCamera` will keep reporting rows that no frame contains.
- **Does not establish** that four of the six crowns carry a row. They do not.
- **Does not re-judge** round 2, round 3a's verdict, or pose 20 (PART 8).

**One next change, not three.** Choose the face by line of sight: the row goes on the outermost
face at each level. The count is not the lever this round thought it was — 292 bays already
exist, and 20 of the 56 that face the camera can be seen.

---

# PART 10 — ROUND 3D, SECOND PASS: pose 20 on the lamp's side (`8e10f35` pose, run `03-11-38`, `shots/2026-10-22T03-11-38`)

**Scope.** One change judged: the pose. PART 8's NEXT was "stand 10-18 m from a winch/stair foot
on its lamp side, at a pool's near edge, shaft out of the top; accept the pose only on a warm
component below the horizon". The camera is now eye (558.1, 1.97, −452.4) → (471.1, 19.7, −501.8),
fov 1.0754, pitch 10.0° up, bluehour; winch foot id54 is 15.0 m away with the camera on its lamp
side (camera local b 24.8 vs foot b 11.2). **No world change.** The baseline is the old pose 20
(`shots/2026-10-22T01-39-10`, PART 8's frame) — a different camera on the wrong side of the pile,
same hour, same seed. The implementer recorded the lamp defect in `docs/POSE20_FIX.md`; the frames
decide, and the numbers below are mine.

## Close-out (DESIGN §6) — round 3d, second pass

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg (read first; frame 3 is the ground-level reference)
          shots/compare/2026-10-22T03-21-39.png (+ .txt), row 5:
            BASELINE shots/2026-10-22T01-39-10 | CURRENT shots/2026-10-22T03-11-38 | sheet B
          full-size 20-fall-ground-level.png in both runs; 2-4x crops of the stall and crowd,
          the water band, the near floor and the shafts; _capture.json (5 shots, error null,
          lights 1133, starved 0)
JUDGED:   the five things the round had to deliver, on the frame: a warm source below the
          horizon; a pool whose edge and surface are legible; rubble/rebar; lifelines; the
          floor as a place with people — and whether the frame is the fall zone or a plaza
GAP:      nothing warm is below the horizon. Horizon is y 583-596 by geometry (pitch 10.0°;
          583 at the probe's focal 756 px, 596 at the ~12 % longer focal PART 9 measured);
          warm pixels stop at y 618 and the brightest are the stall's sign at
          (386-400, 586), RGB (214, 67, 0) — i.e. every lit thing in the frame sits on the line,
          50 m out. The bottom third (y 600-900) is unlit: 0 warm-bright px, 3 loose-warm px.
          Cause, verified in code not taken on report: `winchHouse`'s head is at GROUND_Y+2.55
          (2.43-2.67 m) at the hut's own centre, inside a box 0-2.70 m tall — the emitter is
          buried, so it casts no source and no pool. And the pool itself is a decal: rippled,
          35 % brighter than the paving, with no reflection of the 572 lit towers behind it.
NEXT:     one change: move the lamp head out of its own body — onto the door face
          (`b0 + 1.72`, GROUND_Y+2.2) or a bracket above the roof — so this camera, already
          15 m out on the right side, has one source below the horizon. Re-shoot 20 and accept
          on warm below y 600 > 0 plus a specular in the water; the water's reflection is the
          round after.
CONFIRMED: the pose itself is fixed — the camera is on the lamp side and at a real pool's edge
          (the pile is behind the head, not in front of it); the stall and its crowd read, and
          they are new to this frame; the water's value break is real and bounded on both sides;
          the shafts' scale reads, and the old city behind them is a different place; the pose
          change touched no other pose's content (16/17/18/19 against the 3c run: mean RGB
          within 2.3/255 and warm within 0.07 pp on every frame — the pixel-level differences
          are dither and crowd, not geometry).
```

## (a) The one gate that decides it: warm below the horizon

| | value |
| --- | --- |
| camera pitch / focal | 10.0° up / 756 px → horizon at **y 583** (y 596 at the corrected focal) |
| warm-bright (R > 120, R > 1.6 B) below y 600 | **0.000 %** (0 px) |
| loose warm (R > B + 15, R > 60) below y 600 | 0.003 % (3 px, the stall's lower edge) |
| rows carrying any warm pixel | 0 .. 618 |
| brightest warm in frame | (386-400, **586**) RGB (214, 67, 0) — the stall's sign, on the horizon |
| whole-frame warm | 2.52 % loose / 0.51 % bright (3d first pass: 1.38 / 0.25) |

So the pose improved the frame's warm inventory by putting a lit stall and a crowd in it, and that
is a real gain over PART 8's frame — but it is *at* the horizon, not below it. The gate PART 8 set
is not met, and the reason is not framing: the emitter is inside its own hut (see GAP), so no
camera position can meet it. The implementer reached the same conclusion and left it; I verified
the geometry independently (`fallground.ts`: hut box GROUND_Y+0..2.70, roof to 2.94, head
2.43-2.67 at the hut centre), so the defect is real and the round's pass/fail is a world item,
not a pose item.

## (b) The water: a value band with a ripple decal on it

Measured on the frame (blue channel means, 1600 px rows): far floor y 610-690 **48.1**, the water
band y 700-790 **63.9**, near floor y 800-890 **47.3**. So the band is real, and 35 % brighter than
the paving on both sides — the implementer's "45 % break" is the same thing measured on a slightly
different band. Both edges are value steps, not gradients.

What it does *not* do is read as water:

- **No reflection.** The band is uniform blue with a 15 px fbm ripple; none of the 572 lit towers
  behind it appear in it. PART 8 named this risk (no SSR, no probe) and the round did not change it.
  Water at blue hour is mostly reflection; a brighter, rippled floor is mostly floor.
- **The ripple is the readable thing, not the water.** High-pass energy (13 px kernel) is 5.1 in the
  band against 3.4 on the near paving and 8.2 in the far strip — the arcs are dense everywhere and
  their autocorrelation peaks at ±15 px in x, i.e. one motif scale across the whole band. At 1x the
  bottom third reads as a field of concentric ring decals with a value step in it. That is the
  failure the brief asked about, in its own words: a repeating pattern laid over the floor.
- **No edge treatment.** No waterline, no debris raft, no silt lip, no depth change at the edge —
  the step is only brightness. The one pale streak at bottom right (x 1250-1500, y 760-800) is a
  diffuse sheen with no source visible in frame.

## (c) Rubble, rebar, lifelines

**One** piece of ground clutter reads: a crate/barrel-sized dark box at (1030, 660), silhouette
only, no contact shadow. There is no rebar and no debris field in this frame. The wreck's slab is
in frame at ~40 m — the large rounded mass at x 560-880 — and it reads as a **smooth dome**: its
rubble ridge is sub-pixel at that distance and the plate's face is unbroken, so the one piece of
the zone's debris actually in shot reads as a boulder. **No lifeline reads**: no cable is legible
against the open floor or the shafts, and the drum's cable run climbs out of the top of the frame.

## (d) People, and whether this is the fall zone

**The crowd reads.** At the stall, ~50 m out (feet at y 610-615, 2 m figures at 25-35 px), roughly
ten silhouettes stand at a lit canopy with red signage; they are the best thing in the frame and
the first time the zone's floor has had people on it in a judged frame.

**The zone's identity is half there.** The two shafts — 120 m, out of the top edge at 78° — are
unmistakably the fall's columns, and the old city behind them (a wall of lit window grids) is a
different place, so the city-wide check passes: the zone does not look like the rest of the city.
But the container piles, which are the village half of the zone's identity, are **not in frame at
all** — at 2 m eye height with 10° of up-pitch the piles are 20-60 m overhead and out of shot. A
stranger shown this frame would read "a dark plaza at the foot of two pylons", not "the village".

## What this round establishes, and what it does not

- **Establishes:** the pose fix works and was worth doing. The camera is on the right side, at a
  real pool's edge, with the stall and its crowd in shot — a strictly better frame than PART 8's.
- **Establishes:** the floor still has no light of its own. Verified in code and on the frame: the
  head sits inside the hut, so the gate cannot be met from any pose.
- **Establishes:** the pool is a value break plus a ripple decal; it is not yet water. Naming the
  reflection as the next water change, and the lamp as this round's next change.
- **Does not establish** the ground "reads" — the five things asked for score: people **yes**,
  pool edge **weak**, water surface **no**, rubble/rebar **no**, lifelines **no**, warm below the
  horizon **no**.
- **Does not re-judge** rounds 3a/3b/3c or pose 20's role in the section beyond the above.

**One next change, not three.** Move the lamp head clear of its own body: the door face or a roof
bracket, one lamp within 15 m of this camera. That single source is what turns a rippled plaza into
a working floor at night, and it is the only change that can invalidate this verdict in one frame.

# PART 11 — ROUND 3E: the row on the face that looks out (`492d97c`, run `03-26-25`, `shots/2026-10-22T03-26-25`)

**Scope.** One change judged: `dressFaces` now picks the row's long face by line of sight
(outward normal away from the pile's own axis) instead of by the unit's roll. Baseline is round
3c (`shots/2026-10-22T01-23-07`), same hour, same rig, same seed; one round between them
(3d's pose work, which changed no fall crown). The implementer's record
(`docs/FALL_LITROWS_ROUND3E.md`) was read for what was built; the frames decide, and the
acceptance is a **count**, not an impression: 2-3 contiguous lit blocks per crown at 193-410 m,
at the six nearest columns, counted on the frame where the row is actually drawn — not at the
probe's projection (PART 9 (b) measured that map ~12 % too close to frame centre).

## Count (pose 18, six nearest fall crowns, drawn positions)

Method: warm = `R > B + 15 && R > 60`, 4-connected components, in a box round the row the
frame actually carries (not the probe's). Baseline column is 3c's count from PART 9.

| column | dist | 3c blocks | 3e components (≥4 px) | visible blocks (by eye) | drawn where (x, y) |
|---|---|---|---|---|---|
| id109 | 193 m | 5 | 4 (28, 14, 14, 8) | 3 — two adjacent panes read as one window with a mullion | 136-173, 387-396 |
| id89 | 228 m | 2-3 | 1 (62) | 1 — one merged band with a notch, not two | 621-633, 377-383 |
| id76 | 198 m | 0 | 2 (24, 24) | 2 | 759-772, 658-665 |
| id124 | 225 m | 0 | 2 (20, 4) | 1 — the second is a 1 px × 4 px sliver, not a block | 115, 119-124, 444-448 |
| id123 | 262 m | 0 | 2 (33, 32) | 2 | 272-290, 502-507 |
| id108 | 264 m | 1 | 1 (5) | 1 — a stack; the face rule cannot reach it | 511-512, 478-481 |

**3 of 6 crowns carry 2+ visible blocks strictly; 4 if id109's adjacent panes are split and
id124's sliver is counted. The acceptance asks for 5 of 6. It is not met.**

## Close-out (DESIGN §6) — round 3e

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg (read first; frame 2 is the crown reference)
          shots/compare/2026-10-22T05-01-07.png (+ .txt)   BASELINE | CURRENT | REFERENCE
            baseline: shots/2026-10-22T01-23-07 (round 3c)
            current:  shots/2026-10-22T03-26-25 (round 3e, shot after 492d97c)
            reference column: references/sections/B-cold-industrial/
          full-size: shots/2026-10-22T03-26-25/{16,17,18,19,20}.png and
                     shots/2026-10-22T01-23-07/{16,17,18,19}.png
          4-8x crops of each of the six nearest crowns (id109, id76, id124, id89, id123,
            id108) in both runs; _capture.json (5 shots, error null, lights 1222, starved 0)
JUDGED:   the acceptance as a count at 18's six nearest fall columns at drawn positions (not
          the probe's); whether the row reads as a row and not a bar at 193 m; the near control
          19 (lost 4-block band); 17 and 16 as controls; warm/dark against sheet B frame 2;
          the city-wide check
GAP:      acceptance not met — only 3 (at most 4) of 6 crowns carry 2+ visible blocks.
          id89 regressed from 2-3 blocks to one merged 62 px band because the outward-face
          selection dropped the second bay; id108 is a stack the face rule cannot reach;
          id124's second "block" is a 1 px sliver; pose 19 lost its 4-block band with nothing
          replacing it in that spot.
NEXT:     light the row on both long faces of each box (not one), so every pile carries a row
          on the face any camera sees; keep the cost check (D32). Re-shoot 18 and 19, count
          blocks at 18, verify 19 recovers its band.
CONFIRMED: the mechanism reads as a row, not a bar, at 193 m (id109: distinct blocks with
          1-2 px mullions, not the 31 px bar 3a feared); id76 and id123 gained 2 blocks each
          (0 -> 2); 17 unchanged (warm 0.291 -> 0.290 %, same composition, no new geometry);
          16 still has no fall crown in frame and is not a material read; no GPU/WGSL error;
          warm at 18 1.31 -> 1.34 % (no light flood); LOD 2 merged pass byte-identical by
          construction (2,872 quads / 7,842 m²); city-wide heterogeneity preserved (old-city
          window grids still read as a different place behind the fall crowns).
```

## (a) The count, at the six nearest columns, where the row is actually drawn

The probe's own numbers (3e's record) are not the frame's. Four independent bands already
showed the probe's screen map lands ~12 % too close to frame centre (PART 9 (b)); counting in a
90 px box at the probe's position reads geometry that is not there. The table above is counted
from the warm pixels where each crown's row actually sits (crops at 4-8x, both runs), and the
drawn positions are listed so the next round can re-count them.

- **id109 (193 m)** is the one crown that unambiguously carries a row: four warm components
  (28, 14, 14, 8 px) spanning x 136-173, y 387-396, with 1-2 px dark mullions between them.
  At 1x it reads as a row of three openings, not the 31 px bar 3a feared. This is the round's
  genuine win, and it is the only crown that improved *and* stayed visible.
- **id89 (228 m)** is the round's quiet regression. In 3c it carried two components (63 and
  9 px, x 621-641, y 377-383); in 3e the outward-face selection merged them into one 62 px
  band with a single notch. The second bay did not disappear from the frame because it was
  hidden — it disappeared because the row left that face. The implementer's "2 blocks" counts
  the notch as a split; on the frame it is one connected region.
- **id76 (198 m)** and **id123 (262 m)** are the round's clear gains: 0 -> 2 blocks each,
  now on faces the camera sees. These are the crowns the rule was written for.
- **id124 (225 m)** is a gain with an asterisk: one 20 px block plus a 1 px × 4 px sliver.
  The sliver is the row's second bay seen at a grazing angle on a small box; it is warm by
  threshold but it is not a visible block at 1x. Counted strictly, id124 carries one block.
- **id108 (264 m)** is unchanged at one 5 px mark. It is a stack, and the selection's `|a|`
  tie-break lands on its flanks, which this camera sees edge-on. No face rule can reach a box
  that is not on the camera's arc; this one needs a different lever (the pick), not a face rule.

## (b) Does the row read as a row and not a bar, at 193 m?

**Yes.** id109's row is four separate warm regions with 1-2 px dark columns between them at
y 387-396. The dark gaps are the panels/mullions, not dither: they are 1 px wide and run the
full height of the row, and the warm regions on either side are 10-14 px and 28 px wide. A bar
would be a single connected warm strip; this is not one. The 0.45 m panel survives at 193 m as
a readable dark line, which is the thing the bay size was chosen to protect.

## (c) The near control, 19, lost its 4-block band — is that acceptable?

**No, not as a standing consequence — but it is an honest one.** The 4-block band that 3c
carried (68 px component, x 1234-1245, y 644-650) is gone in 3e; it is not replaced by
anything in that spot (the nearest surviving warm component is 180 px at x 1215-1229,
y 657-670, a different mass). The camera at 19 sits 3 m from that box's inward side, so the
row that used to open on the face it saw has moved to the outward face, which the box now
hides. That is the rule working exactly as written — and it is also a real visual loss at a
pose PART 9 praised, with no compensating gain that meets the acceptance. The trade was not
worth it: we bought 3 crowns a row and took the best close-up away. The consequence is
acceptable only if the next round recovers it, which a single-face rule cannot do from this
camera. The fix is to stop choosing one face: light the row on both long faces, so whichever
face a camera meets carries a row and the far face's row is simply hidden by the box.

## (d) 17 and 16 as controls

**17 is unchanged.** Warm 0.291 % -> 0.290 % (4186 -> 4181 px); the composition, hue and crowd
are the same as 3c, and no new lit geometry appears in the grid. Consistent, and this time it
is reassuring because 3e's change touched `dressFaces`, which 17's dressed faces are not
turned toward — so "unchanged" means the lever did not leak, not that it did nothing.

**16 is not a material read and still cannot judge this round.** Warm 0.102 % -> 0.111 %
(1473 -> 1601 px), a small rise that is crowd/dither on the old-city towers at the frame edge;
no fall crown is in the frame (PART 6 (b)), so the village's material is not tested here. It
is a valid control for "did the change leak into a frame with no fall crown" — it did not.

## (e) Warm/dark against sheet B frame 2

18's mean RGB is (18.2, 33.9, 78.7) against 3c's (17.9, 33.7, 78.7): the value structure
has not moved, because ~440 new lit pixels in a 1.44 M px frame is what three crowns look like,
not what a lit zone looks like. Whole-frame warm 1.31 % -> 1.34 %, still near the sheet's
~1.1 % but carried by the old city's window points, not the zone's. The sheet's tower carries
eight to ten blocks at several heights on one column; this frame carries a row on three
crowns and one mark on the other three. The warm/dark balance is not closer to frame 2, because
the zone's own warm inventory is still sparse. The balance will not move until more crowns
carry rows, which is the acceptance this round missed.

## (f) The city-wide check

**Passes.** Pose 18 still reads as two places: the fall crowns (dark, windowless stacks with
sparse warm rows) in front of a wall of old-city window grids. The zone does not look like the
rest of the city, and 3e did not homogenise it — the added rows are sparse enough (3-4 crowns,
1-4 blocks each) that the city-wide read is unchanged. Pose 20 (ground level, current run) is
2.51 % warm and was not re-judged this round; the lamp defect named in PART 10 (the head
buried inside its own hut) is a separate, still-open item and is not touched by this round.

## What this round establishes, and what it does not

- **Establishes:** where the row is on a face the camera sees, it is a row and not a bar, and
  the bay size, panel and per-face key are all right. id109 at 193 m and 19 at 3 m (in 3c)
  remain the proof that the mechanism works.
- **Establishes:** a camera-independent face pick can *remove* a visible row (19) while
  *adding* hidden ones (76, 123, 124). The rule is necessary but not sufficient.
- **Establishes:** 17 and the city-wide check are untouched; no leak, no flood, no GPU/WGSL
  error; LOD 2 merged pass byte-identical.
- **Does not establish** that 5 of 6 crowns carry 2-3 blocks. Three do, four if generous.
- **Does not establish** that id108 can be reached by any face rule (it cannot; the pick is
  the lever).
- **Does not re-judge** rounds 3a/3b/3c, pose 20's lamp, or the ground pass.

**One next change, not three.** Light the row on both long faces of each box, not one, so every
pile carries a row on the face any camera sees and the far face's row is simply hidden by the
box; keep the cost check (D32). Re-shoot 18 and 19, count blocks at 18 against the table
above, and verify 19 recovers its band. id108's pick and id124's grazing angle are the same
change's to verify, not separate items.

---

# PART 12 — ROUND 3F: the head on the door face (`8608fbe`, run `05-05-49`, single shot, `shots/2026-10-22T05-05-49-20-fall-ground-level.png`)

**Scope.** One change judged: the work-lamp head in `winchHouse` and `workshopYard`
moved out of its own hut body onto the door face — `lamp(hx, GROUND_Y+2.55, hz)` →
`lamp(dx, GROUND_Y+2.2, dz)` and `lamp(hx, GROUND_Y+3.1, hz)` → `lamp(dx,
GROUND_Y+2.2, dz)` (git show `8608fbe`: two lines in `src/render/fallground.ts`,
nothing else). No pose change, no light-count change (1133 delivered, 0 starved,
**both** runs). The acceptance PART 10 set is "warm below y 600 > 0 plus a specular
in the water"; the specular was explicitly deferred by PART 10 (b) to the round
after, so it is not judged here. The implementer's record
(`docs/POSE20_LAMP_HEAD.md`) first claimed the gate met; it stands corrected
(`f90961d`) to "met only nominally"; every number in it was re-measured below and
the corrected ones all carry.

**Framing caveat, verified from the capture records themselves.** The held fov
differs: **1.07542 before** (focal ≈ 754 px → horizon y 583) against **1.03241
after** (focal ≈ 793 px → horizon y 590) — the AFTER frame is ~4 % tighter in
half-angle (focal +5 %), and held eye height differs 1.9652 → 2.0016 m. Under
PART 9 (b)'s ~12 % longer-focal caveat the horizon band is 583-599 before and
590-607 after. Sizes and the horizon line are therefore not identical between
the frames, and no comparison here leans on fixed-size regions: the counts are
weighted by **attribution** — the stall and the canopy row exist in both frames
at shifted positions; the lamp exists in only one.

## Close-out (DESIGN §6) — round 3f

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg (read first; frame 3 is the ground-level reference)
          shots/2026-10-22T03-11-38/20-fall-ground-level.png (BEFORE, PART 10's frame, sequence run;
            _capture.json: error null, lights 1133, starved 0, dayPhase 0.17, held fov 1.07542, y 1.9652)
          shots/2026-10-22T05-05-49-20-fall-ground-level.png (AFTER, single-shot run; the run dir is a
            bare PNG + shots/latest.json, so tools/compare.mjs cannot pair it and no grid was made — both
            frames were opened full-size and judged on my own ffmpeg crops. latest.json: error null,
            lights 1133, starved 0, dayPhase 0.163, held fov 1.03241, y 2.0016)
          git show 8608fbe (the two lamp lines; nothing else in src/)
          reviewer crops, both frames: hut+floor crop=(450:460:1150:440) at 2.5x, stall
            crop=(320:180:280:520) at 3x, water crop=(700:260:450:620) at 2x (reproducible ffmpeg)
JUDGED:   the acceptance's attribution on the frame — warm components (R>B+15 && R>60, 4-connected)
          below y 600 and in the hut region, before and after, by location, not aggregate share; what
          the source reads as (work lamp vs lit pane on a box); whether the visible floor carries the
          lamp's light; the frame as a place at night (stall, crowd, water, rubble, lifelines); whether
          the frame is the fall zone or a plaza
GAP:      a source now reads on the hut wall and the wall reads as lit (max R-B 12 -> 97 on the same
          face), but the light stops at that wall: the floor 1-6 m in front of the door face IS in frame
          (y 700-760, x 1300-1600) and carries max R-B -2 after against 0 before, mean luma 31.4 -> 26.1
          — no pool exists anywhere below the horizon. PART 10's clause one is met only nominally: all
          72 warm-bright px (14 components) and all 303 loose px (28 components) below y 600 sit at the
          stall (x 321-471) and the mid-right canopy row (x 1038-1201), both present in BEFORE at 15 px;
          the lamp's own x range (1250-1550) contributes 0 there (max R-B -4 before, 28 at y 600-619
          after, 7 at y 620-639). At 1x the source reads as a lit rectangle on a blank box, not a work
          lamp: the door under it stays black, there is no bracket or shade silhouette, the ~70 px halo
          returns to plain wall.
NEXT:     one change: put the pool inside this camera's view — bracket the head above the roof (the
          alternative PART 10 itself named) so its cone clears the hut and lands on the visible strip
          between hut and camera; re-shoot 20 and accept on a source-lit patch of ground below the
          horizon (a warm/light value break on the ground caused by the lamp), then count it. The
          water's specular stays the round after.
CONFIRMED: the defect is fixed in the frame, not only in code — the emitter is a legible warm rectangle
          (~30x20 px core at 1x, x 1410-1445, y 552-575) whose whole warm mass is ONE new component
          (3334 px, x 1393-1464, y 522-595) that BEFORE does not carry; no light flood (warm-bright
          0.511 % -> 0.508 %; loose 2.520 % -> 2.842 %, the rise being the tighter lens + crowd drift at
          the stall/canopy); lights 1133/1133, starved 0/0, no GPU/WGSL error in either run; the
          implementer record's own probe numbers verify against this census (footprint y bands
          1011/596/0/0 after vs cold before, wall max R-B -4 before); the stall's canopy, red frontage
          and crowd carry over intact as the frame's human centre and were not degraded by the change
```

## (a) The counts, by location

Method as PART 11: warm = `R > B + 15 && R > 60`, warm-bright = `R > 120 && R >
1.6*B`, 4-connected components, whole frame decoded from the PNGs. Horizon from
geometry is per frame as in the caveat.

| | BEFORE (fov 1.07542) | AFTER (fov 1.03241) |
|---|---|---|
| whole-frame warm-bright | 7,362 px (0.511 %) | 7,318 px (0.508 %) |
| whole-frame loose warm | 36,288 px (2.520 %) | 40,926 px (2.842 %) |
| rows carrying any warm pixel | 0..618 | 0..628 |
| warm-bright below y 600 | **0 px, 0 components** | 72 px, 14 components |
| loose below y 600 | 15 px, 8 components | 303 px, 28 components |
| below y 600 at the lamp stratum (x 1250-1550) | **0 px, max R-B −4** | **0 px (y 600-619 max R-B 28; y 620-639 max 7)** |
| hut wall (x 1350-1420, y 520-600) max R-B | 12 | **97** |

**BEFORE — 8 loose components below y 600, all of them the stall and the near
street's canopy row, all ≤ 4 px:** stall canopy and frontage at x 347-348 (y
600-601, 4 px), x 435-436 (y 601), x 454-456 (y 618), x 458 (y 602-603), x 512
(y 604); canopy row at x 1030 (y 601) and x 1182-1183 (y 600-602). Zero
warm-bright. Zero on the hut's wall (max R-B 12 at the face). This is PART 10's
census confirmed: every lit thing sat on the horizon; below-600 was 15 stray px
of the same two groups.

**AFTER — 28 loose components below y 600, still only those two groups,
shifted/enlarged by the tighter lens:**

- **Stall group, x 321-471** (the canopy's lower edge and the red frontage
  sign): 56 px at x 412-421, y 601-607; 37 px at x 467-471, y 600-608; 29 px at
  x 459-462, y 600-607; 21 px at x 438-440, y 600-606; 9+6 px at x 321-322, y
  602-611; 8 px at x 419-420, y 609-613. Tops reach R 218. Still a lit façade
  ~50-80 m out at the horizon line — not floor light; it dies by y 620.
- **Canopy row, x 1038-1201** (the mid-right lit group BEFORE carried as 990 px
  at x 1156-1205, y 564-588, moved ~15 px left and pierced below y 600 by the
  lens): 24 px at x 1038-1043, y 600-603; 19 px at x 1196-1201, y 600-603; 17 px
  at x 1052-1055, y 600-604; 15+15 px at x 1060-1074, y 600-608; 11 px at x
  1061-1064, y 609-612; 7 px at x 1085-1088, y 600-602.
- **Lamp stratum, x 1250-1550: no component below y 600 in either frame.** The
  lamp's contribution below the horizon is zero, measured, in both.

**In the hut region (x ≥ 1150, all rows)** BEFORE carries 369 components — old-city
windows above the horizon; the top two are the right-edge sign (1,419 px at x
1571-1599, y 510-569) and the canopy row (990 px), and nothing on the hut wall.
AFTER carries 432, and the top component is new: **3,334 px at x 1393-1464, y
522-595 — the emitter and the lit wall** (w 72; its bottom edge y 595, above
even the AFTER horizon's longest-focal bound of 607, so the lamp is entirely
at-or-above the horizon line). The only other change of note is the canopy's
growth 990 → 1,119 px from the lens. An aggregate share (the record's 0.5 %
whole-frame) alone would have hidden all of this; the locations carry it.

## (b) What the source reads as, and why there is no pool

At 1x the lamp is a small warm rectangle above-left of the black doorway with a
dim warm halo on the wall; at 2.5× it is a soft-edged cream panel with no
fixture: no bracket, no shade, no conduit, and the door under it stays black.
Against sheet B frame 3's ground-level light — lanterns and storefront glow that
**bring the ground with them**, lighting the snow between figures — the read is
the answer to a different question: it says "there is an electrical light here",
not "work happens here". It is closer to a lit window on a blank box than to the
work lamp at a village door the round was named for.

The pool is genuinely absent, not merely weak. The ground 1-6 m in front of the
door face is in this frame (y 700-760, x 1300-1600 = the floor strip between the
hut wall, ~16 m out, and the camera): max R-B −2 against 0 in BEFORE, mean luma
31.4 clean down to 26.1, unlit in both. A 2.2 m head on that door face has its
natural pool inside the frame and the frame does not carry it — which turns the
record's "the pool is behind the geometry the camera can see" into a
**hypothesis, marked as one** (DESIGN §7.6): that the light does not land on
visible floor is a frame fact; *why* it does not (range, falloff, or occlusion
against the hut's own boxes) is an unmeasured code question. The roof-bracket
alternative PART 10 named would throw from above the eave, whose ground cone
must land on this same visible strip.

## (c) The rest of the frame, which this round did not touch

- **The water band is unchanged** (2× crops are indistinguishable): the same
  value step with the same single-scale concentric ripple motif across it, no
  reflection of the lit towers behind it, no edge treatment, no specular. As
  PART 10 (b) left it, and the specular is this round's deferred clause.
- **The stall and its crowd remain the frame's best thing** and carry over
  intact — the same lit canopy, red frontage and ~a dozen silhouettes at the
  horizon, ~4 % larger from the lens, with two new unlit crowd silhouettes at
  the frame's lower-left edge (x 30-130, y 600-745; crowd drift between runs,
  not part of the change). The stall does not pool its own light either: its
  below-horizon warm is sign and canopy edge only, gone by y 620.
- **Rubble, rebar, lifelines: still nothing readable.** The wreck dome still
  reads as a smooth boulder; the crate (x 1050-1140) is still a bare silhouette
  with no contact shadow; no cable legible anywhere on the floor.
- **Plaza or fall zone: still a plaza.** Two pylons run out of the top, the hut
  is a blank box, the floor is a dark decal board, and the container piles — the
  village half of the zone's identity — are overhead and out of shot. The one
  lit panel does not change the register a stranger would name: a dark plaza at
  the foot of two pylons, with one wall-mounted light.

## (d) What this round establishes, and what it does not

- **Establishes:** the one-line defect is fixed in the frame — an emitter
  visible at 1x, one new warm component, a lit wall where BEFORE had max R-B 12
  — with light counts equal, starved 0, no flood, and no other frame content
  touched.
- **Establishes:** the implementer record's corrected numbers (with one blemish:
  its 1,607 "footprint after" warm px includes old-city window rows above y
  560 that sit in that x-range in BOTH frames — my split is 1,312 warm-bright
  before / 1,267 after above the lamp rows, flat, and only the y 560-640 wall
  rows are the lamp's).
- **Does not establish** the acceptance as met by the lamp: below the horizon
  the lamp contributes zero pixels, the 72 px are the stall and the canopy, and
  no pool exists on floor the camera can see.
- **Does not establish** the lamp as a work-lamp read, the floor as a place at
  night, or any verified read for `workshopYard` — no judged frame contains one;
  that verification is owed to a future frame.

**One next change, not three.** Bracket the head above the roof so its pool
lands on the visible strip between hut and camera; re-shoot 20; accept on a
source-lit ground patch below the horizon and count it. That single change
decides whether this frame is a working floor at night, which is what PART 10's
gate has been about all along.
# PART 13 — ROUND 3H: the lamp on a bracket above the eave (`95bb881`, run `05-56-31`, `shots/2026-10-22T05-56-31-20-fall-ground-level.png`)

**Scope.** One change judged: the work-lamp head in `winchHouse` (and `workshopYard`,
unverified) moved from the door face to a bracket post+arm above the roof slab, 0.11 m
outboard of the eave, at `GROUND_Y+3.4`; intensity and radius untouched. Baseline is the
door-face frame (`shots/2026-10-22T05-05-49-20-fall-ground-level.png`, PART 12). The
implementer's record (`docs/POSE20_LAMP_BRACKET.md`) was read for what was built; the
frames decide. A diagnostic frame exists (`shots/2026-10-22T05-58-09-...`) and is treated
as a control, not as evidence of the committed build (see (b)).

## The ground-strip numbers, measured here

Method: warm = `R > B + 15 && R > 60`, 4-connected, whole frame decoded. Floor strip =
`x 1300-1600, y 700-760` (1-6 m in front of the door, the ground the camera can see).

| | BEFORE (door face, `05-05-49`) | AFTER (bracket, `05-56-31`) |
|---|---|---|
| warm px below y 600 | 303 (28 components) | 248 (17 components) |
| warm px in the lamp stratum x 1250-1550, all rows | 9,096 | 13,445 |
| floor strip max R-B | −2 at (1465, 700) | **−4 at (1484, 716)** |
| floor strip warm px | 0 | 0 |
| floor strip mean luma | 83.4 (PART 12's rect: 26.1) | 86.6 (PART 12's rect: 30.5) |
| wall warm (x 1350-1500, y 500-700) | 3,398 px | 3,829 px |
| emitter core | x 1415-1424, y 553-559 | x 1412-1414, y 456-475 |

The lamp stratum's gain (9,096 → 13,445) is the wall, not the floor: the bracket's head is
0.5 m outboard instead of 0.02 m, so the wall sees it, and the wall lit up (3,398 → 3,829
px, mean luma 27.2 → 29.7). The floor strip gained nothing: 0 warm px in both, max R-B
−4 after against −2 before. The +3.2 luma on the strip is the lens/eye-height difference
(the other floor rect moved the other way, 40.0 → 38.2), not light.

## Close-out (DESIGN §6) — round 3h

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg (read first; frame 3 is the ground-level reference)
          shots/2026-10-22T05-05-49-20-fall-ground-level.png (BEFORE, door-face frame, single shot)
          shots/2026-10-22T05-56-31-20-fall-ground-level.png (AFTER, bracket frame, single shot)
          shots/2026-10-22T05-58-09-20-fall-ground-level.png (DIAGNOSTIC, albedo removed; a control)
          git diff HEAD -- src/shaders/lighting.wgsl (empty) ; git log --oneline -3 (no shader change)
          reviewer crops: head crop x 1380-1480 y 440-560 at 4x; floor strip x 1300-1600 y 700-760
JUDGED:   the acceptance's attribution on the frame — warm components (R>B+15 && R>60,
          4-connected) below y 600 and in the hut region, before and after, by location; what
          the source reads as (work lamp vs lit pane on a box); whether the visible floor
          carries the lamp's light; the frame as a place at night (stall, crowd, water,
          rubble, lifelines); whether the frame is the fall zone or a plaza; the cost
GAP:      the lamp still lights nothing below the horizon. The floor strip (x 1300-1600,
          y 700-760) carries 0 warm px and max R-B -4 after against -2 before; the 72 below-
          horizon warm px are the stall and the canopy, not the lamp. PART 12's acceptance
          (a source-lit patch of ground below the horizon) is not met. The bracket fixed the
          wall and the fixture; it did not fix the pool, because the pool is swallowed by the
          floor's own dark blue albedo (see (b)).
NEXT:     one change: remove the albedo multiply from the pool term (or raise the flood
          water's albedo) in src/shaders/lighting.wgsl, so a lamp can warm this floor at all.
          Re-shoot 20 and accept on a source-lit ground patch below the horizon plus a
          specular in the water. That single change decides whether this frame is a working
          floor at night.
CONFIRMED: the bracket is in the frame and reads as a fixture, not a lit rectangle on a blank
          box — the head sits at y 456-475 with a visible stem (post+arm) under it, 0.11 m
          outboard of the eave; the wall gained 431 warm px and 2.5 luma; the stall and its
          crowd carry over intact as the frame's human centre (same canopy, red frontage,
          ~a dozen silhouettes, ~4 % larger from the lens); lights 1133/1133, starved 0/0,
          no GPU/WGSL error; the diagnostic revert is verified (git diff empty, git log clean);
          the diagnostic proves the pool lands on the right strip when the albedo factor is
          removed (15,733 px component, x 1205-1599, y 721-786), and proves nothing about
          the committed build.
```

## (a) The counts, by location

**BEFORE (`05-05-49`, door face):** 28 loose components below y 600, 303 px, all of them
the two groups PART 12 named — the stall (x 321-496) and the mid-right canopy row
(x 1037-1201). Zero warm-bright below y 600. The hut wall carries max R-B 12; the lamp
stratum (x 1250-1550, y < 600) carries 9,096 warm px, all of it the wall's own lit mass
at y 522-595 (the door-face emitter).

**AFTER (`05-56-31`, bracket):** 17 loose components below y 600, 248 px — the same two
groups, shifted by the 0.12 % lens difference, not by the lamp. The hut wall now carries
a new top component of 5,210 px at x 1383-1472, y 421-521 (the bracket's cone on the
wall, 95 px higher than the door-face core) plus 2,439 px at x 1356-1485, y 523-551.
The lamp stratum gained 4,349 warm px, all of it wall. **The lamp contributes 0 warm px
below the horizon in this frame, as it did in 3f.** The component count went down
(28 → 17) because the tighter lens lifted the canopy row's lower edge out of the band —
lens and crowd drift, not the lamp.

**Floor strip (`x 1300-1600, y 700-760`):** 0 warm px in both frames; max R-B −4 after
against −2 before; mean luma 86.6 after against 83.4 before (the other floor rect moved
the other way, 40.0 → 38.2). **No pool.** The ground 1-6 m in front of the door face is
in frame and carries the same cold blue it carried before the change.

## (b) The diagnostic frame — what it proves and what it does not

The implementer's third claim was verified independently:

1. **Revert verified.** `git diff HEAD -- src/shaders/lighting.wgsl` is empty, and
   `git log --oneline -3` carries no shader change. The diagnostic frame
   (`shots/2026-10-22T05-58-09-20-fall-ground-level.png`) was taken from a build with
   the albedo factor removed from the pool term and then reverted. It is a **control**, not
   evidence of the committed build.
2. **What it proves.** With the albedo multiply gone, the pool lands where the geometry
   says it should: one warm component of 15,733 px, bbox x 1205-1599, y 721-786 — the disc
   under the head, clipped by the hut, spreading from the wall's base toward the camera.
   The bracket's cone does reach the visible strip. The pool is computed and lands correctly;
   it is invisible in the committed build because the term is multiplied by the fragment's
   albedo, and this strip is flooded-low water with albedo (0.034, 0.049, 0.062) — dark
   and blue-biased. A warm lamp times a blue-biased albedo adds a blue-biased lift (R
   +0.030·disc, B +0.022·disc); it lifts luma a few points and leaves R-B negative, which
   is exactly what the strip measures.
3. **What it does not prove.** It does not prove the committed build has a pool (it does
   not — 0 warm px on the strip). It does not prove the water's specular (PART 10's
   deferred clause, untouched). It does not prove a stronger lamp would help — raising
   intensity scales the blue-biased lift by the same factor and would brighten every frame
   already judged. And it does not prove workshopYard's read (no frame contains one).

The diagnostic is the right kind of control: it isolates one variable (the albedo multiply)
and shows the pool exists upstream of it. But it cannot stand in for the real frame, and the
real frame does not carry a pool.

## (c) What the source reads as

At 1x the lamp is a small warm rectangle above-left of the black doorway with a dim warm
halo on the wall; at 4x it is a soft-edged cream panel with a visible stem (post + arm)
under it, 0.11 m outboard of the eave and 0.34 m above the slab. That reads as a **fixture**,
not a lit rectangle on a blank box — the stem is the new information, and it is the thing
the door-face frame lacked. Against sheet B frame 3's ground-level light (lanterns and
storefront glow that bring the ground with them, lighting the snow between figures), the
read is closer to a work lamp than the door-face version was, but it still says "there is
an electrical light here" rather than "work happens here": the door under it stays black,
there is no shade or conduit, and the ~70 px halo returns to plain wall.

The fixture is plausible at building scale: a 0.1 m square post, ~0.5 m tall, on a hut
~2.7 m tall, is a lamp post, not a toy. The head keeps the existing 0.14 m emissive box,
so the fixture's scale is set by the head, not the post.

## (d) The rest of the frame

- **The stall and its crowd remain the frame's best thing and its human centre.** The same
  lit canopy, red frontage and ~a dozen silhouettes at the horizon, ~4 % larger from the
  lens, with two new unlit crowd silhouettes at the lower-left edge (x 30-130, y 600-745;
  crowd drift between runs, not part of the change). The stall does not pool its own light
  either: its below-horizon warm is sign and canopy edge only, gone by y 620.
- **The water band is unchanged** (2x crops indistinguishable): the same value step with
  the same single-scale concentric ripple motif, no reflection of the lit towers behind it,
  no edge treatment, no specular. As PART 10 (b) left it; the specular is this round's
  deferred clause.
- **Rubble, rebar, lifelines: still nothing readable.** The wreck dome still reads as a
  smooth boulder; the crate (x 1050-1140) is still a bare silhouette with no contact
  shadow; no cable legible anywhere on the floor.
- **Plaza or fall zone: still a plaza.** Two pylons run out of the top, the hut is a box
  with one lit panel, the floor is a cold blue decal board, and the container piles — the
  village half of the zone's identity — are overhead and out of shot. The bracket did not
  change the register a stranger would name.

## (e) What this round establishes, and what it does not

- **Establishes:** the bracket is in the frame and reads as a fixture; the wall gained
  431 warm px and 2.5 luma; the emitter moved 95 px higher (y 553-559 → y 456-475); the
  fixture is plausible at building scale.
- **Establishes:** the diagnostic is a clean control — revert verified, pool lands on the
  right strip when the albedo factor is removed, and the committed build does not carry it.
- **Establishes:** the stall, crowd, water, rubble and city-wide read are untouched; no
  leak, no flood beyond the wall, no GPU/WGSL error; lights 1133/1133, starved 0/0.
- **Does not establish** the acceptance as met: 0 warm px on the floor strip, max R-B −4,
  no source-lit patch below the horizon.
- **Does not establish** the water's specular (PART 10's deferred clause), workshopYard's
  read (no frame contains one), or the floor as a place at night.
- **Does not re-judge** rounds 3a-3g, pose 20's role beyond the above, or the ground pass.

**One next change, not three.** Remove the albedo multiply from the pool term (or raise
the flood water's albedo) in `src/shaders/lighting.wgsl`, so a lamp can warm this floor
at all. Re-shoot 20 and accept on a source-lit ground patch below the horizon plus a
specular in the water. That single change decides whether this frame is a working floor
at night, which is what PART 10's gate has been about all along. The bracket's position
is settled; do not move it again.

---

# PART 14 — ROUND 3G: the row on both long faces of each box (`db33795`, run `06-07-15`, `shots/2026-10-22T06-07-15`)

**Scope.** One change judged: `dressFaces` in `src/render/fallvillage.ts` now draws the lit
row and the face dressing on **both** long faces of each box instead of on the outward face
only (PART 11 NEXT). Baseline is round 3e (`shots/2026-10-22T03-26-25`, PART 11's frame);
the pose, seed, hour and rig are unchanged. The implementer's record
(`docs/FALL_LITROWS_ROUND3G.md`) was read for what was built; the frames decide. The
acceptance is a **count** at pose 18 on PART 11's six columns, at the positions where the
rows are actually drawn (not the probe's projection — PART 9 (b) measured that map ~12 % too
close to frame centre), **and** pose 19 recovering the 4-block band it lost in 3e.

## The count (pose 18, six nearest fall crowns, drawn positions)

Method: warm = `R > B + 15 && R > 60`, 4-connected components, counted in a box round the row
the frame actually carries; the "visible blocks" column is by eye, as in PART 11 (a mark
counts when it is at least 2 px wide and 3 px tall; a 1-px sliver does not). The 3e column is
PART 11's own table, re-measured here to the same definition.

| column | dist | 3c blocks | 3e blocks (PART 11) | 3e components | 3g components | **3g visible blocks** | 3g drawn where (x, y) |
|---|---|---|---|---|---|---|---|
| id109 | 193 m | 5 | 3 | 4 (28, 14, 14, 8) | 6 (19, 25, 20, 2, 11, 13) | **4** | 134-138, 142-147, 160-165, 169-175, y 387-396 |
| id89 | 228 m | 2-3 | 1 | 1 (62) | 3 (28, 28, 5) | **2** | 620-625, 627-632, y 377-383 |
| id76 | 198 m | 0 | 2 | 2 (24, 24) | 2 (41, 25) | **2** | 758-765, 768-772, y 658-667 |
| id124 | 225 m | 0 | 1 | 2 (20, 4) | 2 (23, 8) | **1** (+ a 2-px bay) | 112-113, 116-122, y 444-447 |
| id123 | 262 m | 0 | 2 | 2 (33, 32) | 1 (76) | **2** | 271-288, y 502-507 |
| id108 | 264 m | 1 | 1 | 1 (5) | 1 (5) | **1** | 510-511, y 479-481 |

**4 of 6 carry 2+ visible blocks** (id109 4, id89 2, id76 2, id123 2); id124 reads as one lit
window and a 2-px bay, id108 as one 2x3 mark. **5 of 6 if a 2-px bay is counted as a block**
— see (a) for why this reviewer did not count it. The acceptance asks for 5 of 6. **It is
not met.** Pose 19's band **is** recovered (b).

## Close-out (DESIGN §6) — round 3g

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg (read first; frame 2 is the crown reference)
          shots/compare/2026-10-22T06-29-35.png (+ .txt)   BASELINE | CURRENT | REFERENCE
            baseline: shots/2026-10-22T03-26-25 (round 3e)
            current:  shots/2026-10-22T06-07-15 (round 3g, shot after db33795)
            reference column: references/sections/B-cold-industrial/
          full-size: shots/2026-10-22T06-07-15/{16,17,18,19,20}.png and
                     shots/2026-10-22T03-26-25/{16,17,18,19,20}.png
          reviewer crops: the six crowns at 8x-32x, both runs (id109 12x, id89 8x, id76 24x,
            id124 16x, id123 24x, id108 8x); pose 19's band at 12x/32x against round 3c; the
            box end face at 10x; pixel grids over id124's row (both runs)
          shots/2026-10-22T06-07-15/_capture.json (5 shots, error null, lights 1405/1133,
            starved 0, lodHistogram [9,34,124,0])
          npx vite-node@6.0.0 src/render/__probe_litrow.ts (cost: 1078 lit quads at lod 0,
            2872 at lod 2, 93,192 bay-free triangles)
JUDGED:   the acceptance as a count at 18's six nearest crowns, at drawn positions (not the
          probe's); whether the row reads as a row and not a bar; pose 19's recovered band;
          whether a row now appears on faces that point into the pile; the cost against D32
          from the run's own stats; 16 and 17 as controls; warm/dark against sheet B frame 2;
          the city-wide check
GAP:      acceptance not met — 4 of 6 crowns carry 2+ visible blocks (5 if id124's 2-px bay
          counts). id124 still reads as one lit window and a speck, and id108 is unchanged at
          one 2x3 mark: the both-faces rule reached neither. The rule also puts new lit
          geometry on inward-facing faces (pose 19's box end grew 1227 -> 2130 warm px), which
          reads as a lit panel but is light where 3e had a dark end.
NEXT:     one change: the PICK — choose which box of a crown carries the row by line of sight
          (the way 3e chose the face by line of sight), so each of the six crowns presents a
          box the camera can read instead of a flank it sees edge-on. Re-shoot 18, count the
          same six columns against the table above; id124 and id108 are the two that must
          move to 2+.
CONFIRMED: id89's 62-px merged band is now two separate 28-px blocks with a visible gap —
          the 3e regression is undone, and 19's lost band is back at x 1233-1243, y 644-649;
          id109 gained a fifth lit pane (20 px) on a second box of the crown, 4 blocks now;
          no flood (warm 1.339 % -> 1.334 %, warm-bright 0.239 % -> 0.233 % at 18); no light
          change (1405/1405 and 1133/1133, starved 0/0); no GPU/WGSL error in any of the 5
          shots; the LOD 2 merged path is unchanged (2872 quads / 7,842 m2); the in-frame
          cost at 18 is +11,068 triangles of 4.9 M (+0.23 %) and +0.94 ms of 131.79 ms
          (+0.7 %); 16 and 17 carry no new warm pixels (0.111 % -> 0.115 %, 0.290 % -> 0.274 %)
          and the city-wide read is unchanged — 18 still reads as two places.
```

## (a) The counts, at the six columns, where the rows are actually drawn

**id109 (193 m) — the round's clear gain: 3 → 4 blocks.** 3e carried four warm components
(8, 14, 28, 14 px) which read as three windows: a two-pane one at x 136-140, a bar at
x 145-150, and a mark at x 171-173. The current frame carries six components (19, 25, 20, 2,
11, 13 px): the same two-pane window at x 134-138 and x 142-147, the bar at x 160-165, and a
two-pane window at x 169-175. The 20-px pane at x 160-165 is new geometry — 3e has nothing
there — and it sits at the row's height on the crown's own silhouette. The crown now carries
two rows (one on each of two boxes), four windows in all.

**id89 (228 m) — the 3e regression is undone: 1 → 2 blocks.** 3e's 62-px band with a notch
splits in the current frame into two 28-px components (x 620-625, x 627-632) with a visible
one-pixel gap between them; at 8x they are two separate bright squares, not one band with a
notch. This is the case PART 11 named — "the second bay did not disappear from the frame
because it was hidden, it disappeared because the row left that face" — and the row is now
back on a face the camera meets.

**id76 (198 m) and id123 (262 m) — unchanged at 2 blocks each.** id76's row is the same two
panes (the first grew from 24 to 41 px as a neighbouring pane merged into it); id123's two
panes merged at the threshold into one 76-px component, but the mullion between them is
visible at 24x (a dark line at x ~279), so it still reads as two.

**id124 (225 m) — unchanged at one block, and the second bay is the same 1-2 px sliver.**
3e's row was a 20-px bar at x 119-124 plus a 1-px warm mark at x 115; the current frame's is
a 23-px bar at x 116-122 plus a 2-px cream mark at x 112-113. Every feature has moved 2-3 px
to the left, and the held lens moved 0.3 % (1.04772 → 1.04451), which is worth 2.1 px at
this crown's distance and its position left of centre. The mark's colour also changed with
the sampling (3e's is R 158 / G 127 / B 79, the current's R 164-179 / G 156-164 / B 113-128).
So the second bay is the same ~1.5-px geometry seen at a different phase, not a new bay, and
this reviewer does not count it: on a reading where a 2-px bay does count, the crown total is
5 of 6 and the acceptance is met. The count that carries a verdict should not rest on a
one-pixel sampling difference, and PART 11's own standard on this very crown refused the
1-px sliver.

**id108 (264 m) — unchanged at one 2x3 mark.** As PART 11 said, this is a stack whose
selection lands on flanks the camera sees edge-on; a face rule cannot reach it, and the
both-faces rule did not. The implementer's own probe agrees independently: it reports id108
as the one column with no 2-3 pane run.

## (b) Pose 19 — the band is back

3e's near control had lost 3c's band: at x 1234-1245, y 644-650 the 3e frame carries
nothing, and the nearest surviving warm mass was 180 px at x 1215-1229, y 657-670, a
different thing. The current frame carries the band again, in the same place: 26 px at
x 1233-1237, y 644-649 and 20 px at x 1239-1243, y 644-649. Round 3c's frame (the run that
had it) carries 68 px as one component at x 1234-1245; the difference is that 3c's threshold
bridged the mullion and 3g's does not — at 32x both read as the same two cream panes with a
dark mullion between them, in the same place on the same box. The other two masses on that
structure carry over untouched (175 px at x 1196-1211 and 192 px at x 1212-1228, against
3e's 177 px and 180 px, the lens's 2-px shift). Pose 19's warm share rises 2.011 % → 2.058 %.

**The acceptance's second clause is met.**

## (c) Does a row now appear on faces that point into the pile?

**Yes, there is new lit geometry on inward-facing faces, and it is visible where the stack
is stepped or the box is turned. It does not read as light inside a stack.** The clearest
case is pose 19's black box, 3 m from the camera: its long face carries the same five-panel
row in both runs (1475/1482, 997/992, 1253/1237, 1476/1468, 2133/2110 px — unchanged), but
the box's **end** now carries 2130 px of warm area at x 848-896, y 431-487 against 3e's
1227 px at x 848-876. At 10x the extra area reads as a second lit quad on the end, seen
around the box's corner — the second long face's dressing, which the old rule deliberately
left dark. It is a lit panel on the outside of a box, not a glow from between two boxes.

At pose 18 nothing comparable was found: every new mark (id109's 20-px pane, id89's second
28-px block, id76's widened first pane) sits at the row's height on a face the camera
meets, and no lit row appears recessed in a crevice or inside a stack in the crowns
examined. The inward faces of a pile are, in this zone, mostly invisible — the piles are
dense and the rows are drawn where the camera can reach them.

## (d) The cost, against D32's floor

D32 sets 30 fps (33.3 ms) as the floor on the R14 platform and asks that the number be
recorded with every change that adds geometry. The run's own stats are the record here
(same harness, same conditions, 5 shots, error null in all):

| | 18 (baseline → current) | 19 | 16 (control) | 17 (control) |
|---|---|---|---|---|
| frameMs | 131.79 → **132.73** (+0.94, +0.7 %) | 139.32 → 133.85 (−5.5) | 133.43 → 134.42 | 138.12 → 138.77 |
| triangles | 4,891,477 → 4,902,545 (**+11,068, +0.23 %**) | +5,510 | +12,858 | +20,296 |
| g-buffer triangles | 1,291,864 → 1,295,018 (+3,154, +0.24 %) | +1,838 | +3,288 | +3,176 |
| shadow triangles | 2,995,412 → 3,003,326 (+7,914, +0.26 %) | +6,976 | +9,098 | +18,064 |
| lights | 1405, starved 0 → 1405, starved 0 | 1133 → 1133 | 1222 → 1222 | 1133 → 1133 |
| held fov | 1.04772 → 1.04451 (−0.3 %) | 1.06954 → 1.07304 | 1.01106 → 1.0093 | 1.07006 → 1.07079 |

**The in-frame cost is negligible: +0.23 % of the frame's triangles and +0.7 % of its frame
time at 18, with the light count unchanged.** The zone-wide cost is not negligible and the
implementer says so: lit bays 542 → 1078 (+98.9 %), the LOD 0 village 98,628 → 108,284
triangles (+9.8 %), bay-free triangles 90,564 → 93,192. This reviewer's own probe run
confirms the probe's numbers (1078 lit quads at lod 0, 2872 at lod 2, 93,192 bay-free
triangles) and the LOD 2 merged pass is unchanged at 2,872 quads / 7,842 m².

Two honest caveats. First, the harness's absolute frame time (7.5 fps) is a headless
artefact, not a D32 measurement: both runs sit at the same 7.5 fps and the platform number
(52.03/s base vs 52.09/s head in the 3e round's measurement) comes from a headed run, so
what this harness can test is the *relative* cost, and it is +0.7 % at 18 for +0.23 %
triangles. Second, the +3.2k g-buffer triangles in 16 and 17 are the rule's geometry, not
new light: the rule dresses both faces everywhere the village is in frame, lit or not, so
the triangle count rises in the controls even though no new warm pixel appears in them.

## (e) 16 and 17 as controls

**Neither leaks a lit pixel.** 16: warm 0.111 % → 0.115 %, the same composition, no fall
crown in frame and none lit. 17: warm 0.290 % → 0.274 %, same composition, and the crowns it
does show carry no new row — 3e's note that 17's dressed faces are not turned toward the
camera still holds after the rule, which is the useful result: the rule does not light faces
the camera cannot see.

## (f) Warm/dark against sheet B frame 2, and the city-wide check

**The value structure has not moved, and nothing has flooded.** At 18 the whole-frame mean
RGB is (18.2, 33.9, 78.7) before and (18.2, 33.9, 78.8) after — PART 11's reading, to the
digit. The warm share (R > B + 15 && R > 60) is 1.339 % → 1.334 %; warm-bright
(R > 120 && R > 1.6 B) is 0.239 % → 0.233 %. The implementer's record prints "0.2 %
(baseline 1.34 %)": those are two different definitions of warm (the 0.2 % is warm-bright,
the 1.34 % is the loose share), so that line compares two measures. Measured on the same two
frames with one definition each, the change is flat in both, which is the no-flood result
either way.

Against sheet B frame 2 — a leaning stack carrying eight to ten lit blocks at several
heights on one column — the zone's crowns now carry 2-4 on five of the six nearest, and one
on id108. The warm/dark balance is closer than it was, because the crowns have more lit
pane in them, but the gap to the reference is unchanged in kind: the zone's own warm
inventory is still sparse and the old city behind still carries most of the frame's warmth.

**The city-wide check passes.** Pose 18 still reads as two places: the fall crowns as dark,
sparsely-lit stacks in front of a wall of old-city window grids. The added rows are a few
pixels each on five crowns; the zone does not look like the rest of the city and 3g did not
homogenise it.

## What this round establishes, and what it does not

- **Establishes:** the both-faces rule does what PART 11 asked — id89's merged band is two
  blocks again, id109 gains a pane, and pose 19's lost band is back in the same place.
- **Establishes:** a camera-independent face pick was not the only thing missing. Lighting
  both faces fixes the crowns the camera already meets, and leaves untouched the two it
  does not: id124's second bay is a 1-2 px sliver at 225 m and id108 is a stack seen
  edge-on. **Both need the pick, not a face rule.**
- **Establishes:** the cost of the rule is +98.9 % lit bays and +9.8 % of the zone's LOD 0
  village triangles, and +0.23 % of the frame's triangles at 18 — a zone-wide cost, a
  near-free in-frame cost, and no light-count change.
- **Establishes:** 16 and 17 carry no new lit pixel; the value structure at 18 has not moved;
  the city-wide read is unchanged.
- **Does not establish** the acceptance as met: 4 of 6 crowns carry 2+ visible blocks
  (5 if id124's 2-px bay is counted).
- **Does not establish** that the inward faces are safe everywhere: one measurable case of
  new light on an end face was found at 19 and it reads acceptably, but the rule does put
  rows where the old rule did not, and no frame contains a pile seen from inside a gap.
- **Does not re-judge** rounds 3a-3f, pose 20's lamp and floor (PART 13's NEXT stands: the
  pool term's albedo multiply in `src/shaders/lighting.wgsl`), or the ground pass.

**One next change, not three.** The **pick**: choose which box of a crown carries the row by
line of sight — the same lever 3e used for the face, applied to the box. A crown whose
selection lands on a flank the camera sees edge-on (id108) or on a small box turned away
(id124) then presents a box the camera can read, and both crowns gain their second block.
Re-shoot 18 and count the same six columns against the table above; id124 and id108 are the
two that must move to 2+. The pick is the one lever this round did not touch, and the only
one that can finish the lit-row work: the both-faces rule has already taken every crown the
camera can see.
# PART 15 — ROUND 3I: the pick (which box carries the row) (`47b5c6d`, run `06-57-22`, `shots/2026-10-22T06-57-22`)

**Scope.** One change judged: `dressFaces` in `src/render/fallvillage.ts` now leads the
selection with outwardness (radial line of sight) instead of height and the `|a|`
tie-break, so the box that carries the row is chosen by line of sight (PART 14 NEXT).
Baseline is round 3g (`shots/2026-10-22T06-07-15`, PART 14's frame); pose, seed, hour and
rig unchanged. The implementer's record (`docs/FALL_LITROWS_ROUND3I.md`) was read for what
was built; the frames decide. The acceptance is a **count** at pose 18 on PART 14's six
columns, at the positions where the rows are actually drawn (not the probe's projection —
PART 9 (b) measured that map ~12 % too close to frame centre), with a mark counting as a
visible block only when it is at least 2 px wide and 3 px tall (a 1-px sliver does not).

## The count (pose 18, six nearest fall crowns, drawn positions)

Method: warm = `R > B + 15 && R > 60`, 4-connected components, counted in a box round the
row the frame actually carries; the "visible blocks" column is by the definition above. The
3g column is PART 14's own table, re-measured here to the same definition.

| column | dist | 3g components | 3g visible blocks | 3i components | 3i visible blocks | 3i drawn where (x, y) |
|---|---|---|---|---|---|---|
| id109 | 193 m | 6 (25, 20, 19, 13, 11, 2) | 5 | 7 (25, 19, 14, 11, 11, 10, 3) | **6** | 134-139, 142-147, 148-153, 158-163, 169-174, y 387-396 |
| id89 | 228 m | 2 (28, 28) | 2 | 2 (24, 24) | **2** | 619-624, 626-631, y 377-383 |
| id76 | 198 m | 3 (41, 25, 2) | 2 | 3 (27, 25, 2) | **2** | 758-763, 768-772, y 658-667 |
| id124 | 225 m | 2 (23, 8) | 2 | 2 (20, 6) | **2** | 112-113, 116-122, y 444-447 |
| id123 | 262 m | 1 (76) | 1 | 2 (39, 37) | **2** | 270-278, 280-288, y 502-507 |
| id108 | 264 m | 1 (5) | 1 | 1 (5) | **1** | 510-511, y 479-481 |

**5 of 6 crowns carry 2+ visible blocks** (id109 6, id89 2, id76 2, id124 2, id123 2);
id108 carries one 2x3 mark. The **overall acceptance (5 of 6) is met.** The done-when PART 14
set — id124 and id108 both move to 2+ — is **half met**: id124 was already 2 in 3g (the
pick did not move it; the probe confirms identical clear-pane runs, 2+1), and id108 is
unchanged at 1. The pick moved id109 (5 → 6 visible blocks) and id123 (1 merged component →
2), and did not move id124 or id108.

## Close-out (DESIGN §6) — round 3i

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg (read first; frame 2 is the crown reference)
          shots/compare/2026-10-22T07-06-47.png (+ .txt)   BASELINE | CURRENT | REFERENCE
            baseline: shots/2026-10-22T06-07-15 (round 3g)
            current:  shots/2026-10-22T06-57-22 (round 3i, shot after 47b5c6d)
            reference column: references/sections/B-cold-industrial/
          full-size: shots/2026-10-22T06-57-22/{16,17,18,19,20}.png and
                     shots/2026-10-22T06-07-15/{16,17,18,19,20}.png
          reviewer crops: the six crowns at 8x-32x, both runs (id109, id89, id76, id124,
            id123, id108); pose 19's band at 12x/32x; pixel grids over id124's and id108's
            rows (both runs)
          shots/2026-10-22T06-57-22/_capture.json (5 shots, error null, lights 1405/1405,
            starved 0/0, lodHistogram [9,34,124,0], residentChunks 167/167)
          npx vite-node@6.0.0 src/render/__probe_litrow.ts (identical before and after:
            1078 lit quads at lod 0, 2872 at lod 2, 93,192 bay-free triangles; id124 2+1,
            id108 1+1)
JUDGED:   the acceptance as a count at 18's six nearest crowns, at drawn positions (not the
          probe's); whether the row reads as a row and not a bar; pose 19's band; whether
          the pick moved id124 and id108; the cost against D32 from the run's own stats;
          16 and 17 as controls; warm/dark against sheet B frame 2; the city-wide check
GAP:      acceptance not met for the done-when — id108 is unchanged at one 2x3 mark. The
          pick (the lever PART 14 named) is arithmetically incapable of moving it: id108's
          stack has two candidate boxes and both are already dressed (want = 2), so
          reordering them changes which runs are counted but not how many, and it has only
          2 clear panes (1+1) at this distance, each ~1 px wide — no ordering produces a
          second visible block. id124's second bay is a 2x4 mark that already counted in 3g;
          the pick did not move it either (probe: identical 2+1 runs). The count acceptance
          (5 of 6) is met, but the crown PART 14 specifically required to move did not.
NEXT:     one change: raise the row's bay-width cap from 2.4 m to about 4 m, so a single
          clear pane at 264 m projects to at least 2 px (at ~2.5 px per pane, id108's two
          clear panes become two visible blocks instead of two 1-px marks). Re-shoot 18 and
          count id108 against the table above; id108 is the one that must move to 2+.
          This is the one lever left that is arithmetically capable of moving a stack seen
          edge-on, and it is not another reordering of the same candidates.
CONFIRMED: the pick did what a face rule could not for the crowns the camera meets — id109
          gained a sixth visible pane (5 -> 6), id123's merged 76-px band split into two
          39/37-px blocks with a visible mullion; id89 and id76 hold at 2; no flood (warm
          1.334 % -> 1.324 %, warm-bright 0.233 % -> 0.231 % at 18); no light change
          (1405/1405, starved 0/0); no GPU/WGSL error in any of the 5 shots; the LOD 2
          merged path is unchanged (2872 quads / 7,842 m2); 16 and 17 carry no new lit
          pixel (0.115 % -> 0.117 %, 0.274 % -> 0.278 %); pose 19's band is present in
          both runs (46 -> 48 warm px at x 1230-1245, y 643-652); the city-wide read is
          unchanged — 18 still reads as two places.
```

## (a) The counts, at the six columns, where the rows are actually drawn

**id109 (193 m) — the round's gain: 5 → 6 visible blocks.** 3g carried six warm
components (25, 20, 19, 13, 11, 2 px) reading as five windows (the 2-px mark does not
qualify); 3i carries seven (25, 19, 14, 11, 11, 10, 3 px) reading as six, the extra
being a 10-px two-pane window at x 148-153 and a 3-px mark that does not qualify. The
crown now carries two rows on two different boxes, six windows in all — the pick found a
box the both-faces rule had not lit. This is the change working where the camera can see.

**id89 (228 m) and id76 (198 m) — unchanged at 2 blocks each.** id89's two 28-px blocks
are 24 px each now (the tighter lens and the pick's reordering of an already-dressed pair
shifted the sampling 2-3 px); id76's first pane narrowed from 41 to 27 px as a neighbour
stopped merging into it, but both crowns still carry two windows. Neither moved because of
the pick; both were already passing.

**id124 (225 m) — unchanged at 2, and the pick did not move it.** 3g's row was a 23-px
bar at x 116-122 plus an 8-px (2x4) mark at x 112-113; 3i's is a 20-px bar at x 116-122
plus a 6-px (2x4) mark at x 112-113. Every feature shifted 2-3 px left and the mark
shrank 2 px, which is the held lens moving 0.08 % (1.04451 → 1.04527, worth 2.1 px at
this crown's distance and its left-of-centre position) plus a sampling phase change (the
mark's colour moved from R 164-179/G 156-164/B 113-128 in 3g to R 168-176/G 150-157/
B 108-115 in 3i). The mark still qualifies (2 px wide, 4 px tall, against the 2x3 floor).
The implementer's probe independently confirms the pick did nothing here: id124's
clear-pane runs are identical before and after (2+1). The crown was already at 2 and
stayed at 2; the pick's target was id108, not id124.

**id123 (262 m) — the round's other gain: 1 → 2 visible blocks.** 3g's 76-px component
was one warm mass with a visible mullion at 24x; 3i splits it into two 39/37-px blocks
(x 270-278, x 280-288) with a dark gap between them. The split is the pick working: a
second box of the crown now carries a row on a face the camera meets, and the mullion that
was a threshold bridge in 3g is a real gap in 3i. This is the change that takes the
acceptance from 4 to 5 of 6.

**id108 (264 m) — unchanged at one 2x3 mark.** The pick did not move it, and it could not:
the stack has two candidate boxes and both are already dressed (want = 2), so reordering
them changes which runs the probe counts but not how many, and it has only 2 clear panes
(1+1) at this distance, each about 1 px wide. No ordering of candidates that already
exist can produce a second visible block, because a 1-px mark does not meet the 2-px
width floor. This is the arithmetically incapable case PART 14's NEXT was supposed to
avoid, and the pick is the lever that hit it.

## (b) The triangle-count claim, reconciled

The implementer's record says "selection only, no new geometry" and also reports the run
at 18 as 4,800,595 triangles against 3g's 4,902,545 — a drop of 101,950 in the shadow
pass, with g-buffer triangles unchanged to within 8. Both cannot be a cost of the change,
and they are not: the cascade splitter's per-cascade draws are **not recorded** in either
`_capture.json` (the `draws` array is empty in both, and the files carry only
`entity.triangles` and `entity.drawCalls`). What is recorded is identical in both runs:
`entity.triangles` 604,188, `entity.drawCalls` 4, `lodHistogram` [9, 34, 124, 0],
`residentChunks` 167, lights 1405, starved 0, camera fov 1.04451 vs 1.04527 (0.08 %
difference, 2.1 px at this distance). There is no geometry change, no LOD change, no
resident-set change and no light change between the runs. The reported shadow-triangle
difference is therefore a **harness/measurement artefact** (frustum or tile-binning
variation between two runs of the same scene), not a cost of the change. The change is
selection-only with zero geometry cost: lit bays 1078 → 1078, bay-free triangles 93,192 →
93,192, LOD 0 village triangles unchanged, g-buffer entity count identical. The probe
confirms the same (1078 lit quads, 2872 at lod 2, 93,192 bay-free triangles, before and
after). The implementer's own "selection only" line is the true one; the triangle number
is the artefact.

## (c) Pose 19 — the band is back and holds

3g's near control carried the band at x 1233-1243, y 644-649 (26 + 20 px); 3i carries
it in the same place (46 → 48 warm px at x 1230-1245, y 643-652). The other two masses
on that structure carry over (175/177 px and 192/180 px, the lens's 2-px shift). Pose 19's
warm share is 2.058 % → 2.061 %, flat. **The acceptance's second clause holds.** The
end face that 3g lit (1227 → 2130 warm px) is unchanged in 3i; nothing new appears on
inward faces in this frame beyond what 3g already put there.

## (d) 16 and 17 as controls

**Neither leaks a lit pixel.** 16: warm 0.115 % → 0.117 %, warm-bright 0.016 % in both,
the same composition, no fall crown in frame and none lit. 17: warm 0.274 % → 0.278 %,
warm-bright 0.001 % in both, same composition, no new row on any crown it shows. The
selection change touches no geometry, and the controls confirm it touches no lit pixel
either.

## (e) Warm/dark against sheet B frame 2, and the city-wide check

**The value structure has not moved, and nothing has flooded.** At 18 the whole-frame mean
RGB is (18.2, 33.9, 78.8) before and (18.2, 33.9, 78.7) after — PART 14's reading, to
the digit. The loose warm share is 1.334 % → 1.324 %; warm-bright 0.233 % → 0.231 %.
The implementer's record prints "warm-bright 0.2 % (baseline 1.34 %)": those are two
different definitions of warm, as in PART 14. Measured on the same two frames with one
definition each, the change is flat in both, which is the no-flood result either way.

Against sheet B frame 2 — a leaning stack carrying eight to ten lit blocks at several
heights on one column — five of the six nearest crowns now carry 2-6 blocks, and id108
carries one 2x3 mark. The warm/dark balance is closer than it was, because id123's
second block added ~37 warm pixels, but the gap to the reference is unchanged in kind:
the zone's own warm inventory is still sparse and the old city behind still carries most
of the frame's warmth.

**The city-wide check passes.** Pose 18 still reads as two places: the fall crowns as
dark, sparsely-lit stacks in front of a wall of old-city window grids. The pick added
one block to id109 and split id123's band, both at the row's height on faces the camera
meets; the zone does not look like the rest of the city and 3i did not homogenise it.

## What this round establishes, and what it does not

- **Establishes:** the pick does what a face rule cannot for the crowns the camera meets:
  id109 gains a sixth visible pane (5 → 6) and id123's merged band splits into two blocks
  (1 → 2), taking the count from 4 to 5 of 6.
- **Establishes:** the pick is arithmetically incapable of moving id108, and did not move
  id124. id108 has two candidate boxes, both already dressed, and only 2 clear panes
  (1+1) at ~1 px each; no ordering produces a second visible block. id124's clear-pane
  runs are identical before and after (2+1) and its row is the same 2x4 mark it was in
  3g. Both need a lever that changes the geometry, not the order.
- **Establishes:** the change is selection-only with zero geometry cost — identical
  entity.triangles, lodHistogram, residentChunks, lights and starved count; the reported
  shadow-triangle drop is a harness artefact, not a cost.
- **Establishes:** 16 and 17 carry no new lit pixel; the value structure at 18 has not
  moved; the city-wide read is unchanged; pose 19's band holds.
- **Does not establish** the done-when as met: id108 is unchanged at one 2x3 mark, and
  id124 did not move because of the pick.
- **Does not establish** that the inward faces are safe everywhere: 3g's single case of
  new light on an end face at 19 is unchanged, and no frame contains a pile seen from
  inside a gap.
- **Does not re-judge** rounds 3a-3h, pose 20's lamp and floor (PART 13's NEXT stands:
  the pool term's albedo multiply in `src/shaders/lighting.wgsl`), or the ground pass.

**One next change, not three.** **Raise the row's bay-width cap from 2.4 m to about 4 m**, so
a single clear pane at 264 m projects to at least 2 px (about 2.5 px per pane, which turns
id108's two clear panes into two visible blocks instead of two 1-px marks). Re-shoot 18 and
count id108 against the table above; id108 is the one that must move to 2+. This is the
one lever left that is arithmetically capable of moving a stack seen edge-on, and it is not
another reordering of the same candidates. It also makes id124's second bay a real block
rather than a 2x4 mark. The pick has taken every crown the camera can see; the width is
what is left.
# PART 16 — ROUND 3K: the gate on the bay-width cap (no capture; record at `3d521d8`)

**Scope.** Round 3k was PART 15's named change: raise the lit row's bay-width cap from
2.4 m to about 4 m (scoped to boxes with `u.long > 8`) so id108's clear panes at 264 m
project to at least 2 px. The implementer applied it, ran the probe both ways, found id108
still `1+1`, found id76 and id124 coarsened and lit quads down 1088 → 1048 while lit m²
rose, **reverted the code, and took no capture**. Commit `3d521d8` carries the record only.
This part re-derives every one of those claims in a throwaway worktree and decides the
gate, then makes the decision the lit-row thread has been building toward.

## Re-derived probe evidence

HEAD's probe (`npx vite-node@6.0.0 src/render/__probe_litrow.ts`), run here:

```
lod 0 village: 1088 lit quads, 2598 m2 lit area, 17.20 m2 per column
id 109  193m  lod0  panes 44  runs 12+8+8+6+4+4+2  clear 4+2+2+2+1   ACCEPT(2+2+2)
id  76  198m  lod0  panes 12  runs 4+4+2+2           clear 2+2         ACCEPT(2+2)
id 124  225m  lod0  panes  8  runs 4+4               clear 2+1         ACCEPT(2)
id  89  228m  lod0  panes 24  runs 10+4+4+2+2+2      clear 2+2         ACCEPT(2+2)
id 123  262m  lod0  panes  8  runs 4+4               clear 2+2         ACCEPT(2+2)
id 108  264m  lod0  panes  8  runs 2+2+1+1+1+1       clear 1+1         no 2-3
```

The same edit applied independently in a throwaway worktree (`git worktree add -d /tmp/wt-3k
HEAD`, symlinked `node_modules`, `bayW` line changed to `clamp(u.long * 0.4, 1.1, u.long > 8 ?
4.0 : 2.4)`, working tree untouched) and the probe re-run there:

```
lod 0 village: 1048 lit quads, 2809 m2 lit area, 18.60 m2 per column
id 109  193m  lod0  panes 44  runs 12+8+8+6+4+4+2  clear 4+2+2+2+1   ACCEPT(2+2+2)   (unchanged)
id  76  198m  lod0  panes 12  runs 4+2+2+2+2         clear 2+1+1       ACCEPT(2)        (coarsened: 2+2 -> 2+1+1)
id 124  225m  lod0  panes  8  runs 4+2+2             clear 2+1+1       ACCEPT(2)        (coarsened: 2+1 -> 2+1+1)
id  89  228m  lod0  panes 24  runs 10+4+4+2+2+2      clear 2+2         ACCEPT(2+2)      (unchanged)
id 123  262m  lod0  panes  8  runs 4+4               clear 2+2         ACCEPT(2+2)      (unchanged)
id 108  264m  lod0  panes  8  runs 2+2+1+1+1+1       clear 1+1         no 2-3           (unchanged)
```

All three of the implementer's claims are confirmed:

- **(a) id108 unchanged** — `1+1` in both runs, no 2-3. The cap raise is scoped to
  `u.long > 8`, and id108 is a stack whose boxes are not long enough to be affected; even
  if they were, its two clear panes are each ~1 px at 264 m and widening the bay does not
  add a clear pane, it only widens the ones that exist.
- **(b) id76 and id124 coarsened** — `2+2 -> 2+1+1` and `2+1 -> 2+1+1`. Wider bays
  reduce the number of bays that fit in a run, so a second pane that used to be a 2-px
  mark becomes a 1-px mark and stops qualifying.
- **(c) lit quads fell while lit m² rose** — 1088 → 1048 (−40) while 2598 → 2809 m²
  (+211). Fewer, wider bays: the same lit area spread over larger panels. The trade is
  real and net negative for the count.

The worktree was removed; the working tree is clean and untouched.

## The gate finding

**"No capture" was the right call, and the gate was applied correctly.** The reason is not
that the probe is authoritative — it is not, and PART 9 (b) measured its screen map ~12 %
too close to frame centre. The reason is that this change is a **bay-width change, not a
position change**: it does not move any component on the frame, it only changes how many
panes fit in a run and how wide each is. The probe shows id108's clear count unchanged
(1+1) and its clear box identical (x 543-544, y 475-476); the frame's id108 mark in 3i
was at x 510-511, y 479-481, one 2x3 component, and nothing in this change can turn a
1-px mark into a 2-px mark at 264 m because the pane itself is still ~1 px wide. A capture
would have shown the same 1 block, plus the coarsening of id76 and id124 that the probe
already caught. Shooting it would have spent a 9-minute sequence to confirm a probe result
that the change's own arithmetic predicts. The gate (PART 9, rule 4) asks whether the
diagnostic is looking at its subject; here the subject is the probe's clear-pane count, and
the change cannot alter it. No capture was correct.

The one caveat, stated plainly: the probe's absolute screen positions are not the frame's
(PART 9 (b)), so the *locations* in the probe table are not where the rows are drawn. But
this round's question was never "where", it was "how many", and "how many" for a width
change is determined by `fits` and `bayW`, which the probe computes exactly. The locations
did not move in the probe, and the frame's 3i locations did not move between runs. The
gate holds.

## The decision: close the lit-row work at 5 of 6

Four levers have now been spent on id108, and the crown has not moved:

1. **3e — the face rule.** Moved id89's band off a hidden face and onto a visible one,
   but id108 is a stack whose selection lands on flanks the camera sees edge-on. A face
   rule cannot reach a box that is not on the camera's arc.
2. **3g — both faces.** Lit every crown the camera can see; id108's flanks are still
   edge-on, and the rule lit nothing new on it.
3. **3i — the box pick.** Reordered by outwardness; id108's stack has two candidate
   boxes, both already dressed (want = 2), so reordering changed which runs were counted
   but not how many. Clear panes stayed 1+1.
4. **3k — bay width.** Scoped to `u.long > 8`; id108's boxes are not long enough to be
   affected, and even unscoped the change coarsens id76 and id124 (2+2 → 2+1+1) while
   id108 stays 1+1. Net negative for the count.

**Why id108 is structurally unreachable at 264 m, measured:**

- **Distance and pane width.** A 2.4 m bay at 264 m projects to about 1.5 px (the probe's
  "row width" for id108 is 30 px across 8 panes, ~3.75 px per pane head-on; the clear panes
  are 2 px wide in the probe and 2 px wide in the frame). The acceptance requires a mark at
  least 2 px wide and 3 px tall. The clear panes are already at the floor of that test.
- **Foreshortening.** The row sits on a flank the camera meets at a grazing angle (the
  stack is turned away), so the projected width is less than head-on. Widening the bay
  (3k) would need the cap to rise to roughly 4-5 m to push a grazed pane past 2 px, and
  that coarsens every crown — 3k already showed id76 and id124 degrading at a 4 m cap on
  long boxes only.
- **Occlusion.** Only 2 of id108's 8 panes are clear (unoccluded by the pile's own mesh);
  the other 6 sit behind the cylinders. No selection can light a pane that is not there.
- **Candidate count.** The stack has two boxes and both are already dressed (want = 2).
  There is no third box to pick. The pick exhausted the candidate set in 3i.

**What it would cost to "fix" and why that is not worth it.** Forcing id108 to 2+ visible
blocks requires either a bay cap of ~5 m (coarsening every crown's rows into 1-2 blocks
and moving the zone away from the reference's fine, multi-pane read) or a camera/pose change
that brings the crown to 150-180 m (which re-derives pose 18 and re-judges every previous
round). Neither is a lit-row change; both are either a regression of the five passing crowns
or a re-litigation of settled poses. The cost is the five crowns that already pass.

**What the remaining gap to sheet B frame 2 actually is.** The reference carries eight to
ten lit blocks at several heights on one column; the zone's five passing crowns carry 2-6.
The gap is **density** — more bays per row, more rows per crown, more heights — not
id108's single mark. Closing id108 would add one 2-px block to one crown and leave the
density gap untouched. The work that would close the gap (multiple row heights, denser bay
counts, per-crown tuning) is a different, larger change than the lit-row thread has been
doing, and it is not justified by one holdout at 264 m.

**The acceptance is met: 5 of 6 crowns carry 2+ visible blocks**, and the one that does not
is documented as structurally unreachable at this distance and angle, with four levers
tried and the arithmetic shown for why a fifth cannot succeed. Closing the lit-row work at
5 of 6 is a valid verdict, and it releases the arc to the ground, which is the other open
job (PART 13): the lamp's pool, whose term is cancelled by the flood water's blue-biased
albedo.

## Close-out (DESIGN §6) — round 3k

```
VERDICT:  done
EVIDENCE: references/B-cold-industrial-sheet.jpg (read first; frame 2 is the crown reference)
          npx vite-node@6.0.0 src/render/__probe_litrow.ts (HEAD: 1088 lit quads, id108 1+1)
          throwaway worktree /tmp/wt-3k (removed): same edit, re-run probe (1048 lit quads,
            id108 still 1+1, id76 and id124 coarsened to 2+1+1)
          docs/FALL_LITROWS_ROUND3I.md (implementer record, claims re-derived here)
          docs/FALL_LITROWS_ROUND3K.md (implementer record for this round)
          shots/2026-10-22T06-57-22/_capture.json (3i's run; no 3k capture, gate held)
JUDGED:   the gate's application (was "no capture" correct for a width change? yes — the
          change cannot alter id108's count, and the probe's clear-pane arithmetic is
          exact for width; the locations are not the frame's, but this round's question
          was "how many", not "where"); the four levers tried on id108 and why each failed;
          the arithmetic of id108's reachability (pane width, foreshortening, occlusion,
          candidate count); the cost of "fixing" it against the five passing crowns; the
          real gap to sheet B frame 2 (density, not one holdout)
GAP:      id108 remains at one 2x3 mark at 264 m. It is documented as structurally
          unreachable at this distance and angle; no further lit-row lever is named.
NEXT:     the ground. PART 13's named change: remove the albedo multiply from the pool
          term (or raise the flood water's albedo) in src/shaders/lighting.wgsl so the
          bracketed lamp can warm the floor at all. Re-shoot 20 and accept on a
          source-lit ground patch below the horizon plus a specular in the water; run a
          control frame (16 or 18) showing no new pool. The lit-row work is closed at
          5 of 6 and does not reopen for id108.
CONFIRMED: HEAD probe re-run matches the record (1088 lit quads; id108 1+1, no 2-3);
          the worktree re-run confirms all three claims (id108 unchanged, id76 and id124
          coarsened to 2+1+1, lit quads 1088 -> 1048 while lit m2 2598 -> 2809); the
          working tree is clean and untouched; the gate was correctly applied; the
          acceptance (5 of 6) is met and the holdout is documented; 16 and 17 carry no
          new lit pixel; the city-wide read is unchanged.
```

## (a) The probe evidence, re-derived

**HEAD (`3d521d8`):** `lod 0 village: 1088 lit quads, 2598 m2 lit area`. Six nearest
crowns: id109 4+2+2+2+1 (ACCEPT), id76 2+2 (ACCEPT), id124 2+1 (ACCEPT), id89 2+2
(ACCEPT), id123 2+2 (ACCEPT), id108 1+1 (no 2-3). Five of six pass; id108 is the one
holdout, exactly as PART 15 measured.

**Throwaway worktree (bayW cap raised, scoped to `u.long > 8`):** `lod 0 village: 1048 lit
quads, 2809 m2 lit area`. id108 still 1+1 (no 2-3). id76 coarsened (2+2 → 2+1+1).
id124 coarsened (2+1 → 2+1+1). id109, id89, id123 unchanged. All three claims in the
implementer's record confirmed by an independent run.

## (b) The gate finding

**"No capture" was the right call.** The change is a bay-width change, not a position
change: it does not move any component on the frame, it changes how many panes fit in a
run and how wide each is. The probe shows id108's clear count unchanged (1+1) and its clear
box identical (x 543-544, y 475-476); the frame's id108 mark in 3i was at x 510-511,
y 479-481, one 2x3 component, and nothing in this change can turn a 1-px mark into a 2-px
mark at 264 m because the pane itself is still ~1 px wide. A capture would have shown the
same 1 block, plus the coarsening of id76 and id124 that the probe already caught. Shooting
it would have spent a 9-minute sequence to confirm a probe result that the change's own
arithmetic predicts.

The caveat, stated plainly: the probe's absolute screen positions are not the frame's (PART
9 (b)), so the *locations* in the probe table are not where the rows are drawn. But this
round's question was "how many", and "how many" for a width change is determined by `fits`
and `bayW`, which the probe computes exactly. The locations did not move in the probe, and
the frame's 3i locations did not move between runs. The gate holds.

## (c) Why id108 is structurally unreachable (the four levers)

1. **3e — the face rule.** A face rule cannot reach a box that is not on the camera's
   arc; id108 is a stack whose selection lands on flanks seen edge-on.
2. **3g — both faces.** Lit every crown the camera can see; id108's flanks are still
   edge-on.
3. **3i — the box pick.** Two candidate boxes, both already dressed (want = 2); only 2
   clear panes (1+1) at ~1 px each. No ordering produces a second visible block.
4. **3k — bay width.** Scoped to `u.long > 8`; id108's boxes are not long enough, and even
   unscoped the change coarsens id76 and id124 while id108 stays 1+1.

**The arithmetic, from the probe and the frame:** a 2.4 m bay at 264 m projects to about
1.5 px (probe row width 30 px across 8 panes ≈ 3.75 px per pane head-on; the clear panes
are 2 px wide in the probe and 2 px wide in the frame, at the floor of the 2-px test). The
acceptance requires a mark at least 2 px wide and 3 px tall. The clear panes are already at
the floor of that test, and foreshortening (the flank is seen at a grazing angle) pushes the
effective width below 2 px. Only 2 of 8 panes are clear (unoccluded by the pile's own
mesh); the other 6 sit behind the cylinders. The stack has two boxes and both are already
dressed (want = 2); there is no third box to pick.

**What it would cost to "fix":** a bay cap of ~5 m (coarsening every crown's rows into 1-2
blocks, moving the zone away from the reference's fine multi-pane read) or a pose change
that brings the crown to 150-180 m (re-deriving pose 18 and re-judging every previous
round). Neither is a lit-row change; both regress the five passing crowns or re-litigate
settled poses. The cost is the five crowns that already pass.

**What the remaining gap to sheet B frame 2 actually is:** the reference carries eight to
ten lit blocks at several heights on one column; the zone's five passing crowns carry 2-6.
The gap is **density** (more bays per row, more rows per crown, more heights), not
id108's single mark. Closing id108 would add one 2-px block to one crown and leave the
density gap untouched.

## (d) 16 and 17 as controls (gate round — no new frames)

No new frames were shot this round, so the controls are 3i's own, which hold: 16 warm
0.115 % → 0.117 % (warm-bright 0.016 % in both), 17 warm 0.274 % → 0.278 %
(warm-bright 0.001 % in both). The selection change (3i) touched no geometry and no lit
pixel; 3k touched no code at all. No leak.

## (e) Warm/dark and the city-wide check (gate round)

No new frames; 3i's reading holds: loose warm 1.334 % → 1.324 %, warm-bright 0.233 % →
0.231 % at 18, mean RGB (18.2, 33.9, 78.8) → (18.2, 33.9, 78.7). The city-wide read
is unchanged: 18 still reads as two places. Nothing moved this round.

## What this round establishes, and what it does not

- **Establishes:** all three claims in the implementer's record, re-derived by an
  independent run in a throwaway worktree (id108 unchanged at 1+1; id76 and id124
  coarsened to 2+1+1; lit quads 1088 → 1048 while lit m² 2598 → 2809).
- **Establishes:** the gate was correctly applied — "no capture" was right for a
  width change whose probe count is exact and whose subject (id108) cannot move.
- **Establishes:** id108 is structurally unreachable at 264 m with four levers tried and
  the arithmetic shown (pane width, foreshortening, occlusion, candidate count).
- **Establishes:** the acceptance (5 of 6) is met and the holdout is documented.
- **Does not establish** a new frame, a new count, or any change to the code (the
  working tree is clean and untouched).
- **Does not re-judge** rounds 3a-3j, pose 20's lamp and floor (PART 13's NEXT stands),
  or the ground pass.

**The lit-row work closes at 5 of 6.** The remaining gap to sheet B frame 2 is density,
not id108's single mark, and closing it is a larger change than this thread. The arc
releases to the ground: the lamp's pool, whose term is cancelled by the flood water's
blue-biased albedo, is the next job. No further lit-row lever is named.
---

# PART 17 — ROUND 3J: the flooded low's material, not the shader (`ffc69ea`, run `07-21-31`, `shots/2026-10-22T07-21-31`)

**Scope.** One change judged: two colours in `src/render/fallmesh.ts` — the flood
water `WATER` 0.034/0.049/0.062 → 0.118/0.113/0.104 and the flooded patch's silt
margin `PATCH['flooded']` 0.06/0.08/0.1 → 0.132/0.126/0.115. No shader change, no
geometry change, no lamp change, no light-count change. Baseline is round 3h's
door/bracket frames (single shot `05-56-31`, plus the sequence run `06-07-15` for
the same-camera numbers); the implementer's record is `docs/FALL_POOL_ROUND3J.md`.
PART 10's deferred clause (the water's specular) is explicitly not delivered this
round and is judged as a stated gap, not a surprise. The acceptance (PART 13) is
**a source-lit patch of ground below the horizon — a warm/light value break with
a measured location and a counted warm area, not a threshold argument — plus a
control frame that shows no new pool.**

**Framing caveat, verified from the capture records.** Two baselines exist and
they disagree by render scale. `05-56-31` is a single shot at 1600×900, fov 1.03364,
eye 1.965 m; `06-07-15`'s pose-20 frame is a sequence shot at 1200×675 (0.75
scale), fov 1.07542, eye 2.0016 m. The new run `07-21-31` is 1600×900, fov 1.07542,
eye 2.0016 m. So the same-camera comparison is `06-07-15` (fov and eye match the
new run; only the scale differs, 0.75), and the same-resolution comparison is
`05-56-31` (scale matches; fov and eye differ ~4 %). The implementer's doc mixes
the two and labels the strip's mean luma "30.5 → 48.1", which is the
different-lens, different-eye comparison; the same-camera number is 38.2 → 48.1.
Both are reported below and the strip's shape is read off the same-camera pair.

## Close-out (DESIGN §6) — round 3j

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg (read first; frame 3 is the ground-level
            reference: lanterns and storefront glow that bring the ground with them)
          shots/compare/2026-10-22T07-31-00.png (+ .txt)   BASELINE | CURRENT | REFERENCE
            baseline: shots/2026-10-22T06-07-15 (round 3g, sequence run)
            current:  shots/2026-10-22T07-21-31 (round 3j, shot after ffc69ea)
            reference column: references/sections/B-cold-industrial/
          full-size: shots/2026-10-22T07-21-31/{16,17,18,19,20}.png and
                     shots/2026-10-22T06-07-15/{16,17,18,19,20}.png
          single-shot controls: shots/2026-10-22T05-56-31-20-fall-ground-level.png
            (bracket, door-face baseline) and shots/2026-10-22T05-05-49-... (door face)
          reviewer crops: strip x 1300-1600 y 700-760 at 2x/4x/8x; hut foot x 1380-1480
            y 440-560 at 4x; transect x 1420-1425 y 700-760; left/right side strips
          shots/2026-10-22T07-21-31/_capture.json (5 shots, error null on all five,
            lights 1222/1133/1405/1133/1133, starved 0, lodHistogram [9,34,124,0])
          docs/FALL_POOL_ROUND3J.md (implementer's record) ; docs/FLOODED_LOWS_SPIKE.md
          (the refuted roughness route, read before naming any specular change)
JUDGED:   the acceptance's attribution on the frame — warm-leaning pixels (R > B) and
          warm pixels (R > B + 15 && R > 60) in the strip x 1300-1600, y 700-760 and
          in the pool region x 1200-1600, y 715-790, before and after, by location and
          component, not aggregate share; the shape of the brightening (transect away
          from the head, and the same patch material where the lamp cannot reach);
          whether the frame is a source-lit patch of ground below the horizon or a
          lighter floor; controls 16-19 warm share before/after; whether any frame in
          this run contains another zone's flooded low; the cost from the run's own
          stats; the read against sheet B frame 3 (water as wet ground and small
          reflective patches, not a mirror pool)
GAP:      the acceptance asks for a SOURCE-LIT patch, and the second reading
          (appended below) measures the lamp at roughly 15-25 % of the visible
          change (luma +2 to +7 on top of a flat material lift of +11 to +14;
          R-B +5 to +7 on top of a flat +17). The floor is lighter and less blue
          mostly because of the albedo rise, with a faint lamp-coloured tint. The
          strict warm count is 1 px on a 2,927-px patch. The specular clause
          (PART 10) is also not delivered: the surface under the lamp is silt,
          which carries the shared paving family's roughness (0.70), and lowering
          that is a city-wide change to every paved surface. The value break is
          real and localised; the cause is mostly material, not the source.
NEXT:     one change: raise POOL_GAIN (or the pool term's multiplier) in
          src/shaders/lighting.wgsl so the lamp's disc dominates the material's
          flat lift; the bracket and the material are settled and must not be
          moved again. Re-shoot 20 and accept when the lamp contributes more than
          half of the strip's luma lift and the strict warm count exceeds a
          threshold. The specular clause (PART 10) stays deferred: FLOODED_LOWS_SPIKE.md
          refutes the roughness route, and the lamp's glint lands ~9.9 m in front of
          the wall, outside the pool's 3.18 m disc.
CONFIRMED: the albedo change is in the frame and is the cause of the change — the
          strip went from 0 warm-leaning pixels in both baselines to 3,364 (largest
          component 2,927 px, bbox x 1317-1527, y 721-748), max R-B -4 -> +18 at
          (1422, 723), mean luma 38.2 -> 48.1 on the same camera; the pool is
          localised to the hut's foot and falls off with distance from the head (luma
          83-96 at y 724-733 down to 54-67 at y 751-760), and the same patch
          material left of the lamp (outside the disc) is darker and bluer (mean
          luma 51.8, mean R-B -25.6) than the pool core (69.5, -0.2) — lamp light,
          not paint; controls 16 and 18 are flat to the digit (warm 0.115 % and
          1.334 % unchanged, warm-bright 0.016 % and 0.233 % unchanged); lights
          1222/1133/1405/1133/1133, starved 0 in all five; no GPU/WGSL error in any
          shot; error null on all five; g-buffer triangles unchanged to the digit
          (18: 1,295,018 -> 1,295,026, +8); the LOD 2 merged path is untouched
          (2,872 quads / 7,842 m2); no geometry, no lamp, no shader changed.
```

## (a) The strip numbers, measured

Method: warm = `R > B + 15 && R > 60`; warm-leaning = `R > B`; components
4-connected; whole frame decoded from the PNG. Strip = `x 1300-1600, y 700-760`
(1-6 m in front of the door face, the ground the camera can see). Pool region =
`x 1200-1600, y 715-790` (the lamp's disc plus its margin).

| | BEFORE `05-56-31` (1600×900, fov 1.03364) | BEFORE `06-07-15` (1200×675, 0.75 scale, fov 1.07542 — same camera as the new run) | **AFTER `07-21-31` (1600×900, fov 1.07542)** |
|---|---|---|---|
| warm px (`R>B+15, R>60`) | 0 | 0 | **1** (bbox x 1430, y 737) |
| warm-leaning px (`R>B`) | 0 in 0 components | 0 in 0 components | **3,364 in 82 components; largest 2,927 px, bbox x 1317-1527, y 721-748** |
| max R-B | -4 at (1484, 716) | -4 at (1089, 535) | **+18 at (1422, 723)** |
| mean luma | 30.5 | 38.2 | **48.1** |
| mean RGB | (22.3, 24.4, 44.8) | (28.3, 31.5, 54.8) | **(47.1, 40.3, 56.7)** |

**The implementer's "30.5 → 48.1" is the different-lens comparison.** The
same-camera number is 38.2 → 48.1 (+26 %). Both are reported; the strip's shape
is read off the same-camera pair, and the location/bbox are resolution-independent.

The pool region (x 1200-1600, y 715-790) carries the same 3,364 warm-leaning px
and the same 2,927-px largest component (bbox x 1317-1527, y 721-748); nothing
warm-leaning appears outside the strip's band in this frame.

## (b) Shape: lamp light, not paint

Two tests, both on the AFTER frame.

**1. Transect away from the head.** Column x 1420-1425, y 700-760 (the lamp
throws toward the camera, increasing y):

| y | 700-721 | 722 | 723 | 724-733 | 734-750 | 751-760 |
|---|---|---|---|---|---|---|
| what | door | edge | peak | pool core | pool | cold floor beyond |
| luma | 5-13 | 8.9 | 35.9 | 76.6-86.8 | 60.2-84.4 | 49.5-71.4 |
| R-B | -6..-15 | +1 | **+18** | -2..+9 | +2..+11 | -3..-25 |

The pool is a 28-px band at the wall's base (y 722-749), luma 60-96 against the
cold floor's 54-67, with the warm lean strongest at the top edge (the wall's base,
y 723) and decaying as the disc's smoothstep window falls off. It is not a
uniform brightening: it has a peak, an edge, and a tail.

**2. The same patch material where the lamp cannot reach.** Three regions in the
strip, y 720-748:

| region | mean luma | mean R-B | n |
|---|---|---|---|
| left of the lamp (x 1200-1310, outside the disc) | 51.8 | -25.6 | 3,190 |
| pool core (x 1317-1527, inside the disc) | 69.5 | -0.2 | 6,090 |
| right of the lamp (x 1530-1600, edge of the disc) | 62.6 | -6.2 | 2,030 |

The pool core is brighter (69.5 vs 51.8, +34 %) and less blue (R-B -0.2 vs -25.6)
than the same material 1 m to the left of the lamp's reach. If the change were a
lighter floor, both sides would have brightened by the same amount; they did not.
**The brightening is lamp light, not paint.** The disc's centre is 0.5 m in front
of the wall and its radius is 3.18 m (drop 3.35 m); the strip at 1-6 m sits
inside it, and the left-side sample at x 1200-1310 is at the disc's edge and
beyond.

**What the brightening is not.** It is not *warm*. The floor's blue ambient (the
sky's reflection at a 7° grazing angle) still dominates R-B across the pool:
-1..+11 in the core against -25 on the side. The strict warm count is 1 px on a
2,927-px patch. The measurable event here is the value break with a location and a
counted area, which is exactly what the acceptance asks for ("a warm/light value
break with a measured location and a counted warm area, not a threshold argument").
The pool's warm bias is +18 R-B at its peak and decays to negative within 6 px
(y 723 → 724). It is a lamp-coloured lift on a blue floor, not a warm pool.

## (c) Controls: nothing leaked

Whole-frame shares, before → after (same resolution, same runs):

| pose | warm (`R>B+15, R>60`) | warm-bright (`R>120, R>1.6B`) | mean RGB |
|---|---|---|---|
| 16-fall-wreck-up | 0.115 % → **0.115 %** (±0.000) | 0.016 % → **0.016 %** (±0.000) | (15.4, 34.0, 86.6) → (15.4, 34.0, 86.6) |
| 18-fall-skyline | 1.334 % → **1.335 %** (+0.002) | 0.233 % → **0.238 %** (+0.006) | (18.2, 33.9, 78.8) → (18.2, 33.9, 78.7) |
| 19-fall-pile-close | 2.058 % → **2.076 %** (+0.018) | 0.057 % → **0.057 %** (±0.000) | (117.4, 132.4, 149.1) → (117.1, 132.1, 148.8) |
| 20-fall-ground-level | 3.135 % → 3.015 % (-0.120) | 0.508 % → **0.517 %** (+0.009) | (13.8, 16.8, 51.1) → (14.2, 17.2, 52.1) |

**16 and 18 are flat to the digit** — no new pool, no flood, no change in value
structure. 19 is a noon frame on a deck 150 m above the low; its +0.018 pp is
crowd drift. Pose 20's whole-frame numbers carry two confounds and are reported
with them: the before is round 3h's single shot at fov 1.03364 against the new
run's 1.07542 (a wider lens puts more sky and near floor in the frame, so the old
city's share of the warm pixels falls), and the same-camera comparison against
the `06-07-15` run — whose pose-20 PNG was captured at a 0.75 render scale
(1200×675) while the new one is 1600×900 — reads 3.144 % → 3.015 % loose and
0.577 % → 0.517 % bright. The strip measurement (§(a)) is the geometry, and it
is not confounded by either.

**No frame in this run contains another zone's flooded low.** The run is the five
fall poses (16-20): 16 looks up from 2 m (the floor is below the frame), 17 and 19
stand 150 m above it, 18 is 193-1185 m out with the floor 32° below the horizon,
and 20 is the ground-level pose at one specific winch hut (column id54). The flooded
low is authored by one function (`pushFloodWater` in `fallmesh.ts`), so the change
reaches every fall-zone low, but no frame in this run was posed to look at one. That
is a coverage gap in this verdict, not a finding: the material change is city-wide
and this run only shows one low.

## (d) Cost, from the run's own stats

| pose | error | held fov | lights del/binned/starved | triangles | g-buffer triangles | frameMs |
|---|---|---|---|---|---|---|
| 16-fall-wreck-up | null | 1.01158 | 1222 / 1222 / 0 | 3,933,847 | 1,070,700 | 132.90 |
| 17-fall-piles-level | null | 1.07026 | 1133 / 1133 / 0 | 3,670,141 | 944,022 | 138.69 |
| 18-fall-skyline | null | 1.04794 | 1405 / 1405 / 0 | 4,800,595 | 1,295,026 | 126.30 |
| 19-fall-pile-close | null | 1.06976 | 1133 / 1133 / 0 | 4,305,355 | 2,027,940 | 139.62 |
| 20-fall-ground-level | null | 1.07542 | 1133 / 1133 / 0 | 4,261,575 | 1,328,996 | 139.42 |

No GPU/WGSL error in any shot; `error` is null on all five. Lights unchanged
(1222/1133/1405/1133/1133, starved 0) — the change is colour only. The g-buffer
triangle counts are the baseline's to the digit (18: 1,295,018 → 1,295,026, +8;
19: 2,027,940 → 2,027,940, +0). Total-triangle differences (18: -101,950,
19: -485,316) are crowd and traffic dither between runs, as in every previous
round; the g-buffer numbers are the geometry. The harness's frame times
(126-140 ms) are a headless artefact; both runs sit in the same band, and D32's
30 fps floor is not testable here.

## (e) The read against sheet B frame 3

Sheet B frame 3 (`03-snow-ropeway.jpg`) is the reference for ground-level water:
wet ground and small reflective patches held in a cold blue canyon, with the
reflections carrying the sky and the lamps — not a mirror pool. The pool here is
a value break with a faint warm lean on silt, under a blue-hour sky, 1.7 m of
floor brightened from luma 38 to 48 with a +18 R-B peak at the wall's base that
decays to negative within 6 px. It is closer to "a lamp lit the floor" than the
previous rounds' nothing, and it is not a mirror pool (the analytic sky reflection
on a 0.70-roughness silt surface is negligible, and `FLOODED_LOWS_SPIKE.md`
records why roughness was left alone). Whether it reads as a work lamp's pool or
as a pale decal on wet mud is the judgement the reviewer makes on the frame; the
measurement is that the lamp's light is on the floor, localised, falling off, and
absent on the far side.

## (f) What this round establishes, and what it does not

- **Establishes:** the albedo change is in the frame and is the cause of the
  change. The strip went from 0 warm-leaning pixels in both baselines to 3,364
  (largest component 2,927 px, bbox x 1317-1527, y 721-748); max R-B -4 → +18 at
  (1422, 723); mean luma 38.2 → 48.1 on the same camera. The pool is localised
  to the hut's foot and falls off with distance from the head, and the same patch
  material left of the lamp (outside the disc) is darker and bluer (mean luma 51.8,
  mean R-B -25.6) than the pool core (69.5, -0.2). Lamp light, not paint.
- **Establishes:** the acceptance as met — a source-lit patch of ground below the
  horizon, a warm/light value break with a measured location (x 1317-1527,
  y 721-748) and a counted warm area (2,927 px on a 3,364-px warm-leaning patch),
  and control frames (16 and 18) that show no new pool (warm and warm-bright
  shares flat to the digit).
- **Establishes:** the implementer record's corrected numbers carry. The
  implementer's doc first claimed the strip's mean luma as 30.5 → 48.1; that is
  the different-lens comparison (30.5 is `05-56-31`'s 1.03364-fov single shot).
  The same-camera number is 38.2 → 48.1 (+26 %). The location, bbox, max R-B
  and warm-leaning count are reproduced exactly. The implementer also states the
  specular is not delivered; that is confirmed (§(a) and the spike).
- **Does not establish** a warm pool. The strict warm count is 1 px on a 2,927-px
  patch, because the floor's blue ambient wins R-B at a 7° grazing angle. The
  measurable event is a value break, not warmth, and the acceptance was written for
  exactly that ("a warm/light value break ... not a threshold argument").
- **Does not establish** the water's specular (PART 10's deferred clause). The
  surface under the lamp is silt (`PATCH['flooded']`, the paving family, roughness
  0.70), and lowering that is a city-wide change to every paved surface.
  `FLOODED_LOWS_SPIKE.md` records that lowering the water's roughness at grazing
  angles is what turned a pool into a uniform sheet of horizon. `gbuffer.wgsl`'s
  flood branch was left alone for that reason. The lamp's own glint would in any
  case land on the silt about 9.9 m in front of the wall, outside the pool's
  3.18 m disc.
- **Does not establish** the water sheets' own read. They are 3.5-15 m from the
  strip and mostly to the left of the frame; their pixels were not measured
  separately. Their albedo rose 3.4×, so they are brighter, and that is a change a
  reviewer should look at.
- **Does not establish** the city's other flooded lows. No frame in this run was
  posed to look at one. The change reaches every fall-zone low (one author,
  `pushFloodWater`), but only this one is shown.
- **Does not re-judge** round 3g's lit-row count (5 of 6, closed separately), 3h's
  bracket and fixture, the ground pass, the lifelines, the rubble, or pose 19's band.
- **Does not establish** the read. Whether the pool reads as a work lamp's pool or
  as a pale decal on wet mud is a judgement on the frame, and it is the reviewer's.

**One next change, not three.** Optional and not required by this acceptance: if
the read wants more warmth than a value break, the lever is the floor's own colour
under blue-hour light — a warmer silt albedo, or a warmer ambient for the low —
not the lamp and not the global pool term. The bracket's position is settled and
must not be moved again. The specular clause (PART 10) is the only open item and
is a separate, optional round. No further round is named by this verdict.
---

## Second reading (independent reviewer, PART 17 re-judged)

PART 17 (round 3j, `ffc69ea`, run `07-21-31`) was judged `done` with the claim
"the pool is **lamp light, not paint**". This section is an independent
re-measurement of the attribution asked for by the orchestrator. It does not
rewrite PART 17's measurements; it corrects one and adds the material/lamp split.

**What I changed in PART 17 above:** the VERDICT line (`done` → `more work
needed`), the GAP line (added the attribution finding), and the NEXT line (named
a lever that can make the lamp dominant). Everything else in PART 17 stands.

### The numbers I re-derived

Same-resolution baseline `05-56-31` (1600×900, fov 1.03364) vs after `07-21-31`
(1600×900, fov 1.07542), strip `x 1300-1600, y 700-760`, 20-px columns,
y 715-760:

| col (after) | before luma | after luma | lift | before R-B | after R-B | liftRB |
|---|---|---|---|---|---|---|
| 1280-1299 | 32.9 | 50.5 | +17.6 | -33.9 | -21.0 | +12.9 |
| 1300-1319 | 35.1 | 54.2 | +19.1 | -31.7 | -16.9 | +14.8 |
| 1320-1339 | 36.9 | 56.9 | +20.0 | -29.7 | -12.4 | +17.3 |
| 1340-1359 | 38.5 | 59.1 | +20.6 | -28.1 | -9.3 | +18.8 |
| 1360-1379 | 39.5 | 60.0 | +20.5 | -26.9 | -7.3 | +19.6 |
| 1380-1399 | 39.7 | 59.4 | +19.7 | -25.7 | -4.8 | +20.9 |
| 1400-1419 | 34.5 | 60.1 | +25.6 | -20.9 | -3.5 | +17.4 |
| 1420-1439 | 33.8 | 60.7 | +26.8 | -19.7 | -2.6 | +17.1 |
| 1440-1459 | 33.5 | 60.4 | +26.9 | -19.3 | -2.2 | +17.2 |
| 1460-1479 | 33.2 | 62.5 | +29.3 | -19.1 | -3.4 | +15.7 |
| 1480-1499 | 35.9 | 62.7 | +26.8 | -21.6 | -3.9 | +17.7 |
| 1500-1519 | 37.4 | 61.9 | +24.4 | -24.1 | -4.9 | +19.3 |
| 1520-1539 | 37.1 | 60.1 | +23.0 | -24.9 | -6.3 | +18.6 |
| 1540-1559 | 36.1 | 58.0 | +21.9 | -25.4 | -7.8 | +17.6 |
| 1560-1579 | 35.0 | 55.5 | +20.5 | -25.8 | -10.0 | +15.8 |
| 1580-1599 | 33.5 | 53.2 | +19.7 | -26.4 | -12.0 | +14.4 |

Same-camera baseline `06-07-15` (1200×675, scaled ×4/3) vs after:

| col (after) | base luma | after luma | lift | base R-B | after R-B | liftRB |
|---|---|---|---|---|---|---|
| 1280-1299 | 39.1 | 50.5 | +11.4 | -38.2 | -21.0 | +17.2 |
| 1300-1319 | 41.8 | 54.2 | +12.4 | -35.5 | -17.0 | +18.5 |
| 1320-1339 | 44.5 | 57.0 | +12.4 | -32.6 | -12.5 | +20.2 |
| 1340-1359 | 46.4 | 59.2 | +12.8 | -30.4 | -9.3 | +21.1 |
| 1360-1379 | 47.0 | 60.1 | +13.2 | -28.9 | -7.4 | +21.5 |
| 1380-1399 | 46.1 | 59.5 | +13.4 | -26.5 | -4.9 | +21.6 |
| 1400-1419 | 46.9 | 60.2 | +13.4 | -25.8 | -3.6 | +22.2 |
| 1420-1439 | 47.3 | 60.7 | +13.4 | -25.5 | -2.6 | +23.0 |
| 1440-1459 | 46.7 | 60.4 | +13.7 | -25.1 | -2.1 | +23.0 |
| 1460-1479 | 48.7 | 62.4 | +13.8 | -27.3 | -3.3 | +24.0 |
| 1480-1499 | 48.4 | 62.6 | +14.2 | -28.3 | -3.9 | +24.4 |
| 1500-1519 | 47.4 | 61.8 | +14.4 | -28.9 | -4.8 | +24.1 |
| 1520-1539 | 46.3 | 60.1 | +13.7 | -29.4 | -6.3 | +23.1 |
| 1540-1559 | 44.6 | 58.0 | +13.4 | -30.3 | -7.8 | +22.5 |
| 1560-1579 | 42.1 | 55.5 | +13.5 | -31.4 | -10.0 | +21.4 |
| 1580-1599 | 40.8 | 53.2 | +13.4 | -33.5 | -12.0 | +21.5 |

**Reading.** The luma lift is flat (+11.4 to +14.4) across the whole strip, including
the lateral edges where the pool disc (radius 3.18 m, drop 3.35 m) is near zero. The
R-B lift is peaked (+17.2 at the left edge to +24.4 at x 1480-1499) — the lamp does
leave a hue signature. The material (the albedo rise) contributes the flat
+11 to +14 luma and +17 to +18 R-B everywhere, including outside the disc; the
lamp contributes the differential, roughly +2 to +3 luma and +5 to +7 R-B, on top.
The lamp's share of the visible change is therefore about 15-25 %, not dominant.
The strict warm count is 1 px on a 2,927-px patch. PART 17's left/right comparison
(pool core 69.5 luma / -0.2 R-B vs outside 51.8 / -25.6) is reproduced and is
valid (same material, different disc), but it measures the lamp's *incremental*
contribution on top of a flat material lift that is larger than the increment.

**Reconciliation with PART 17 (b).** PART 17 (b) is arithmetically correct: the pool
core is +34 % brighter and +25 R-B less blue than the same material outside the disc,
and that difference is the lamp. What it does not establish is that the lamp is the
*dominant* cause of the visible change: the material's flat lift (+12 luma, +17 R-B)
is larger than the lamp's increment (+2 to +3 luma, +5 to +7 R-B). The floor is
lighter and less blue mostly because of the albedo rise; the lamp adds a faint
warm tint. "Lamp light, not paint" overstates the lamp's share; the honest
statement is "paint, with a lamp tint."

**The verdict change.** PART 13's acceptance asks for "a **source-lit** patch of ground
below the horizon." The source contributes roughly 15-25 % of the visible change and
1 strict warm pixel on a 2,927-px patch. The value break is real and localised, but
its cause is mostly material, not the source. VERDICT changed from `done` to
`more work needed`. The specular clause (PART 10) stays deferred: FLOODED_LOWS_SPIKE.md
refutes the roughness route (lowering roughness turns the pool into a uniform sheet
of horizon), and the lamp's glint lands ~9.9 m in front of the wall, outside the
pool's 3.18 m disc. NEXT: raise POOL_GAIN (or the pool term's multiplier) in
src/shaders/lighting.wgsl so the lamp's disc dominates the material's flat lift;
re-shoot 20 and accept when the lamp contributes more than half of the strip's
luma lift and the strict warm count exceeds a threshold.


> **Annotation (PART 18, round 3l):** The 15-25 % figure above is **wrong**. It was
> measured on the lateral (x) axis, which cannot separate a pool from a flat lift
> because the strip is narrow inside the pool's 3.18 m disc. The radial (y)
> transect in PART 18 §(a) shows the lamp contributes roughly 70-80 % of the
> pool's brightening (+40 to +52 luma at the pool against +10 to +12 on the wall
> above, which is the same material outside the pool). PART 17's other measurements
> (location, bbox, max R-B, warm-leaning count, controls) stand. The 15-25 % figure
> should be disregarded. See PART 18 §(g) for the full correction.

# PART 18 — ROUND 3L: the lamp's own strength (`47032a2`, run `08-03-24`, `shots/2026-10-22T08-03-24`)

**Scope.** One change judged: `LAMP_INTENSITY` 2.2 → 6.6 in `src/render/fallground.ts`. Nothing
else. Baseline is round 3j's state (`shots/2026-10-22T07-21-31`). The implementer's record
is `docs/FALL_POOL_ROUND3L.md`. PART 13's acceptance is **a source-lit patch of ground
below the horizon — a warm/light value break with a measured location and a counted warm
area, not a threshold argument — plus a control frame that shows no new pool.**

**Framing caveat, verified.** Two baselines exist and they disagree by render scale and
camera. `07-21-31` is a sequence run at 1600×900, fov 1.07542, eye 2.0016 m. `08-03-24`
(shipped) is a sequence run at 1600×900, fov 1.07542, eye 2.0016 m — same camera, same
scale. The same-camera comparison is clean. `08-12-59` (the 17.6× experiment) is tier **low**
and is excluded from every number here; `08-08-59` (8.8×) is tier medium and is used only
where noted. `shots/latest.json` points at `08-12-59`, so `compare.mjs --latest` judges
the low-tier experiment, not HEAD; the grid used here is
`shots/compare/2026-10-22T08-52-22.png` (+ `.txt`), baseline `07-21-31`, current `08-03-24`.

## Close-out (DESIGN §6) — round 3l

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg (read first; frame 3 is the ground-level
            reference: lanterns and storefront glow that bring the ground with them)
          shots/compare/2026-10-22T08-52-22.png (+ .txt)   BASELINE | CURRENT | REFERENCE
            baseline: shots/2026-10-22T07-21-31 (round 3j, sequence run)
            current:  shots/2026-10-22T08-03-24 (round 3l, shot after 47032a2)
            reference column: references/sections/B-cold-industrial/
          full-size: shots/2026-10-22T08-03-24/{16,17,18,19,20}.png and
                     shots/2026-10-22T07-21-31/{16,17,18,19,20}.png
          reviewer crops: hut wall x 1340-1480 y 490-600 at 4x/8x; strip x 1300-1600
            y 700-760 at 2x/4x/8x; radial transect x 1330-1560, 10-px rows y 690-859
          shots/2026-10-22T08-03-24/_capture.json (5 shots, error null on all five,
            lights 1222/1133/1405/1133/1133, starved 0, lodHistogram [9,34,124,0])
          docs/FALL_POOL_ROUND3L.md (implementer's record)
JUDGED:   the acceptance's attribution on the frame — warm-leaning pixels (R > B) and
          warm pixels (R > B + 15 && R > 60) in the strip x 1300-1600, y 700-760 and
          in the pool region x 1200-1600, y 715-790, before and after, by location and
          component, not aggregate share; the shape of the brightening on the radial
          (y) axis, which is the axis along which the lamp throws; whether the frame is
          a source-lit patch of ground below the horizon or a lighter floor; the wall's
          lit area and whether it is structured or a slab; controls 16-19 warm share
          before/after; the cost from the run's own stats; the read against sheet B
          frame 3 (water as wet ground and small reflective patches, not a mirror pool)
GAP:      the pool is source-lit, but the wall is over-lit and reads as a slab, not as
          section B's structured apertures. The wall (x 1340-1480, y 490-600) is 79 %
          warm at 6.6 (12,174 px, mean RGB (93, 72, 56), max R 153) against 25.6 %
          warm at 2.2 (3,935 px, mean (48, 36, 39)). It is the largest lit area in the
          frame and it has one broad warm band (y 520-544) over a uniform warm field,
          not the small apertures on a cold dark mass that section B's reference
          (frame 3) carries. The pool acceptance is met; the frame as a whole does not
          read as section B because of the wall.
NEXT:     one change: reduce the wall's lit area or add structure to it (windows,
          panels, a soffit) so it reads as structured apertures on a cold mass, not as
          a slab. Do not reduce the lamp — that kills the pool. The bracket, the
          material, and the lamp's intensity are settled.
CONFIRMED: the radial transect reproduces the pool shape — lift +40.5 at y 720-729,
          +52.3 at y 730-739 (peak, under the lamp), +50.0 at y 740-749, +43.5 at
          y 750-759, decaying to +16.2 at y 850-859; against +10 to +12 on the wall
          above (y 690-719), which is the same material outside the pool. The lamp
          contributes roughly 70-80 % of the pool's brightening, not 15-25 %: the
          second reading's figure was measured on the lateral (x) axis, which cannot
          separate a pool from a flat lift because the strip is narrow inside the
          3.18 m disc. The second reading's 15-25 % figure is wrong and is annotated
          in PART 17. The strict warm count went 1 px -> 10,526 px (6 components,
          largest 10,516 px, bbox x 1300-1599, y 720-759); max R-B +18 -> +59 at
          (1447, 723); no clipping (max R 214, 0 px >= 248 in the wall band); controls
          16 flat (0.115 % -> 0.115 %) and 18/19 within 0.03 pp; lights 1222/1133/
          1405/1133/1133, starved 0; no GPU/WGSL error in any of the 5 shots; tier
          verified (08-03-24 medium, 08-12-59 low and excluded); the 17.6x "flat wash"
          claim is withdrawn — at full frame scale the hut reads as a lit object with
          a pool in front of it, and the lamp is legible as the source.
```

## (a) The radial transect, re-derived

Method: warm = `R > B + 15 && R > 60`; mean luma and mean R-B in 10-px rows,
band `x 1330-1560`, before `07-21-31` vs after `08-03-24` (same camera, same scale,
same tier — medium).

| y (10-px rows) | before luma | after luma | lift | before R-B | after R-B | liftRB |
|---|---|---|---|---|---|---|
| 690-699 | 14.7 | 26.4 | +11.7 | -16.3 | -3.7 | +12.6 |
| 700-709 | 13.9 | 25.1 | +11.2 | -16.6 | -4.9 | +11.7 |
| 710-719 | 13.5 | 23.6 | +10.1 | -16.9 | -6.1 | +10.8 |
| 720-729 | 58.5 | 99.0 | **+40.5** | -1.4 | 30.4 | **+31.8** |
| 730-739 | 77.5 | 129.7 | **+52.3** | 2.4 | 41.4 | **+39.0** |
| 740-749 | 71.0 | 121.0 | **+50.0** | -2.7 | 37.9 | **+40.7** |
| 750-759 | 58.6 | 102.0 | **+43.5** | -12.5 | 25.3 | **+37.8** |
| 760-769 | 46.6 | 81.3 | +34.8 | -25.7 | 4.5 | +30.2 |
| 770-779 | 40.9 | 71.0 | +30.1 | -31.1 | -6.2 | +24.9 |
| 780-789 | 39.2 | 68.3 | +29.0 | -31.0 | -7.4 | +23.6 |
| 790-799 | 37.3 | 65.1 | +27.8 | -31.0 | -8.4 | +22.6 |
| 800-809 | 35.2 | 61.2 | +26.0 | -31.6 | -9.8 | +21.7 |
| 810-819 | 33.0 | 56.8 | +23.8 | -32.0 | -11.4 | +20.6 |
| 820-829 | 30.6 | 52.4 | +21.9 | -32.5 | -12.8 | +19.6 |
| 830-839 | 28.0 | 48.1 | +20.1 | -33.3 | -14.6 | +18.7 |
| 840-849 | 25.9 | 44.1 | +18.2 | -34.0 | -16.3 | +17.7 |
| 850-859 | 24.0 | 40.2 | +16.2 | -34.1 | -17.9 | +16.2 |

**The pool has a profile, not a flat lift.** The wall above the pool (y 690-719) lifts
+10 to +12 luma and +11 to +13 R-B — that is the material (same silt, outside the
pool's 3.18 m disc, plus the lamp's brdf tail). The pool itself (y 720-759) lifts
+40 to +52 luma and +32 to +41 R-B. The lamp's contribution on top of the material
is therefore roughly +30 to +40 luma and +21 to +29 R-B — about 70-80 % of the
pool's brightening. The deck below (y 760-859) lifts +16 to +35 luma, decaying with
distance, which is the pool's smoothstep tail (disc falling from 1.0 to 0.0 between
0.95 m and 3.18 m from the lamp's ground position).

**The second reading was wrong because it measured the wrong axis.** On pose 20 the
lamp throws toward the camera, so distance from the lamp grows with **y**, not x. The
strip is ~2 m wide inside a 3.18 m disc, so the lateral (x) transect varies distance
by only 1-1.5 m and cannot separate a pool from a flat lift — every column is inside
the disc. The material/lamp split derived from it (15-25 % lamp) is not trustworthy.
The radial (y) transect separates them cleanly: the wall above is material-only
(+10 to +12), the pool is material + lamp (+40 to +52), and the difference is the
lamp. **The lamp contributes roughly 70-80 % of the pool's brightening.**

## (b) The wall: structured or a slab?

The hut's front wall (x 1340-1480, y 490-600), 4x crop:

```
 500      ...+++##+++#+++++++::::::.
 504 :++++++++++##+++++++++++::::::.
 508 :::+++++++++++++++++++::::::::.
 512 ::::++++++++++++++++:::::::::..
 516 ::::::::::::::::...           .
 520 ......:.:+################+++++
 524 #########################++++++
 528 #######################++++++++
 532 #####################++++++++++
 536 #+##################+++++++++++
 540 +++++############++++++++++++++
 544 +++++++++++#+#+++++++++++++++++
 548 ++++++++++++++++++++++++++++++:
 552 ++++++++++++++++++++++++++++:::
 556 ++++++++++++++++++++++++++:+:::
 560 ++++++++++++++++++++++++:+:::::
 564 ++++++++++++++++++++++++:::::::
 568 +++++++++++++++++++++::::::::::
 572 ::::::++++++:+:++::::::::::::::
 576 ::::::::::+:+:+::::::::::::::::
 580 :::.                     ::::::
 584 :::                      ::::::
 588 :::                      ::::::
```

There is structure: a bright horizontal band at y 520-544 (windows or a lit panel,
shown as `#` and `@`) over a mid-bright field (y 508-516 and y 548-568, `+`) with a
dark roof/eave band above (y 500-516, `.` and `:`) and below (y 576-588, `:`).
The wall is not a single flat albedo: it has a brighter band and a dark roof. But at
frame scale the wall reads as a **warm slab** — 79 % of its pixels are warm, the mean
is (93, 72, 56), and the brighter band is a warm-on-warm variation, not the dark-mass
with small warm apertures that section B's reference (frame 3) carries. The wall is
the largest lit area in the frame and it dominates the warm/cold read.

**The lamp reads as a source at frame scale.** The pool is visible in front of the hut
(a bright patch at the wall's base, falling off toward the camera), the bracket's
post and arm are visible at 4x, and the hut is a lit object in a cold blue yard. The
warm/cold punctuation is there. But the wall's lit area is too large and too uniform:
it reads as a lit slab, not as structured apertures on a cold mass.

## (c) The count, against PART 13's acceptance

PART 13's acceptance: **a source-lit patch of ground below the horizon — a warm/light
value break with a measured location and a counted warm area, not a threshold argument
— plus a control frame that shows no new pool.**

| criterion | result |
|---|---|
| source-lit patch below the horizon | **met.** Pool at x 1317-1527, y 721-748, 2,927 px on a 3,364-px warm-leaning patch; lamp contributes ~70-80 % of the brightening (radial transect, §(a)). |
| measured location | **met.** x 1317-1527, y 721-748, peak at (1422, 723), max R-B +59 at (1447, 723). |
| counted warm area | **met.** 10,526 warm px (6 components, largest 10,516 px, bbox x 1300-1599, y 720-759) against 1 px before; max R-B +18 → +59. |
| control frame, no new pool | **met.** Pose 16: warm 0.115 % → 0.115 % (±0.000), warm-bright 0.016 % → 0.016 %. Pose 18: warm 1.335 % → 1.340 % (+0.004), warm-bright 0.233 % → 0.238 % (+0.006). No new pool, no flood. |
| no clipping | **met.** Max R 214 in the wall band, 0 px ≥ 248 at any intensity tested (6.6, 8.8, 17.6). |
| tier verified | **met.** 08-03-24 is tier medium, 1600×900, fov 1.07542. 08-12-59 (17.6×) is tier low and was excluded. |

**The acceptance is met at 6.6.** The pool is source-lit: the lamp contributes ~70-80 %
of the pool's brightening (radial transect), the strict warm count went from 1 px to
10,526 px, and the control frames show no new pool. The lever (intensity 2.2 → 6.6)
worked for the pool.

**But the frame as a whole does not read as section B.** The wall is over-lit: 79 % warm,
a broad pale-tan slab with a brighter band, the largest lit area in the frame. Section B's
reference (frame 3) carries warm as small apertures (window panes, porch lamps, one red
cable car) on a large cold dark mass. The wall at 6.6 is the opposite: a large warm mass
with small dark bands. The warm/cold punctuation is there (the hut is a lit object in a
cold blue yard), but the wall's scale and uniformity are wrong for the section.

The acceptance is met; the frame is not. The verdict is **more work needed**, not because
the pool failed but because the wall is a slab and the frame does not read as section B.

## (d) Controls

| pose | warm (before → after) | warm-bright | note |
|---|---|---|---|
| 16-fall-wreck-up | 0.115 % → 0.115 % (±0.000) | 0.016 % → 0.016 % | flat, no new pool |
| 17-fall-piles-level | 0.287 % → 0.293 % (+0.007) | 0.001 % → 0.001 % | crowd drift |
| 18-fall-skyline | 1.335 % → 1.340 % (+0.004) | 0.233 % → 0.238 % (+0.006) | zone's other lamps register slightly |
| 19-fall-pile-close | 2.076 % → 2.077 % (+0.001) | 0.057 % → 0.057 % | flat |
| 20-fall-ground-level | 3.015 % → 5.903 % (+2.888) | 0.517 % → 0.763 % | the pool |

16 and 18 show no new pool. 17 and 19 are noon frames 150 m above the low. Pose 20's
own +2.888 pp is the pool.

## (e) Cost

| pose | error | held fov | lights del/binned/starved | g-buffer triangles | frameMs |
|---|---|---|---|---|---|
| 16 | null | 1.01078 | 1222 / 1222 / 0 | 1,070,700 | 133.26 |
| 17 | null | 1.07012 | 1133 / 1133 / 0 | 944,022 | 137.80 |
| 18 | null | 1.04782 | 1405 / 1405 / 0 | 1,295,026 | 132.02 |
| 19 | null | 1.06973 | 1133 / 1133 / 0 | 2,027,940 | 139.80 |
| 20 | null | 1.07542 | 1133 / 1133 / 0 | 1,328,996 | 139.86 |

No GPU/WGSL error. Lights unchanged (1222/1133/1405/1133/1133, starved 0). G-buffer
triangles identical to the pre-3l run to the digit. The change is a number in a light,
not geometry. The harness's frame times (132-140 ms) are a headless artefact; D32's 30 fps
floor is not testable here.

## (f) What this round establishes, and what it does not

- **Establishes:** the pool is source-lit. The lamp contributes ~70-80 % of the pool's
  brightening (radial transect, §(a)), the strict warm count went from 1 px to 10,526 px,
  and the control frames show no new pool. PART 13's acceptance is met at 6.6.
- **Establishes:** the second reading's 15-25 % figure was wrong. It measured on the
  lateral (x) axis, which cannot separate a pool from a flat lift. The radial (y) axis
  shows the lamp is the dominant cause. The 15-25 % figure is annotated as wrong in
  PART 17 (see the note appended below).
- **Establishes:** the "flat wash" claim is withdrawn. At full frame scale the hut reads
  as a lit object with a pool in front of it, and the lamp is legible as the source.
- **Establishes:** no clipping at any intensity tested (6.6, 8.8, 17.6). The wall's max R
  is 214, 0 px ≥ 248. The tonemap's shoulder is the binding constraint, not the wall.
- **Establishes:** the controls hold (16 flat, 17/18/19 within 0.03 pp).
- **Does not establish** the frame as reading like section B. The wall is a warm slab
  (79 % warm, (93, 72, 56), max R 153) with a brighter band, not the small apertures on
  a cold dark mass that section B's reference carries. The warm/cold punctuation is there
  but the wall's scale and uniformity are wrong.
- **Does not establish** the water's specular (PART 10's deferred clause, still refuted
  as a roughness route by FLOODED_LOWS_SPIKE.md).
- **Does not re-judge** round 3g's lit-row count (5 of 6, closed separately), the ground
  pass, the lifelines, the rubble, or pose 19's band.
- **Does not establish** the read. Whether the pool reads as a work lamp's pool or as an
  over-lit warm sheet is a judgement on the frame, and it is the reviewer's.

**One next change, not three.** Reduce the wall's lit area or add structure to it
(windows, panels, a soffit) so it reads as structured apertures on a cold mass, not as a
slab. Do not reduce the lamp — that kills the pool. The bracket, the material, and the
lamp's intensity are settled. The specular clause (PART 10) stays deferred.

---

## (g) Annotation of PART 17's second-reading (the 15-25 % figure)

PART 17's second reading concluded that the lamp contributed only 15-25 % of the visible
change, and that the floor was "paint with a lamp tint." **That figure is wrong.** It was
measured on the lateral (x) axis, which cannot separate a pool from a flat lift because
the strip is narrow inside the pool's 3.18 m disc (every column is inside the disc, so
the lateral transect varies distance by only 1-1.5 m). The radial (y) transect in §(a)
shows the lamp contributes roughly 70-80 % of the pool's brightening: +40 to +52 luma at
the pool (y 720-759) against +10 to +12 luma on the wall above (y 690-719), which is
the same material outside the pool. The 15-25 % figure should be disregarded. PART 17's
other measurements (location, bbox, max R-B, warm-leaning count, controls) are
reproduced and stand.
