/**
 * Yard census for the ground-place round (protocol: measure before designing).
 *
 *   npx --yes vite-node@6.0.0 src/render/__probe_yard20.ts
 *
 * Pose 20's frustum is the frame the ground pass has never been judged in. This
 * probe walks the zone's own placement grammar — fallground.ts mirrored draw for
 * draw, plus the wreck, the patches and their pools — and reports everything the
 * grammar places inside or near the frame: lifeline lamps, kit, heaps, drums,
 * wreck pieces, flooded patches, pools. Each with distance, depth and the screen
 * position it projects to. No meshes, no lights, no renderer: pure placement.
 */

import { cityPlan, GROUND_Y } from '../world/citygen';
import { fallZone, fallChunk } from '../world/fallzone';
import { makeRng } from '../core/math';

const SEED = 6191639;
const CHUNK = 256;
const SALT = 0x6f7264; // 'ord' — fallground.ts's own stream

/** Pose 20 as capture.mjs defines it (round 3d re-derived, POSE20_FIX.md). */
const EYE: [number, number, number] = [558.1, 2.1, -452.4];
const TGT: [number, number, number] = [471.1, 19.7, -501.8];
const VFOV = 1.1; // rad, vertical, capture.mjs fov
const ASPECT = 1600 / 900;
const vT = Math.tan(VFOV / 2);
const hT = vT * ASPECT;

const fwd = norm3([TGT[0] - EYE[0], TGT[1] - EYE[1], TGT[2] - EYE[2]]);
const rightVec = norm3(cross3(fwd, [0, 1, 0]));
const upVec = cross3(rightVec, fwd);

interface Hit {
  kind: string;
  note?: string;
  p: [number, number, number];
  warm?: boolean;
}
const hits: Hit[] = [];

function place(x: number, z: number, y: number, kind: string, note?: string, warm = false): void {
  hits.push({ kind, note, p: [x, y, z], warm });
}

const frameOf = (yaw: number) => {
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  return { at: (x: number, z: number, a: number, b: number): [number, number] => [x + ca * a + sa * b, z - sa * a + ca * b] };
};

const zone = fallZone(cityPlan(SEED).seed);

// Chunk cells that can hold anything within ~220 m of the eye.
const c0x = Math.floor((EYE[0] - 240) / CHUNK), c1x = Math.floor((EYE[0] + 240) / CHUNK);
const c0z = Math.floor((EYE[2] - 240) / CHUNK), c1z = Math.floor((EYE[2] + 240) / CHUNK);
const near = (x: number, z: number): boolean => Math.hypot(x - EYE[0], z - EYE[2]) < 230;

