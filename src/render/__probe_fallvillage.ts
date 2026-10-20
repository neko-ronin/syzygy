/**
 * Village round-0 cost probe (docs/FALL_VILLAGE_ROUND0.md, DESIGN §8).
 *
 *   npx --yes vite-node@6.0.0 src/render/__probe_fallvillage.ts
 *
 * Prints, over the fall-zone self-test's eight seeds: the pile triangle counts
 * per column kind at LOD 0 (real boxes) and at lod >= 2 (merged blocks), the
 * per-chunk LOD 0 triangles of every chunk that carries piles, and the
 * citywide totals at both tiers. It also answers determinism directly: the
 * same seed built twice must give identical counts and identical mesh bytes.
 */

import { fallChunk, fallZone, type FallChunk, type FallColumn } from '../world/fallzone';
import { MeshBuilder } from '../world/geometry';
import { pushFallVillage } from './fallvillage';

const SEEDS = [0x5e7a17, 42, 7, 13, 99, 1234, 31337, 0xbeef]; // __selftest_fallzone's seeds
const CHUNK = 256, RAD = 6; // defaultCityConfig: chunkSize 256, radiusChunks 6

/** Village triangles for one column, alone on its own chunk. */
const pileTri = (seed: number, c: FallColumn, lod: number): number => {
  const zone = fallZone(seed);
  const mb = new MeshBuilder();
  pushFallVillage(mb, { yaw: zone.gridYaw, columns: [c], decks: [], bridges: [], patches: [], wreck: [], stations: [] }, lod);
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
    // per-chunk: the real call pattern is per-chunk, so cost lands there too.
    // The bounds sweep is the round's headless geometry check: nothing stands
    // outside the placement contract except the top kit (+7 m of antenna/tank:
    // a core's head-house roof can carry its antenna to pileTop + 6.4) and the
    // outrigger bracing hanging to 4.6 m under the overhang.
    let badBounds = 0;
    for (let cx = -RAD; cx <= RAD; cx++) {
      for (let cz = -RAD; cz <= RAD; cz++) {
        const fc: FallChunk = fallChunk(zone, cx * CHUNK, cz * CHUNK, CHUNK);
        if (fc.columns.length === 0) continue;
        const mb = new MeshBuilder();
        pushFallVillage(mb, fc, 0);
        const m = mb.build();
        const t0 = mb.triangleCount;
        const mb2 = new MeshBuilder();
        pushFallVillage(mb2, fc, 2);
        cityLod0 += t0; cityFar += mb2.triangleCount;
        chunkN++; chunkSum += t0;
        if (t0 > chunkMax) { chunkMax = t0; chunkMaxCx = cx; chunkMaxCz = cz; }
        let yHi = -Infinity, yLo = Infinity, xHi = -Infinity, xLo = Infinity, zHi = -Infinity, zLo = Infinity;
        for (const c of fc.columns) {
          // The pile's plan is a yawed rectangle: its world AABB is |hx cs| plus |hz sn| per axis.
          const cg = Math.abs(Math.cos(fc.yaw)), sg = Math.abs(Math.sin(fc.yaw));
          const exX = c.pileHalfX * cg + c.pileHalfZ * sg, exZ = c.pileHalfX * sg + c.pileHalfZ * cg;
          yHi = Math.max(yHi, c.pileTop); yLo = Math.min(yLo, c.pileBase);
          xHi = Math.max(xHi, c.x + exX); xLo = Math.min(xLo, c.x - exX);
          zHi = Math.max(zHi, c.z + exZ); zLo = Math.min(zLo, c.z - exZ);
        }
        const tol = 7.0, fl = 4.6, cant = 4.6; // kit above the crown, braces below it, cantilever past the extent
        if (m.boundsMax[1] > yHi + tol || m.boundsMin[1] < yLo - fl
          || m.boundsMax[0] > xHi + cant || m.boundsMin[0] < xLo - cant
          || m.boundsMax[2] > zHi + cant || m.boundsMin[2] < zLo - cant) {
          badBounds++;
          // Attribute: rebuild each column alone and test true grid-frame
          // extremes per vertex — the world AABB lies for any yawed pile.
          for (const c of fc.columns) {
            const one = new MeshBuilder();
            pushFallVillage(one, { yaw: fc.yaw, columns: [c], decks: [], bridges: [], patches: [], wreck: [], stations: [] }, 0);
            const om = one.build();
            const cg = Math.cos(fc.yaw), sg = Math.sin(fc.yaw);
            let top = -Infinity, low = Infinity, mx = 0, mbz = 0;
            for (let i = 0; i < om.positions.length; i += 3) {
              const dx = om.positions[i] - c.x, yv = om.positions[i + 1], dz = om.positions[i + 2] - c.z;
              if (yv > top) top = yv;
              if (yv < low) low = yv;
              const ga = Math.abs(dx * cg - dz * sg), gb = Math.abs(dx * sg + dz * cg);
              if (ga > mx) mx = ga;
              if (gb > mbz) mbz = gb;
            }
            const dY = Math.max(top - (c.pileTop + tol), (c.pileBase - fl) - low);
            const dA = mx - (c.pileHalfX + cant), dB = mbz - (c.pileHalfZ + cant);
            if (dY > 0 || dA > 0 || dB > 0) {
              console.log(`    OUT ${c.kind} ${c.id}: dY ${dY.toFixed(2)} dA ${dA.toFixed(2)} dB ${dB.toFixed(2)} (top ${(top - c.pileTop).toFixed(2)} base ${(c.pileBase - low).toFixed(2)} maxA ${mx.toFixed(1)} maxB ${mbz.toFixed(1)})`);
            }
          }
        }
      }
    }
    console.log(`  chunks with piles ${chunkN}, lod0 per-chunk mean ${(chunkSum / chunkN).toFixed(0)}, max ${chunkMax} (chunk ${chunkMaxCx},${chunkMaxCz})`);
    console.log(`  citywide at lod<2 ${cityLod0}, at lod>=2 ${cityFar}`);
    console.log(`  bounds vs placement (tol y+7.0 / y-4.6 / xz cantilever): ${badBounds === 0 ? 'WITHIN' : `${badBounds} chunks outside`}`);
    // determinism: the same chunk, rebuilt, must match bytes
    const fc = fallChunk(zone, 0, 0, CHUNK);
    const a = new MeshBuilder(), b = new MeshBuilder();
    pushFallVillage(a, fc, 0);
    pushFallVillage(b, fc, 0);
    const eqFloats = (p: Float32Array, q: Float32Array): boolean => {
      if (p.length !== q.length) return false;
      for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return false;
      return true;
    };
    const same = a.triangleCount === b.triangleCount
      && eqFloats(a.build().positions, b.build().positions)
      && eqFloats(a.build().colors, b.build().colors);
    console.log(`  determinism rebuild: ${same ? 'IDENTICAL' : 'DIFFERS'}`);
  }
  console.log('\nNOTE: counts are the village only; columns/decks/wreck stay fallmesh volumes.');
};

main();
