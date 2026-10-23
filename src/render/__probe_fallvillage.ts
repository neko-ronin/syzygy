/**
 * Village round-0 cost probe (docs/FALL_VILLAGE_ROUND0.md, DESIGN §8).
 *
 *   npx --yes vite-node@6.0.0 src/render/__probe_fallvillage.ts
 *
 * Prints, over the fall-zone self-test's eight seeds: the pile triangle counts
 * per column kind at LOD 0 (real boxes) and at lod >= 2 (merged blocks with
 * their lit panes), the shaft+break counts per kind at LOD 0 (near detail) and
 * at lod >= 2 (the far silhouette — the band must still read broken), the
 * per-chunk LOD 0 triangles of every chunk that carries piles, the citywide
 * totals at both tiers, the crown lights the village registers at LOD 0 (one
 * per lit pile top, D28), and the bounds checks against the placement record —
 * the village against its pile extent, and the structural shaft, ground to
 * break, under its own contract. It answers determinism directly: the same
 * seed built twice must give identical counts and identical mesh bytes.
 */

// Enter the graph the way the LIVE APP does — citymesh reached first, before
// anything has fully evaluated it. Under the live app's entry the module cycle
// citymesh -> fallmesh -> fallvillage -> citymesh made a module-scope ROOMS
// read in fallvillage a temporal-dead-zone crash ("Cannot access 'ROOMS' before
// initialization"), while tsc, `vite build` and this probe's own entry order all
// passed. This line makes the probe exercise the hostile entry order, so the
// class of bug cannot pass here again.
import './citymesh';
import { GROUND_Y } from '../world/citygen';
import { fallChunk, fallZone, type FallChunk, type FallColumn } from '../world/fallzone';
import { MeshBuilder } from '../world/geometry';
import { pushColumn } from './fallcolumn';
import { pushFallVillage } from './fallvillage';
import { type ChunkLight, yawTiltBasis } from './fallmesh';
import type { Vec3 } from '../core/math';

const SEEDS = [0x5e7a17, 42, 7, 13, 99, 1234, 31337, 0xbeef]; // __selftest_fallzone's seeds
const CHUNK = 256, RAD = 6; // defaultCityConfig: chunkSize 256, radiusChunks 6

/** Village triangles for one column, alone on its own chunk. */
const pileTri = (seed: number, c: FallColumn, lod: number): number => {
  const zone = fallZone(seed);
  const mb = new MeshBuilder();
  pushFallVillage(mb, { yaw: zone.gridYaw, columns: [c], decks: [], bridges: [], patches: [], wreck: [], stations: [], salvage: null }, lod);
  return mb.triangleCount;
};

/** Shaft+break triangles for one column, drawn alone (the village is pileTri's). */
const colTri = (c: FallColumn, flat: [Vec3, Vec3, Vec3], lod: number): number => {
  const mb = new MeshBuilder();
  pushColumn(mb, c, flat, lod);
  return mb.triangleCount;
};

