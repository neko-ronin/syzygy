/**
 * Review poses for the fall zone (DESIGN §8), derived from the zone, not typed in:
 * run, then paste the printed objects into tools/capture.mjs.
 *
 *   npx --yes vite-node@6.0.0 src/world/__probe_fallzone.ts
 *
 * 16 stands in the wreck field and looks up at a knot of piles (frame 2's angle);
 * 17 stands ON the deck fragment and looks along it (frame 1); 18 frames the cleanest
 * stretch of the mid band (the layer between rust-hangars 26-92 m and downtown
 * 190-570 m); 19 stands 3 m off a pile's corner (the missing close-focus pose).
 *
 * Round 0 (vision review, 2026-10-20) re-derived all four. Every old rule was
 * measured against the frame it produced, and the fault is recorded at the rule
 * that caused it. The numbers in brackets are what the captured frame measured.
 *
 *  - 16 scored the knot by COUNT of piles in the cone, so the frame took the
 *    three furthest of them and left the rest sky. It now scores by ANGULAR
 *    MASS and aims at the village, not past it. [captured: 7 columns in frame,
 *    the three shafts filling the lower frame, the piles as thin dark caps]
 *  - 17 stood 45 m to the side of the deck fragment, which sees the deck EDGE
 *    ON: a plank, not a street. It now stands on the deck, clear of pier a's
 *    pile, and looks along it. [captured: deck 18% of frame width, 2 flat
 *    black boxes either side, 0 of the village legible]
 *  - 18 aimed at the closest pair of spire stumps from 900 m across the belt, so
 *    the 819 m heart towers stood 22.7 deg off the view axis and the band itself
 *    came to 1.3% of the frame, the largest pile 29 px tall. It now takes the
 *    stretch of the band with the lowest old city behind it and stands 300 m
 *    off it on the heart side, looking out over the low city.
 *  - 19 stood 4.1 m off the face of a flat box, dead on, so one untextured
 *    plane covered 63% of the frame (luma 22-55, no structure at all). It now
 *    stands off the pile's CORNER, so the frame holds an edge and two faces.
 */

import { cityPlan, GROUND_Y, sampleStreetPlan, defaultCityConfig, City, type StreetSample } from './citygen';
import { beltBand } from './districts';
import { fallZone, patchAt, type FallColumn } from './fallzone';

const SEED = 0x5e7a17;
const z = fallZone(SEED), plan = cityPlan(SEED), f = plan.districts;
const r1 = (v: number): number => Math.round(v * 10) / 10;
const pose = (name: string, label: string, position: number[], lookAt: number[], time: string, sky: string, fov = 1.05): string =>
  `  {\n    // Derived by src/world/__probe_fallzone.ts (seed 5e7a17).\n    name: '${name}',\n    label: '${label}',\n`
  + `    position: [${position.map(r1).join(', ')}], lookAt: [${lookAt.map(r1).join(', ')}], fov: ${fov}, roll: 0,\n`
  + `    time: '${time}',\n    weather: { sky: '${sky}', cloudCover: 0.35, haze: 0.3 },\n    lens: { fov: ${fov} },\n    settle: 30,\n  },`;

/** The DESIGN §8 band: a pile whose whole height sits between the hangars and downtown. */
const BAND_LO = 75, BAND_HI = 185;
const band = z.columns.filter((c) => c.pileBase >= BAND_LO && c.pileTop <= BAND_HI);
const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

// ---------------------------------------------------------------- the old city
// A band column only reads as a band if nothing taller stands behind it. That is
// a fact about the OLD city, so it has to be measured against the old city.
const city = new City(defaultCityConfig(SEED));
const old: { x: number; z: number; top: number }[] = [];
for (const chunk of city.chunksInRadius([0, 0, 0], 2600)) {
  for (const b of chunk.buildings) old.push({ x: b.position[0], z: b.position[2], top: b.aabbMax[1] });
}
console.log(`// zone: ${z.columns.length} columns, ${band.length} in the ${BAND_LO}-${BAND_HI} m band, ${old.length} old buildings`);

/** Distance from a column to the nearest old building taller than its pile. */
const clearOf = (c: FallColumn): number => {
  let d = Infinity;
  for (const b of old) {
    if (b.top <= c.pileTop) continue;
    const t = Math.hypot(b.x - c.x, b.z - c.z);
    if (t < d) d = t;
  }
  return d;
};