const columnsSeen = new Set<number>();
for (let cx = c0x; cx <= c1x; cx++) {
  for (let cz = c0z; cz <= c1z; cz++) {
    const fall = fallChunk(zone, cx * CHUNK, cz * CHUNK, CHUNK);
    const f = frameOf(fall.yaw);
    let winches = 0;
    for (const c of fall.columns) {
      if (!near(c.x, c.z)) continue;
      columnsSeen.add(c.id);
      place(c.x, c.z, GROUND_Y, `column ${c.kind}`, `id${c.id} access=${c.access} halfX ${c.halfX.toFixed(1)} halfZ ${c.halfZ.toFixed(1)} pile ${c.pileBase.toFixed(1)}-${c.pileTop.toFixed(1)}`);
      if (c.access === 'none') continue;
      // B kit — mirrored from pushBKit, draw for draw.
      const r = makeRng(c.seed ^ SALT);
      const items = 3 + r.int(0, 2);
      let barrel = 0, pallet = 0, drum = 0;
      for (let k = 0; k < items; k++) {
        const [px, pz] = f.at(c.x, c.z, r.range(-c.halfX - 1.2, c.halfX + 1.2), c.halfZ + r.range(1.2, 2.4));
        const kind = r.int(0, 2);
        if (kind === 0) { barrel++; place(px, pz, GROUND_Y + 0.45, 'kit barrel', `id${c.id}`); }
        else if (kind === 1) { pallet++; if (r.bool(0.5)) r.next(); place(px, pz, GROUND_Y + 0.2, 'kit pallet', `id${c.id}`); }
        else { drum++; place(px, pz, GROUND_Y + 0.55, 'kit cable-drum', `id${c.id}`); }
      }
      if (c.access === 'stair-tower') {
        const height = Math.min(14, Math.max(6, c.pileBase - GROUND_Y));
        const [dx, dz] = f.at(c.x, c.z, 0, c.halfZ + 1.7);
        place(dx, dz, GROUND_Y + height - 0.9, 'lamp stair-tower', `id${c.id}`, true);
      } else if (c.access === 'winch') {
        const workshop = winches % 3 === 1;
        winches++;
        if (!workshop) {
          const b0 = c.halfZ + 2.9;
          const [hx, hz] = f.at(c.x, c.z, 0, b0);
          place(hx, hz, GROUND_Y + 1.35, 'winch hut', `id${c.id}`);
          const [sx, sz] = f.at(c.x, c.z, 3.6, b0 - 0.4);
          place(sx, sz, GROUND_Y + 0.55, 'winch drum', `id${c.id}`);
          const [lx, lz] = f.at(c.x, c.z, 0, b0 + 2.2);
          place(lx, lz, GROUND_Y + 3.4, 'lamp winch-host', `id${c.id} (bracket)`, true);
        } else {
          const b0 = c.halfZ + 3.8;
          const [hx, hz] = f.at(c.x, c.z, 0, b0);
          place(hx, hz, GROUND_Y + 1.7, 'workshop hut', `id${c.id}`);
          const rh = makeRng(c.seed ^ (SALT + 1));
          for (let k = 0; k < 3; k++) {
            const [px, pz] = f.at(c.x, c.z, -2.4 + k * 2.4 + rh.jitter(0.4), b0 + 3.2 + rh.jitter(0.5));
            rh.next();
            place(px, pz, GROUND_Y + 0.6, 'heap', `id${c.id} #${k}`);
          }
          const [lx, lz] = f.at(c.x, c.z, 1.2, b0 + 2.75);
          place(lx, lz, GROUND_Y + 4.1, 'lamp workshop', `id${c.id} (bracket)`, true);
          r.next(); r.next(); r.next(); r.next(); // keep streams honest if ever reused
        }
      } else if (c.access === 'core-stair') {
        const [dx, dz] = f.at(c.x, c.z, 0, c.halfZ + 0.9);
        place(dx, dz, GROUND_Y + 3.1, 'lamp core-stair', `id${c.id}`, true);
      }
    }
    for (const s of fall.stations) {
      if (!near(s[0], s[2])) continue;
      const [hx, hz] = f.at(s[0], s[2], 0, 3.6);
      place(hx, hz, GROUND_Y + 3.4, 'lamp ropeway station', '', true);
    }
    for (const w of fall.wreck) {
      if (!near(w.x, w.z)) continue;
      place(w.x, w.z, w.y, `wreck ${w.kind}`, `yaw ${w.yaw.toFixed(2)} tilt ${w.tilt.toFixed(2)} half ${w.halfX.toFixed(1)}/${w.halfY.toFixed(1)}/${w.halfZ.toFixed(1)}`);
    }
    for (const p of fall.patches) {
      if (!near(p.x, p.z)) continue;
      place(p.x, p.z, GROUND_Y, `patch ${p.kind}`, `half ${p.halfX.toFixed(1)}x${p.halfZ.toFixed(1)}`);
      if (p.kind !== 'flooded') continue;
      // Pools — mirrored from fallmesh's formula (check20.ts, same draws).
      const r = makeRng((Math.round(p.x * 32) * 73856093) ^ (Math.round(p.z * 32) * 19349663) ^ 0x5eed);
      const pools = 6 + r.int(0, 2);
      const ca = Math.cos(fall.yaw), sa = Math.sin(fall.yaw);
      const at = (a: number, b: number): [number, number] => [p.x + ca * a + sa * b, p.z - sa * a + ca * b];
      for (let k = 0; k < pools; k++) {
        const a0 = r.range(-0.72, 0.72) * p.halfX, b0 = r.range(-0.72, 0.72) * p.halfZ;
        const rad = Math.min(4 + r.next() * 7, Math.max(2.5, Math.min(p.halfX, p.halfZ) * 0.24));
        for (let i = 0; i < 4; i++) { r.next(); r.next(); }
        const [x, qz] = at(a0, b0);
        place(x, qz, GROUND_Y + 0.075, 'pool', `r ${rad.toFixed(1)} m`);
      }
      // Two runnels also cross each flooded patch (fallmesh); their read is a
      // thin light streak, noted in the doc, not a census point.
    }
  }
}

