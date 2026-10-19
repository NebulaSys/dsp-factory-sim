/**
 * Can the view resolve what a sorter is attached to at each end — from geometry alone?
 *
 * The corrected model says the machine<->port<->sorter attachment is NOT serialized; the game
 * rebuilds it from geometry. If that is true then the view can do the same, without any new
 * reverse engineering: take a sorter's two arm anchors and ask "what is standing at this cell?".
 *
 * That is the difference between today's drawing (a double-headed arrow, because the sign is
 * unknown) and a sorter that is known to serve a specific machine, or known to be dangling.
 *
 *   node --experimental-strip-types tools/analyze-sorter-attachment.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')),
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/building-slots.json'), 'utf8')),
);
const SORTER = new Set([2011, 2012, 2013, 2014]);
const BELT = new Set([2001, 2002, 2003]);
const fp = new Map(data.buildings.map((b) => [b.id, b.footprint]));

/** Is world point (px,py) inside the footprint box of building b? */
function inside(b: { x: number; y: number; itemId: number }, px: number, py: number): boolean {
  const f = fp.get(b.itemId) ?? { w: 1, h: 1 };
  return Math.abs(px - b.x) <= f.w / 2 + 0.01 && Math.abs(py - b.y) <= f.h / 2 + 0.01;
}

const endKind = new Map<string, number>();
const pairs = new Map<string, number>();
const IN_TOLERANCE = 0.34; // a sorter anchor sits on a grid line; accept the nearest cell

let sorters = 0;
let files = 0;

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
    files++;
    const bs = bp.body.buildings;
    for (const s of bs) {
      if (!SORTER.has(s.itemId)) continue;
      sorters++;
      const ends: string[] = [];
      for (const [ax, ay] of [
        [s.x, s.y],
        [s.x2, s.y2],
      ] as const) {
        let kind = 'empty';
        // nearest building whose footprint contains this point, excluding itself
        let best = Infinity;
        for (const o of bs) {
          if (o.index === s.index) continue;
          if (!inside(o, ax, ay)) continue;
          const d = Math.hypot(o.x - ax, o.y - ay);
          if (d < best) {
            best = d;
            kind = BELT.has(o.itemId) ? 'belt' : SORTER.has(o.itemId) ? 'sorter' : 'machine';
          }
        }
        // bend the anchor onto the nearest cell, since anchors sit on edges
        if (kind === 'empty') {
          for (const o of bs) {
            if (o.index === s.index) continue;
            if (Math.abs(o.x - ax) > IN_TOLERANCE && Math.abs(o.y - ay) > IN_TOLERANCE) continue;
            const d = Math.hypot(o.x - ax, o.y - ay);
            if (d <= 1.01 && d < best) {
              best = d;
              kind = BELT.has(o.itemId) ? 'belt~' : SORTER.has(o.itemId) ? 'sorter~' : 'machine~';
            }
          }
        }
        ends.push(kind);
        endKind.set(kind, (endKind.get(kind) ?? 0) + 1);
      }
      const key = [...ends].sort().join(' + ');
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  }
}

console.log(`files: ${files}  sorters: ${sorters}\n`);
console.log('=== what is at each sorter arm end? (geometry only, no link fields) ===');
let resolved = 0;
for (const [k, v] of [...endKind.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(7)}  ${((v / (sorters * 2)) * 100).toFixed(1).padStart(5)}%  ${k}`);
  if (!k.startsWith('empty')) resolved += v;
}
console.log(`\n  resolved to a building: ${resolved} / ${sorters * 2} ends (${((resolved / (sorters * 2)) * 100).toFixed(1)}%)`);

console.log('\n=== sorter end pairings (top 10) ===');
for (const [k, v] of [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${String(v).padStart(6)}  ${((v / sorters) * 100).toFixed(1).padStart(5)}%  ${k}`);
}

console.log('\n=== view impact ===');
console.log('  "machine + belt" pairings are the ones the production view cares about: they say');
console.log('  which machine a sorter serves and which belt it moves items to/from.');