// ---------------------------------------------------------------- 16
// A street point in the deck band, outside the fences, whose knot of piles
// subtends the most ANGLE. The old rule counted piles, which put the three
// furthest ones in the frame and left the rest sky.
const s: StreetSample = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0 };
type Knot = { mass: number; x: number; z: number; ang: number; cols: FallColumn[] };
let best: Knot = { mass: -1, x: 0, z: 0, ang: 0, cols: [] };
for (let x = -1536; x < 1792; x += 6) {
  for (let q = -1536; q < 1792; q += 6) {
    if (beltBand(f, x, q) !== 1 || patchAt(z, x, q)) continue;
    if (sampleStreetPlan(plan, x, q, s).clearance > -2) continue;
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const cols = z.columns.filter((c) => {
        const d = Math.hypot(c.x - x, c.z - q);
        if (d < 20 || d > 170) return false;
        const off = Math.abs(Math.atan2(Math.sin(Math.atan2(c.z - q, c.x - x) - ang), Math.cos(Math.atan2(c.z - q, c.x - x) - ang)));
        return off < 0.5;
      });
      if (cols.length < 2) continue;
      let mass = 0;
      for (const c of cols) mass += 2 * Math.atan(Math.max(c.pileHalfX, c.pileHalfZ) / Math.hypot(c.x - x, c.z - q));
      if (mass > best.mass) best = { mass, x, z: q, ang, cols };
    }
  }
}
{
  // Aim at the village itself: the angular-mass centre of the knot, at the
  // mid-height of the piles, so the frame is piles and column, not empty sky.
  const camY = GROUND_Y + 1.7;
  const w = best.cols.map((c) => 2 * Math.atan(Math.max(c.pileHalfX, c.pileHalfZ) / Math.hypot(c.x - best.x, c.z - best.z)));
  const total = w.reduce((a, b) => a + b, 0);
  let ax = 0, az = 0, ay = 0;
  best.cols.forEach((c, i) => {
    const k = w[i] / total;
    ax += c.x * k; az += c.z * k; ay += ((c.pileBase + c.pileTop) / 2) * k;
  });
  console.log(`// 16: ${best.cols.length} piles, angular mass ${r1(best.mass * 180 / Math.PI)} deg, `
    + `nearest ${r1(Math.min(...best.cols.map((c) => Math.hypot(c.x - best.x, c.z - best.z))))} m, aim ${r1(Math.hypot(ax - best.x, az - best.z))} m out`);
  console.log(pose('16-fall-wreck-up', 'sheet B: the wreck field looking up at a knot of piles, dusk',
    [best.x, camY, best.z], [ax, ay, az], 'dusk', 'dusk'));
}

// ---------------------------------------------------------------- 17 and 19
// The deck fragment is a street in the sky (DESIGN §8): stand ON it and look
// along it. 45 m off its side saw it edge on, which is a plank.
const deck = [...z.decks].sort((p, q) => {
  const lp = Math.hypot(z.columns[p.a].x - z.columns[p.b].x, z.columns[p.a].z - z.columns[p.b].z);
  const lq = Math.hypot(z.columns[q.a].x - z.columns[q.b].x, z.columns[q.a].z - z.columns[q.b].z);
  return lq - lp;
})[0];
if (deck) {
  const a = z.columns[deck.a], b = z.columns[deck.b];
  const l = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (a.x - b.x) / l, uz = (a.z - b.z) / l;  // a -> b is the far end
  // Stand clear of a's own pile (its half-extent along the deck) but still on
  // the deck: 11 m past the pile, looking along the street to b's village.
  // Toward b, NOT away from it: `ux` runs b->a, so a + ux*stand puts the camera
  // off the far end of the deck with the whole of a's pile in its face, which
  // is what round 0's first re-derivation did (the pile then read as an
  // unsupported mass hanging in the sky).
  const stand = Math.max(a.pileHalfX, a.pileHalfZ) + 11;
  const sx = a.x - ux * stand, sz = a.z - uz * stand;
  console.log(`// 17: deck ${r1(l)} m at ${r1(deck.y)} m, width ${r1(deck.width)} m; standing ${r1(stand)} m from pier a (${r1(Math.max(a.pileHalfX, a.pileHalfZ))} m clear of its pile)`);
  console.log(pose('17-fall-piles-level', 'sheet B: standing on the deck fragment, looking along it, morning',
    [sx, deck.y + 1.7, sz], [b.x, deck.y + 9, b.z], 'morning', 'clear'));

  // 19: 3 m off the pile's CORNER, so the frame holds a vertical edge, two
  // faces and the sky, instead of one flat plane. The corner nearest the far
  // end of the deck is the one the camera can stand off and still be over it.
  const axw = [Math.cos(z.gridYaw), -Math.sin(z.gridYaw)];   // grid local x, world
  const azw = [Math.sin(z.gridYaw), Math.cos(z.gridYaw)];    // grid local z, world
  const cornerX = a.x + axw[0] * a.pileHalfX + azw[0] * a.pileHalfZ;
  const cornerZ = a.z + axw[1] * a.pileHalfX + azw[1] * a.pileHalfZ;
  const diag = Math.hypot(a.pileHalfX, a.pileHalfZ);
  const outX = (cornerX - a.x) / diag, outZ = (cornerZ - a.z) / diag;
  const off = 3;
  const camX = cornerX + outX * off, camZ = cornerZ + outZ * off;
  const lookY = a.pileBase + (a.pileTop - a.pileBase) * 0.45;
  console.log(`// 19: pile a ${r1(a.pileBase)}..${r1(a.pileTop)} m, corner at (${r1(cornerX)},${r1(cornerZ)}), standing ${off} m off it`);
  console.log(pose('19-fall-pile-close', 'sheet B: 3 m off a village pile corner, looking up its edge, noon',
    [camX, deck.y + 1.7, camZ], [cornerX - outX * 0.4, lookY, cornerZ - outZ * 0.4], 'noon', 'clear', 1.0));
} else {
  console.log('// 17 and 19: no deck fragment at this seed; derive them from the tallest pile instead.');
}

