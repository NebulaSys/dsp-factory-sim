/**
 * Is `tail[1]` a group boundary?
 *
 * `tail[1]` equals `buildingCount - 1` for most of the corpus, which on its own is ambiguous —
 * it could be "last index overall" or "last index of this building's group". The stacked solar
 * blueprints break the tie: there it takes values like 1084 / 1627 / 2170 with the same count
 * each, which looks like cumulative layer boundaries.
 *
 * This checks `tail[1]` against, for each building, the max index within its own area.
 *
 *   node --experimental-strip-types tools/probe-v1-tail1-group.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = resolve(ROOT, 'docs/research/_raw/realbp');

let sameArea = 0;
let globalMax = 0;
let neither = 0;
let total = 0;
const counterExamples: string[] = [];

for (const f of readdirSync(DIR).filter((x) => x.endsWith('.txt'))) {
  let bp;
  try {
    bp = await decodeBlueprint(readFileSync(resolve(DIR, f), 'utf8').trim());
  } catch {
    continue;
  }
  const bs = bp.body.buildings;

  // Max index seen per area.
  const maxByArea = new Map<number, number>();
  for (const b of bs) {
    maxByArea.set(b.areaIndex, Math.max(maxByArea.get(b.areaIndex) ?? -Infinity, b.index));
  }
  const globalLast = Math.max(...bs.map((b) => b.index));

  for (const b of bs) {
    if (!b.tail || b.tail.length < 2) continue;
    const v = b.tail[1]!;
    if (v < 0) continue; // -1 is a sentinel, not a boundary
    total++;
    const areaMax = maxByArea.get(b.areaIndex)!;
    if (v === areaMax) sameArea++;
    else if (v === globalLast) globalMax++;
    else {
      neither++;
      if (counterExamples.length < 25) {
        counterExamples.push(
          `${f.slice(0, 30).padEnd(32)} #${String(b.index).padStart(5)} area=${b.areaIndex} areaMax=${String(areaMax).padStart(5)} globalLast=${globalLast} tail[1]=${v}`,
        );
      }
    }
  }
}

console.log(`non-negative tail[1] values examined: ${total}\n`);
console.log(`  equals the max index within its own area : ${sameArea}  (${((sameArea / total) * 100).toFixed(1)}%)`);
console.log(`  equals the global last index             : ${globalMax}  (${((globalMax / total) * 100).toFixed(1)}%)`);
console.log(`  neither                                  : ${neither}  (${((neither / total) * 100).toFixed(1)}%)`);
console.log('');
console.log('counter-examples (neither):');
for (const c of counterExamples) console.log('  ' + c);
