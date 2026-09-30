# Design

**The art direction, and the workflow for working to it.**

This document was missing. Districts existed as authored data with no design
intent recorded anywhere; the reference material had never been sampled
systematically; and every aesthetic judgement had been made against a single
frame. That is a workflow gap, not a reskin — the build is not wrong, it was
being steered by one image.

The machine-readable half of this is [`references/sections.json`](../references/sections.json)
— section definitions, the pose→section map, and the checks. `tools/compare.mjs
--auto` reads it. **Read both; this document is the reasoning, that file is the
contract.**

---

## 1. The target finish

> Overall the read is **painterly and graphic**, but detail must hold up at
> close focus, the way games and animated feature films manage it. Realistic
> materials are correct and wanted — they *read* as painterly when they are
> grouped by value, seen through atmosphere, softened by depth of field, and
> shaped by a single dominant light.

**"Hyperreal" in the brief means exaggerated and stylised, not photoreal.** That
is the human's reading of their own word, given explicitly. The brief pairs it
with "surreal proportions", which only makes sense in the exaggerated sense.

Three practical consequences:

1. **Detail budget goes to close range.** The reference material is rich at every
   scale, and the places we currently look cheapest are the near field. A
   facade needs to survive a 3 m inspection, not just a 400 m one.
2. **Value grouping before texture.** Painterly does not mean blurry. It means
   the eye reads large shapes and colour relationships first, with detail
   available on approach. Silhouette legibility is the test.
3. **PBR is not the aesthetic, it is the substrate.** The renderer's
   physically-based shading is the right tool for material honesty; the painterly
   read comes from the post chain, the lighting rig and the palette — not from
   throwing away the material model.

**The anti-homogenisation rule.** Every section is judged against its own
reference sheet. A single global reference would collapse four distinct places
into one look, and the brief explicitly requires that "large sections of the
city have differing styles and colors."

---

## 2. The four sections

Four sections from six videos. Detail, risks and districts live in
`references/sections.json`; the summary is:

| | Section | Videos | Reads as |
|---|---|---|---|
| **A** | saturated-graphic | 01, 05 | High-chroma colour blocking, hard warm/cool split, poster composition |
| **B** | cold-industrial | 02, 04 | Near-monochrome steel blue, heavy fog, warmth only as emissive points |
| **C** | fire-lit | 03 | Amber-dominant, burning, smoke, vertical chaos |
| **D** | verdant-solarpunk | 09 + 2 stills | Warm daylight, heavy planting, timber, water, rooftop gardens |

**Build order: B → A → D → C.** B is the most common register in the reference
set and its target — red/orange emissive on steel blue — is measurable. C is last
because it is the one that is *not* a reskin (see §4).

---

## 3. The colour doctrine, which had never been read

`inspirations/metropolis/solarpunk-metropolis-*.jpg` are described in
`ORIGINAL_PROMPT.md` as the thing that "sets the colour doctrine". **No session
had ever opened them.** They were opened during the design pass, and they are the
most useful two images in the repository:

- **`solarpunk-metropolis-01`** — a verdant canyon from inside, at roughly
  third-storey height. Cream and white concrete terraces, warm timber soffits,
  palms and ferns on every balcony, skybridges at three or four levels, a canal
  below, warm shop light against cool shade, sunbeams in the haze.
- **`solarpunk-metropolis-02`** — a taller verdacy seen from above, with rust and
  terracotta roofs, timber skybridges, enormous vine curtains, flower boxes, a
  waterfall into a canal, and a blue city receding into the distance.

### A correction to something I asserted earlier

I claimed the district palettes had been "authored from imagination" because the
stills were never opened. **That was wrong, at least partly.** The existing
description for `verdant-canyon` reads "White concrete and warm timber, curtains
of vine, planters on every sill" — which is a close description of
`solarpunk-metropolis-01`. Whoever authored the districts **did** use these
stills. The error was mine, and it is exactly the kind of confident claim
`PROCESS.md` rule 6 exists to prevent.