// ---------------------------------------------------------------- 18
// The mid band, as a band. The old rule aimed at the closest pair of spire
// stumps from 900 m across the belt: the 819 m heart towers stood 22.7 deg off
// the view axis, and the band came to 1.3% of the frame, its largest pile
// 29 px tall.
//
// Instead: take the stretch of the band with the lowest old city behind it,
// stand 300 m off it on the downtown side, and look OUT over the low city, so
// the band is read against the hangars and the sky rather than the towers.
{
  const ranked = band.map((c) => ({ c, clear: clearOf(c) })).sort((a, b) => b.clear - a.clear);
  const anchor = ranked[0].c;
  const cluster = ranked.filter((e) => e.clear >= ranked[0].clear * 0.6
    && Math.hypot(e.c.x - anchor.x, e.c.z - anchor.z) < 700).map((e) => e.c);
  const tx = cluster.reduce((a, c) => a + c.x, 0) / cluster.length;
  const tz = cluster.reduce((a, c) => a + c.z, 0) / cluster.length;
  const aimY = median(cluster.map((c) => c.pileTop));
  // Stand on the downtown side and look away from it: the background behind
  // the band is then the low city, not the 819 m heart.
  const heart = [Math.cos(f.downtownBearing) * 900, Math.sin(f.downtownBearing) * 900];
  let hx = heart[0] - tx, hz = heart[1] - tz;
  const hl = Math.hypot(hx, hz) || 1;
  hx /= hl; hz /= hl;
  const camX = tx + hx * 300, camZ = tz + hz * 300;
  const camY = median(cluster.map((c) => c.pileBase));

  // what the frame holds, measured
  const dir = Math.atan2(tz - camZ, tx - camX);
  const halfH = Math.atan(Math.tan(1.12 / 2) * (16 / 9));
  const inView = band.filter((c) => Math.abs(Math.atan2(c.z - camZ, c.x - camX) - dir) < halfH);
  const dists = inView.map((c) => Math.hypot(c.x - camX, c.z - camZ));
  const els = inView.map((c) => Math.atan2(c.pileTop - camY, Math.hypot(c.x - camX, c.z - camZ)));
  let bgMax = 0;
  for (const b of old) {
    const bd = Math.hypot(b.x - camX, b.z - camZ);
    if (bd < Math.min(...dists)) continue;
    if (Math.abs(Math.atan2(b.z - camZ, b.x - camX) - dir) > 0.05) continue;
    if (b.top > bgMax) bgMax = b.top;
  }
  console.log(`// 18: cluster of ${cluster.length} band columns around anchor id${anchor.id}, clearest ${r1(ranked[0].clear)} m`);
  console.log(`// 18: ${inView.length} band columns in frame, ${r1(Math.min(...dists))}..${r1(Math.max(...dists))} m, `
    + `band tops span ${r1((Math.max(...els) - Math.min(...els)) * 180 / Math.PI)} deg, tallest old building behind ${r1(bgMax)} m`);
  console.log(pose('18-fall-skyline', 'sheet B: the fall zone as a mid band on the skyline, dusk',
    [camX, camY, camZ], [tx, aimY, tz], 'dusk', 'dusk', 1.12));
}
