/**
 * Measures grid spacing from a REAL blueprint to sanity-check footprint data.
 *
 * The ground-truth fixture is a belt array, so consecutive belts in a straight run
 * sit exactly one grid cell apart — that pins the cell size in world units and
 * therefore what a "1x1" building looks like. The same blueprint's coordinate
 * spread also shows how tightly buildings pack.
 *
 *   node --experimental-strip-types tools/measure-footprints.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDataset } from '../src/engine/loader.ts';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')));

const FIX = resolve(ROOT, 'docs/research/_raw/reffix');
const REAL = resolve(ROOT, 'docs/research/_raw/realbp');

async function decodeFile(path: string) {
  const text = readFileSync(path, 'utf8');
  const decoded = await decodeBlueprint(text);
  return decoded.body;
}

/** Nearest grid delta between distinct positions on one axis. */
function minSpacing(values: number[]): number | null {
  const sorted = [...new Set(values.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  let best: number | null = null;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i]! - sorted[i - 1]!;
    if (d > 0.001 && (best === null || d < best)) best = d;
  }
  return best;
}

console.log('=== ground-truth blueprint (27 belts + other buildings) ===');
{
  const body = await decodeFile(resolve(FIX, 'blueprint.0.10.34.28326.txt'));
  const counts = new Map<string, number>();
  for (const b of body.buildings) {
    const key = data.buildingByIdOrUndefined(b.itemId)?.key ?? `#${b.itemId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  console.log('buildings:', [...counts.entries()].map(([k, v]) => `${k}x${v}`).join(', '));
  const belts = body.buildings.filter((b) => b.itemId > 2000 && b.itemId < 2010);
  console.log(`belts: ${belts.length}`);
  if (belts.length > 1) {
    console.log(`  min X spacing: ${minSpacing(belts.map((b) => b.x))}`);
    console.log(`  min Y spacing: ${minSpacing(belts.map((b) => b.y))}`);
    const xs = belts.map((b) => b.x).sort((a, b) => a - b);
    const ys = belts.map((b) => b.y).sort((a, b) => a - b);
    console.log(`  X range: ${xs[0]} .. ${xs[xs.length - 1]}  (${(xs[xs.length - 1]! - xs[0]!).toFixed(2)} wide over ${belts.length} belts)`);
    console.log(`  Y range: ${ys[0]} .. ${ys[ys.length - 1]}`);
  }
  // Are any two buildings' centres closer than one cell? That bounds the minimum
  // footprint (a 1x1 building is 1 cell wide, so centres differ by >= 1).
  let closest = Infinity;
  let pair: [string, string] | null = null;
  for (let i = 0; i < body.buildings.length; i++) {
    for (let j = i + 1; j < body.buildings.length; j++) {
      const a = body.buildings[i]!;
      const b = body.buildings[j]!;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0.001 && d < closest) {
        closest = d;
        pair = [data.buildingByIdOrUndefined(a.itemId)?.key ?? String(a.itemId), data.buildingByIdOrUndefined(b.itemId)?.key ?? String(b.itemId)];
      }
    }
  }
  console.log(`closest distinct building centres: ${closest.toFixed(3)} cells (${pair?.[0]} <-> ${pair?.[1]})`);
}

console.log('\n=== dataset footprints ===');
for (const key of ['ArcSmelter', 'AssemblingMachineMk1', 'AssemblingMachineMk3', 'ConveyorBeltMk1', 'SorterMk1', 'MatrixLab', 'WindTurbine', 'TeslaTower', 'MiningMachine', 'InterstellarLogisticsStation']) {
  const b = data.building(key);
  console.log(`  ${key.padEnd(30)} ${JSON.stringify(b?.footprint)}`);
}

console.log('\n=== real blueprint coordinate spread ===');
{
  const files = readdirSync(REAL).filter((f) => f.endsWith('.txt')).slice(0, 2);
  for (const f of files) {
    try {
      const body = await decodeFile(resolve(REAL, f));
      const xs = body.buildings.map((b) => b.x);
      const ys = body.buildings.map((b) => b.y);
      // Fractional coordinates reveal sub-cell placement resolution.
      const fractional = xs.filter((x) => Math.abs(x - Math.round(x)) > 0.02).length;
      console.log(
        `${f.slice(0, 34)}: n=${body.buildings.length} X ${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)} Y ${Math.min(...ys).toFixed(1)}..${Math.max(...ys).toFixed(1)} non-integer-x=${fractional}`,
      );
    } catch (err) {
      console.log(`${f.slice(0, 34)}: ${(err as Error).message.slice(0, 60)}`);
    }
  }
}