What remains true: the *videos* went unused as a set, and the city was steered
by one night frame.

### What the stills say that the code does not

| Doctrine element | Status in the build |
|---|---|
| White/cream concrete + warm timber + terracotta roof | partially in `verdant-canyon`, `botanical-dome` |
| Water in the canyon — canals, waterfalls | **`bakeGround` builds a water mesh that `renderer.ts:400` discards** |
| Sunbeam volumetrics | **`godRays` is a weather field no shader reads** |
| Skybridges at several levels | present |
| Warm interior light against cool shade | not authored per-district |
| Camera *inside* the canyon at storey height | most of our poses are aerial or street |

---

## 4. District mapping — reskin versus new design

| Section | Districts | Nature |
|---|---|---|
| A | `neon-arcology`, `lantern-bazaar` | reskin: palette and saturation |
| B | `glass-foxholes`, `rust-hangars`, `canal-district` | reskin: palette, plus a real grammar change |
| C | `terracotta-tiers` | **new design, not a reskin** |
| D | `verdant-canyon`, `botanical-dome`, `canal-district` | mostly present; needs water and light |

**Section C cannot be reskinned.** No existing district is a ruin: there is no
soot, no collapse, no ember emissive, no smoke. A palette change to
`terracotta-tiers` will produce a warm district, not a burning one. Treat it as
new grammar when it is reached.

### A finding that should change the plan

`cableDensity` across the eleven districts is **anti-correlated with height**:

```
market-spine 1.95   lantern-bazaar 1.70   neon-arcology 1.10   verdant-canyon 1.00
canal 0.90  copper-stacks 0.80  glass-foxholes 0.70  monastery-spire 0.60
terracotta-tiers 0.50  rust-hangars 0.40  botanical-dome 0.30
```

The cableways run between the *low* pedestrian districts. The reference material
does the opposite: in all six videos, aerial ropeways strung between **tall**
buildings at altitude are the compositional subject. The most characteristic
feature of the reference is currently weighted backwards, and the fix is a
per-district number rather than new geometry.

### The pose that matters

`wide-skyline` and `aerial-top` are city-wide checks. A frame containing several
sections is the only place **homogenisation is visible**. If every section looks
good alone but the wide shot has become one uniform city, the sections have
failed. Judge these separately; no single sheet is their bar.

---

## 5. The workflow

```
1. READ the section sheet        references/<id>-sheet.jpg
2. CAPTURE the section's poses   node tools/capture.mjs --pose=<substr>
3. COMPARE against its own sheet node tools/compare.mjs --latest --auto
4. READ the grid, then READ it again
5. NAME the specific gap         "cable density", not "looks flat"
6. CHANGE one thing
7. RE-CAPTURE the same pose, re-compare
8. CHECK the city shot has not homogenised
9. CLOSE the task with a review agent   §6 — mandatory, not optional
```

Rules that matter, from experience in this project:

- **Never judge a pose against another section's reference.** Comparing a night
  frame to a daylight shot is a category error, and it is the single most
  expensive mistake available here. `--auto` exists to prevent it.
- **One change per iteration.** The comparison grid is only meaningful if the
  two columns differ by one thing.
- **Name the gap specifically.** "Cables are absent" is actionable. "It looks
  flat" is not, and it usually means several problems at once.
- **Check the artifact.** The grid can be produced and still be wrong — see
  `PITFALLS.md` §14 for a tool that exited 0 and rendered the wrong image.

---

## 6. Task close — the review gate

**No task ends without a vision agent making a final judgement and returning
`done` or `more work needed`.** Not "if there's time", not "as a self-check".
The gate is the task's definition of finished.

### Why a separate agent

The implementer cannot close its own task. The agent that made the change has an
incentive to read its own work as successful, and has the change in mind rather
than the frame. This is not a hypothetical: in this project an agent looked at
one reference frame, compared it against a shot of a different time of day, and
reported a confident conclusion. A different agent with the sheet and the grid in
front of it caught it in one exchange.