const main = (): void => {
  const kinds = ['pier', 'core', 'silo', 'stack', 'lattice', 'spire'] as const;
  for (const seed of SEEDS) {
    const zone = fallZone(seed);
    const label = (seed >>> 0).toString(16);
    console.log(`\nSEED ${label} — ${zone.columns.length} columns (${kinds.map((k) => zone.columns.filter((c) => c.kind === k).length).join(' ')})`);
    // per-kind pile triangles, LOD 0 detail vs merged blocks
    let cityLod0 = 0, cityFar = 0, chunkMax = 0, chunkMaxCx = 0, chunkMaxCz = 0, chunkN = 0, chunkSum = 0;
    for (const kind of kinds) {
      const cols = zone.columns.filter((c) => c.kind === kind);
      if (cols.length === 0) { console.log(`  ${kind} — none`); continue; }
      let lo0 = Infinity, hi0 = 0, sum0 = 0, loF = Infinity, hiF = 0, sumF = 0;
      for (const c of cols) {
        const t0 = pileTri(seed, c, 0), t2 = pileTri(seed, c, 2);
        sum0 += t0; lo0 = Math.min(lo0, t0); hi0 = Math.max(hi0, t0);
        sumF += t2; loF = Math.min(loF, t2); hiF = Math.max(hiF, t2);
      }
      console.log(`  ${kind} n=${cols.length} lod0 mean ${(sum0 / cols.length).toFixed(0)} [${lo0}..${hi0}]  merged mean ${(sumF / cols.length).toFixed(0)} [${loF}..${hiF}]`);
    }
    // per-kind shaft+break triangles: LOD 0 is the near detail, the lod >= 2
    // column is the far silhouette — round 2's brief says the band must still
    // read broken at distance, and this is the number that says a broken
    // silhouette survives the merge (a plain prism here means a chimney).
    const flat0 = yawTiltBasis(zone.gridYaw, 0);
    for (const kind of kinds) {
      const cols = zone.columns.filter((c) => c.kind === kind);
      if (cols.length === 0) { console.log(`  col ${kind} — none`); continue; }
      let lo0 = Infinity, hi0 = 0, sum0 = 0, loF = Infinity, hiF = 0, sumF = 0;
      for (const c of cols) {
        const t0 = colTri(c, flat0, 0), t2 = colTri(c, flat0, 2);
        sum0 += t0; lo0 = Math.min(lo0, t0); hi0 = Math.max(hi0, t0);
        sumF += t2; loF = Math.min(loF, t2); hiF = Math.max(hiF, t2);
      }
      console.log(`  col ${kind} n=${cols.length} lod0 mean ${(sum0 / cols.length).toFixed(0)} [${lo0}..${hi0}]  far silhouette mean ${(sumF / cols.length).toFixed(0)} [${loF}..${hiF}]`);
    }
    // per-chunk: the real call pattern is per-chunk, so cost lands there too.
    // The bounds sweep is the round's headless geometry check: nothing stands
    // outside the placement contract except the top kit (+7 m of antenna/tank:
    // a core's head-house roof can carry its antenna to pileTop + 6.4) and the
    // outrigger bracing hanging to 4.6 m under the overhang.
    let badBounds = 0;
    let colBad = 0; // the structural shafts — ground to break — get their own graded sweep below
    let lightSum = 0, lightMax = 0; // crown lights at lod 0 (one per lit pile top, D28)
    for (let cx = -RAD; cx <= RAD; cx++) {
      for (let cz = -RAD; cz <= RAD; cz++) {
        const fc: FallChunk = fallChunk(zone, cx * CHUNK, cz * CHUNK, CHUNK);
        if (fc.columns.length === 0) continue;
        const lights: ChunkLight[] = [];
        const mb = new MeshBuilder();
        pushFallVillage(mb, fc, 0, lights);
        const t0 = mb.triangleCount;
        const mb2 = new MeshBuilder();
        pushFallVillage(mb2, fc, 2);
        cityLod0 += t0; cityFar += mb2.triangleCount;
        chunkN++; chunkSum += t0;
        if (t0 > chunkMax) { chunkMax = t0; chunkMaxCx = cx; chunkMaxCz = cz; }
        lightSum += lights.length; lightMax = Math.max(lightMax, lights.length);
        const tol = 7.0, fl = 4.6, cant = 0.4; // kit above the crown, braces below it, round-off room in xz
        // Exact per-column verification, every column, every chunk — no union
        // gate to hide behind: round 0 checked the chunk's world AABB first
        // and attributed only when it tripped, and the union masked the
        // grammar escapes this round's sweep caught (radial stack containers,
        // ~5 m past the record). The bounds test is the round's headless
        // geometry check: nothing stands outside the placement contract except
        // the top kit (+7 m of antenna/tank; a core's head-house roof can
        // carry its antenna to pileTop + 6.4) and the outrigger bracing
        // hanging to 4.6 m under the overhang.
        for (const c of fc.columns) {
          const one = new MeshBuilder();
          pushFallVillage(one, { yaw: fc.yaw, columns: [c], decks: [], bridges: [], patches: [], wreck: [], stations: [], salvage: null }, 0);
          const om = one.build();
          const cg = Math.cos(fc.yaw), sg = Math.sin(fc.yaw);
          let top = -Infinity, low = Infinity, mx = 0, mbz2 = 0;
          for (let i = 0; i < om.positions.length; i += 3) {
            const dx = om.positions[i] - c.x, yv = om.positions[i + 1], dz = om.positions[i + 2] - c.z;
            if (yv > top) top = yv;
            if (yv < low) low = yv;
            const ga = Math.abs(dx * cg - dz * sg), gb = Math.abs(dx * sg + dz * cg);
            if (ga > mx) mx = ga;
            if (gb > mbz2) mbz2 = gb;
          }
          const dY = Math.max(top - (c.pileTop + tol), (c.pileBase - fl) - low);
          // Lattice columns: the registered pile extent is the cage INTERIOR
          // by design (pileOn: 0.85x of halfX, the slung boxes swing inside
          // the cage), so the graded bound there is the cage's own half —
          // boxes are held to the record by the grammar's own clamps, this
          // bound grades the whole column against the structure it sits on.
          const bx = c.kind === 'lattice' ? Math.max(c.pileHalfX, c.halfX) : c.pileHalfX;
          const bz = c.kind === 'lattice' ? Math.max(c.pileHalfZ, c.halfZ) : c.pileHalfZ;
          const dA = mx - (bx + cant), dB = mbz2 - (bz + cant);
          if (dY > 0 || dA > 0 || dB > 0) {
            badBounds++;
            console.log(`      OUT ${c.kind} ${c.id}: dY ${dY.toFixed(2)} dA ${dA.toFixed(2)} dB ${dB.toFixed(2)} (top ${(top - c.pileTop).toFixed(2)} base ${(c.pileBase - low).toFixed(2)} maxA ${mx.toFixed(1)} maxB ${mbz2.toFixed(1)})`);
          }
          // The structural shaft itself, ground to its break, under its own
          // contract — round 2 draws break grammar on it (sheared and cratered
          // tops, rebar, stains), so it needs its own graded arena, not the
          // village's pile record: it stands on the ground plain (pileBase can
          // sit 20+ m above it), its top is the break plane c.top and material
          // may reach +2.9 m above it (rebar, crown stubs), and in plan it is
          // held to the record the way its structure sits: the pile extent, or
          // for the interiored kinds the structure's own half — the lattice
          // adds its 0.8 m leg section, the spire's registered record is the
          // crater interior, so the tube's outer face grades it (same logic
          // as lattice: the grammar holds its own boxes inside the record,
          // the structure is what establishes the edge here). Both LOD tiers
          // are graded: the far silhouette must be broken AND inside bounds.
          for (const lod of [0, 2] as const) {
            const omb = new MeshBuilder();
            pushColumn(omb, c, flat0, lod);
            const og = omb.build();
            let otop = -Infinity, olow = Infinity, amax = 0, bmax = 0;
            for (let i = 0; i < og.positions.length; i += 3) {
              const dx = og.positions[i] - c.x, yv = og.positions[i + 1], dz = og.positions[i + 2] - c.z;
              if (yv > otop) otop = yv;
              if (yv < olow) olow = yv;
              const ga = Math.abs(dx * cg - dz * sg), gb = Math.abs(dx * sg + dz * cg);
              if (ga > amax) amax = ga;
              if (gb > bmax) bmax = gb;
            }
            const sbx = c.kind === 'lattice' ? Math.max(c.pileHalfX, c.halfX + 0.8) : Math.max(c.pileHalfX, c.halfX);
            const sbz = c.kind === 'lattice' ? Math.max(c.pileHalfZ, c.halfZ + 0.8) : Math.max(c.pileHalfZ, c.halfZ);
            const cdY = Math.max(otop - (c.top + 2.9), (GROUND_Y - 0.05) - olow);
            const cdA = amax - (sbx + cant), cdB = bmax - (sbz + cant);
            if (cdY > 0 || cdA > 0 || cdB > 0) {
              colBad++;
              console.log(`      OUT-COL lod${lod} ${c.kind} ${c.id}: dY ${cdY.toFixed(2)} dA ${cdA.toFixed(2)} dB ${cdB.toFixed(2)} (top ${(otop - c.top).toFixed(2)} low ${(GROUND_Y - olow).toFixed(2)} maxA ${amax.toFixed(1)} maxB ${bmax.toFixed(1)})`);
            }
          }
        }
      }
    }
    console.log(`  chunks with piles ${chunkN}, lod0 per-chunk mean ${(chunkSum / chunkN).toFixed(0)}, max ${chunkMax} (chunk ${chunkMaxCx},${chunkMaxCz})`);
    console.log(`  citywide at lod<2 ${cityLod0}, at lod>=2 ${cityFar}`);
    console.log(`  crown lights citywide at lod 0: ${lightSum} (max/chunk ${lightMax}; round 0 had none)`);
    console.log(`  bounds vs placement (tol y+7.0 / y-4.6 / xz cant 0.4): ${badBounds === 0 ? 'WITHIN' : `${badBounds} chunks outside`}`);
    console.log(`  shaft bounds vs structure record (y +2.9 / ground-0.05 / xz cant 0.4, lod 0 & 2): ${colBad === 0 ? 'WITHIN' : `${colBad} columns outside`}`);
    // determinism: the same chunk, rebuilt, must match bytes
    const fc = fallChunk(zone, 0, 0, CHUNK);
    const a = new MeshBuilder(), b = new MeshBuilder();
    pushFallVillage(a, fc, 0);
    pushFallVillage(b, fc, 0);
    const a2 = new MeshBuilder(), b2 = new MeshBuilder();
    for (const c of fc.columns) { pushColumn(a2, c, flat0, 0); pushColumn(b2, c, flat0, 0); }
    const eqFloats = (p: Float32Array, q: Float32Array): boolean => {
      if (p.length !== q.length) return false;
      for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return false;
      return true;
    };
    const same = a.triangleCount === b.triangleCount
      && eqFloats(a.build().positions, b.build().positions)
      && eqFloats(a.build().colors, b.build().colors);
    const sameCol = a2.triangleCount === b2.triangleCount
      && eqFloats(a2.build().positions, b2.build().positions)
      && eqFloats(a2.build().colors, b2.build().colors);
    console.log(`  determinism rebuild: village ${same ? 'IDENTICAL' : 'DIFFERS'} / shafts ${sameCol ? 'IDENTICAL' : 'DIFFERS'}`);
  }
  console.log('\nNOTE: village counts are the piles only; the shaft counts (col rows) are fallcolumn\'s — decks, wreck and stations are naïve volumes and stay out.');
};

main();
