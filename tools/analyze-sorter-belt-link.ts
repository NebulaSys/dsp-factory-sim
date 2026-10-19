/**
 * A sorter's link points at a belt. WHICH belt end?
 *
 * analyze-port-links-by-owner.ts shows the link fields are far more specific than they looked when
 * pooled: ONLY belts and sorters write them. A sorter's target is always a belt (2390 / 2390), a
 * belt's target is always a power building (1152 / 1152), and every machine category writes nothing
 * at all. So the port->sorter attachment the game uses is NOT serialised — it is rebuilt from
 * geometry, which is exactly what makes an editor feasible.
 *
 * The remaining question an editor must answer is how to compute the sorter->belt pointer. A sorter
 * record already carries two anchors (the ends of its arm), so this measures the target belt against
 * each end separately: a clean answer here means the editor can derive the field from placement.
 *
 *   node --experimental-strip-types tools/analyze-sorter-belt-link.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';

const ROOT = resolve(import.meta.dirname, '..');
const SORTER = new Set([2011, 2012, 2013, 2014]);
const BELT = new Set([2001, 2002, 2003]);

let n = 0;
let nearOwn = 0;
let nearFar = 0;
let nearEither = 0;
const armDist: number[] = [];
const dOwn: number[] = [];
const dFar: number[] = [];

const samples: string[] = [];
const twoAnchor = { same: 0, differ: 0 };

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
    const byIndex = new Map(bp.body.buildings.map((b) => [b.index, b]));
    for (const b of bp.body.buildings) {
      if (!SORTER.has(b.itemId)) continue;
      if (b.x2 === b.x && b.y2 === b.y) twoAnchor.same++;
      else twoAnchor.differ++;
      const arm = Math.hypot(b.x2 - b.x, b.y2 - b.y);
      // Only real arms: the two anchors are the arm ends.
      if (arm < 0.5 || arm > 3.05) continue;
      for (const v of [b.outputObjectIndex, b.inputObjectIndex]) {
        if (v === -1) continue;
        const t = byIndex.get(v);
        if (!t || !BELT.has(t.itemId)) continue;
        n++;
        // distance from the belt centre to each end of the arm
        const toOwn = Math.hypot(t.x - b.x, t.y - b.y);
        const toFar = Math.hypot(t.x - b.x2, t.y - b.y2);
        armDist.push(arm);
        dOwn.push(toOwn);
        dFar.push(toFar);
        if (toOwn <= 1.2) nearOwn++;
        if (toFar <= 1.2) nearFar++;
        if (Math.min(toOwn, toFar) <= 1.2) nearEither++;
        if (samples.length < 6) {
          samples.push(
            `    sorter #${b.index} anchors (${b.x},${b.y}) -> (${b.x2},${b.y2})  arm=${arm.toFixed(2)}` +
              `  -> belt #${t.index} at (${t.x},${t.y})  toOwn=${toOwn.toFixed(2)} toFar=${toFar.toFixed(2)}`,
          );
        }
      }
    }
  }
}

const p = (arr: number[], q: number): string => {
  const s = arr.slice().sort((a, b) => a - b);
  return (s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? NaN).toFixed(2);
};

console.log(`sorter -> belt links with a real arm: ${n}\n`);
console.log('=== which end of the sorter arm is the belt on? ===');
console.log(`  within 1.2 cells of the OWN anchor (x,y)     : ${nearOwn}  (${((nearOwn / n) * 100).toFixed(1)}%)`);
console.log(`  within 1.2 cells of the OTHER anchor (x2,y2) : ${nearFar}  (${((nearFar / n) * 100).toFixed(1)}%)`);
console.log(`  within 1.2 cells of EITHER anchor            : ${nearEither}  (${((nearEither / n) * 100).toFixed(1)}%)`);
console.log('\n=== distances (belt centre to arm end) ===');
console.log(`  to own anchor : p10=${p(dOwn, 0.1)} p50=${p(dOwn, 0.5)} p90=${p(dOwn, 0.9)}`);
console.log(`  to other      : p10=${p(dFar, 0.1)} p50=${p(dFar, 0.5)} p90=${p(dFar, 0.9)}`);
console.log('\n=== sorter arm lengths actually seen ===');
console.log(`  p10=${p(armDist, 0.1)} p50=${p(armDist, 0.5)} p90=${p(armDist, 0.9)}`);

console.log('\n=== do v2 sorter records carry two DISTINCT anchors at all? ===');
console.log(`  x2,y2 == x,y : ${twoAnchor.same}`);
console.log(`  x2,y2 != x,y : ${twoAnchor.differ}`);
console.log('  (if they are equal, the "other end of the arm" is not in the record and the');
console.log('   identical toOwn/toFar distributions above are explained — both measure one point)');

console.log('\n=== samples ===');
for (const s of samples) console.log(s);

console.log('\n=== what this means for an editor ===');
if (nearEither > n * 0.9) {
  console.log('  The target belt sits at one end of the arm almost always:');
  console.log('  the pointer is DERIVABLE from placement (pick the belt under an arm end).');
} else {
  console.log('  The target belt is NOT reliably at either arm end, so the pointer is not');
  console.log('  simply "the belt I am touching" — do not synthesise it without more evidence.');
}