**The reviewer must not be the implementer.** If only one agent is available,
say so explicitly in the close-out rather than quietly self-reviewing.

### What the reviewer does

1. **Opens the section sheet**, then **the comparison grid**, then the `.txt`
   sidecar. All three, in that order. A review that skips the reference is a
   review of taste.
2. **Opens the before frame as well as the after.** The question is "did this
   help", which is only answerable against both.
3. **Judges against the done-when** of the roadmap item, not against a general
   impression. `ROADMAP.md` R11's done-when, for example, has two clauses and
   the second one — that a wide shot still reads as a city of different places —
   is the one that catches failure.
4. **Runs the city-wide check** for any change touching a section. One section
   can look correct while the city has quietly become one place.
5. **Returns a decision and, if not done, the next single change.**

### Required close-out

```
VERDICT:  done | more work needed
EVIDENCE: references/<id>-sheet.jpg, shots/compare/<stamp>.png (+ .txt)
JUDGED:   the specific thing this frames shows, in section vocabulary —
          palette, value structure, silhouette, base/podium, cable density,
          material read, atmospheric depth, human scale
GAP:      the one specific thing still wrong, or "none"
NEXT:     the single next change, or "none"
CONFIRMED:<the done-when clauses that are actually met, quoted>
```

### The rules that make the verdict mean something

- **"Looks good" is not a verdict.** It is the absence of one. A close-out that
  does not name the specific thing it judged has not been done.
- **`more work needed` is a normal, successful outcome.** It is what the gate is
  for. Closing a task on a verdict you do not believe is the only real failure.
- **The reviewer may reject a task that is technically complete.** The point of
  the gate is that "the code works" and "the frame is right" are different
  claims, and only the second one matters here.
- **If the reviewer and implementer disagree, the reviewer wins until proven
  otherwise.** When in doubt, look at the pixels again.

---

## 7. Agent roles

Two roles, and they are different jobs. Both must do the visual part.

### 3D artist agent — designing and building a section

1. Read `references/<id>-sheet.jpg` **first**, before reading any code. Look at
   it properly: palette, value structure, where the light comes from, what the
   eye is drawn to, what scale the detail is legible at.
2. Read the section's entry in `references/sections.json` for intent, form
   grammar and known risks.
3. Read `src/world/districts.ts` for the district being changed. Note the
   existing numbers — `greenery`, `cableDensity`, `gapBias`, `heightRange` — and
   which of them the section needs moved.
4. Change the district, then capture and compare per §5.
5. If the section needs something with no implementation, say so and add it to
   `COVERAGE.md` as a `PHANTOM` rather than implying it exists.

### Visual review agent — judging a result

1. **Open the reference sheet and the comparison grid. Both.** A review that
   skips the reference is a review of taste, not of the work.
2. Read the `.txt` sidecar beside the grid to know which section each row was
   judged against.
3. Judge the **specific** gap, in the vocabulary of the section — palette,
   value structure, silhouette, cable density, material read, atmospheric depth.
4. State the city-wide check separately: does a wide shot still read as a city
   of different places?
5. **Do not generalise from one frame.** That is how a whole project gets
   steered by a single night image; it has already happened here once.
6. If a claim cannot be supported by a frame, mark it as a hypothesis.

---

## 8. What is still missing

Honest inventory, so nobody mistakes absence for oversight:

- **Section C has no design.** It is a placeholder entry, not an intent.
- **No section has been built yet.** This document sets the target; the build is
  unchanged by it.
- **The `godRays` and water phantoms block sections B and D.** Both are
  `PHANTOM` rows in `COVERAGE.md`; both are load-bearing for the sections that
  want them.
- **The videos are not in git** (D22). The sheets and this manifest are what
  survives a clone. Re-derive frames from a working checkout if the sections
  need re-curating.
- **No close-focus capture pose exists.** The doctrine says detail must hold at
  3 m, and the closest pose we have is `01b-crowd-closeup` at 2.4 m in a
  non-verdant district. Add a per-section close pose as part of building it.