console.log(`GROUND_Y ${GROUND_Y}  eye ${EYE.join(',')}  fwd ${fwd.map((v) => v.toFixed(3)).join(',')}  vT ${vT.toFixed(3)} hT ${hT.toFixed(3)}`);
console.log(`citywide: columns ${zone.columns.length}, wreck ${zone.wreck.length} (slab ${zone.wreck.filter((w) => w.kind === 'slab').length} / body ${zone.wreck.filter((w) => w.kind === 'body').length}), patches ${zone.patches.length} (flooded ${zone.patches.filter((p) => p.kind === 'flooded').length})`);
const rows: { depth: number; line: string }[] = [];
for (const h of hits) {
  const d = Math.hypot(h.p[0] - EYE[0], h.p[1] - EYE[1], h.p[2] - EYE[2]);
  const dx = h.p[0] - EYE[0], dy = h.p[1] - EYE[1], dz = h.p[2] - EYE[2];
  const depth = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
  rows.push({ depth, line: fmt(h, d) });
}
const sorted = rows.filter((r) => r.depth > 0.5).sort((a, b) => a.depth - b.depth);
console.log(`\n== IN/NEAR FRUSTUM (depth 0.5-230 m): ${sorted.length} placed items from ${columnsSeen.size} zone columns; warm sources total ${hits.filter((h) => h.warm).length} ==`);
for (const r of sorted) console.log(`  ${r.line}`);
console.log(`\n== WARM SOURCES AT ANY BEARING within 230 m ==`);
// Re-emit warm hits sorted by distance with their screen state
for (const h of hits.filter((h) => h.warm)) {
  const d = Math.hypot(h.p[0] - EYE[0], h.p[1] - EYE[1], h.p[2] - EYE[2]);
  const dx = h.p[0] - EYE[0], dy = h.p[1] - EYE[1], dz = h.p[2] - EYE[2];
  const depth = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
  const x = (dx * rightVec[0] + dy * rightVec[1] + dz * rightVec[2]) / Math.max(depth, 0.5);
  const y = (dx * upVec[0] + dy * upVec[1] + dz * upVec[2]) / Math.max(depth, 0.5);
  const inside = depth > 0.5 && Math.abs(x) <= hT && Math.abs(y) <= vT;
  console.log(`  ${fmt(h, d)}  frustum ${inside ? 'IN' : 'out'}`);
}

function fmt(h: Hit, d: number): string {
  const dx = h.p[0] - EYE[0], dy = h.p[1] - EYE[1], dz = h.p[2] - EYE[2];
  const depth = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
  const x = (dx * rightVec[0] + dy * rightVec[1] + dz * rightVec[2]) / Math.max(depth, 0.5);
  const y = (dx * upVec[0] + dy * upVec[1] + dz * upVec[2]) / Math.max(depth, 0.5);
  const inside = depth > 0.5 && Math.abs(x) <= hT && Math.abs(y) <= vT;
  const sx = 800 + (x / hT) * 800;
  const sy = 450 - (y / vT) * 450;
  return `${h.kind.padEnd(24)} ${h.note ?? ''} | d ${d.toFixed(1).padStart(6)} depth ${depth.toFixed(1).padStart(6)} | ${inside ? `px (${sx.toFixed(0)},${sy.toFixed(0)})` : 'out of frame'}`;
}

function norm3(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
