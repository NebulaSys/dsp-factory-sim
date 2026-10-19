/**
 * Are the "dangling" reports real, or are they stacked sorters the geometry cannot see?
 *
 * verify-sorter-diagnostics.ts reports 137 supposedly-dangling sorters, all inside one
 * stacked blueprints. A false alarm on a normal build is worse than no diagnostic, so this dumps
 * exactly those sorters: their z, their arm, and what the classifier saw at each end.
 *
 *   node --experimental-strip-types tools/probe-dangling-sorters.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { convertBlueprint } from '../src/engine/factory.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')),
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/building-slots.json'), 'utf8')),
);

const zHist = new Map<string, number>();
const samples: string[] = [];
let n = 0;

for (const dir of ['docs/research/_raw/realbp', 'docs/research/_raw/realbp2']) {
  let names: string[] = [];
  try {
    names = readdirSync(resolve(ROOT, dir)).filter((f) => f.endsWith('.txt'));
  } catch {
    continue;
  }
  for (const f of names) {
    let bp;
    try {
      bp = await decodeBlueprint(readFileSync(resolve(ROOT, dir, f), 'utf8').trim());
    } catch {
      continue;
    }
    const model = convertBlueprint(data, bp);
    const byIndex = new Map(bp.body.buildings.map((b) => [b.index, b]));
    for (const node of model.nodes) {
      if (node.kind !== 'sorter') continue;
      if (node.armFromKind !== 'empty' && node.armToKind !== 'empty') continue;
      if (node.armEndUncertain) continue; // already excluded from the "broken" count
      n++;
      const b = byIndex.get(node.index)!;
      const key = `z=${b.z} z2=${b.z2}`;
      zHist.set(key, (zHist.get(key) ?? 0) + 1);
      if (samples.length < 10) {
        // how many other buildings share each end cell?
        const at = (x: number, y: number): number =>
          bp.body.buildings.filter((o) => o.index !== b.index && Math.abs(o.x - x) < 0.5 && Math.abs(o.y - y) < 0.5).length;
        samples.push(
          `    #${node.index} ${node.buildingKey}  arm=(${b.x},${b.y})->(${b.x2},${b.y2})` +
            `  ends=${node.armFromKind}/${node.armToKind}  z=${b.z}/${b.z2}` +
            `  stackedAtEnds=${at(b.x, b.y)}/${at(b.x2, b.y2)}  yaw=${b.yaw}`,
        );
      }
    }
  }
}

console.log(`sorters counted as "broken" (not stacked by z): ${n}\n`);
console.log('=== their z values ===');
for (const [k, v] of [...zHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${String(v).padStart(5)}  ${k}`);
}
console.log('\n=== samples ===');
for (const s of samples) console.log(s);
console.log('\n=== reading ===');
console.log('  If z is 0 for all of them and the end cells are otherwise occupied by stacked');
console.log('  buildings, the uncertainty rule needs to look at cell occupancy, not just z.');
