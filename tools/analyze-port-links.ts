/**
 * What are `outputObjectIndex` / `inputObjectIndex`, really?
 *
 * The user supplied the domain rule: most buildings expose several input/output PORTS, a port can
 * take an input- or an output-sorter, and stacking a building onto a Splitter turns the Splitter
 * into an extra port. That makes (`outputToSlot`, `outputObjectIndex`) a per-port reference to the
 * sorter standing on it — which is a very different claim from "a pointer to the belt line".
 *
 * The earlier measurement (0 / 2390 links land within 3 cells, p90 175 cells) argues against
 * "points at the sorter next door". This re-examines it under the port hypothesis:
 *
 *   1. Are the slot fields ever used, or are they all -1?
 *   2. When a link IS used, what kind of object does it point at (sorter / belt / machine)?
 *   3. How far away is it, and is it near the owner's FOOTPRINT rather than its centre?
 *   4. Does the sorter in between reference the building from its own side?
 *
 *   node --experimental-strip-types tools/analyze-port-links.ts
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
const SPLITTER = 2020;
const cat = new Map(data.buildings.map((b) => [b.id, b.category]));
const fp = new Map(data.buildings.map((b) => [b.id, b.footprint]));
const kindOf = (itemId: number): string =>
  SORTER.has(itemId) ? 'sorter' : BELT.has(itemId) ? 'belt' : itemId === SPLITTER ? 'splitter' : (cat.get(itemId) ?? 'unknown');

function distToBox(
  px: number,
  py: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): number {
  // distance from a point to an axis-aligned box centred at (bx,by)
  const hw = bw / 2;
  const hh = bh / 2;
  const dx = Math.max(0, Math.abs(px - bx) - hw);
  const dy = Math.max(0, Math.abs(py - by) - hh);
  return Math.hypot(dx, dy);
}

const DIRS = ['docs/research/_raw/realbp', 'docs/research/_raw/realbp2'];
const slotUsed = { outputToSlot: 0, inputFromSlot: 0, outputFromSlot: 0, inputToSlot: 0, outputOffset: 0, inputOffset: 0, records: 0 };
const linkTargetKind = new Map<string, number>();
const dists: number[] = [];
const selfLink = { bothWays: 0, oneWay: 0, none: 0 };
const sorterOnSplitter = { splitterOnSplitter: 0, splitterOnOther: 0 };
let files = 0;
let examined = 0;

for (const dir of DIRS) {
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
    const byIndex = new Map(bs.map((b) => [b.index, b]));
    for (const b of bs) {
      examined++;
      slotUsed.records++;
      if (b.outputToSlot !== -1) slotUsed.outputToSlot++;
      if (b.inputFromSlot !== -1) slotUsed.inputFromSlot++;
      if (b.outputFromSlot !== -1) slotUsed.outputFromSlot++;
      if (b.inputToSlot !== -1) slotUsed.inputToSlot++;
      if (b.outputOffset !== -1) slotUsed.outputOffset++;
      if (b.inputOffset !== -1) slotUsed.inputOffset++;

      for (const v of [b.outputObjectIndex, b.inputObjectIndex]) {
        if (v === -1) continue;
        const t = byIndex.get(v);
        if (!t) {
          linkTargetKind.set('out of range', (linkTargetKind.get('out of range') ?? 0) + 1);
          continue;
        }
        const k = kindOf(t.itemId);
        linkTargetKind.set(k, (linkTargetKind.get(k) ?? 0) + 1);
        const fpb = fp.get(b.itemId) ?? { w: 1, h: 1 };
        dists.push(distToBox(t.x, t.y, b.x, b.y, fpb.w, fpb.h));
        // does the target point back at us?
        const back = t.outputObjectIndex === b.index || t.inputObjectIndex === b.index;
        if (back) selfLink.bothWays++;
        else selfLink.oneWay++;
      }

      // splitter stacking: a Splitter shares its cell with something else
      if (b.itemId === SPLITTER) {
        const same = bs.filter((o) => o.index !== b.index && Math.abs(o.x - b.x) < 0.5 && Math.abs(o.y - b.y) < 0.5);
        if (same.length) sorterOnSplitter.splitterOnSplitter += same.length;
      }
    }
  }
}

dists.sort((a, b) => a - b);
const pct = (p: number): number => dists[Math.min(dists.length - 1, Math.floor(dists.length * p))] ?? NaN;

console.log(`files: ${files}  buildings: ${examined}\n`);

console.log('=== are the slot fields used at all? ===');
for (const [k, v] of Object.entries(slotUsed)) {
  if (k === 'records') continue;
  console.log(`  ${k.padEnd(16)} non -1: ${String(v).padStart(7)}  (${((v / slotUsed.records) * 100).toFixed(3)}%)`);
}

const totalLinks = [...linkTargetKind.values()].reduce((a, b) => a + b, 0);
console.log(`\n=== what does a link point AT?  (${totalLinks} used links) ===`);
for (const [k, v] of [...linkTargetKind.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(14)} ${String(v).padStart(7)}  ${((v / totalLinks) * 100).toFixed(1)}%`);
}

console.log('\n=== distance to the target, measured to the OWNER FOOTPRINT (not its centre) ===');
if (dists.length) {
  console.log(`  n=${dists.length}  p10=${pct(0.1).toFixed(2)}  p50=${pct(0.5).toFixed(2)}  p90=${pct(0.9).toFixed(2)}  max=${dists[dists.length - 1]!.toFixed(2)}`);
  for (const lim of [0.01, 0.5, 1.5, 3.05]) {
    console.log(`  within ${String(lim).padEnd(5)} cells: ${dists.filter((d) => d <= lim).length} (${((dists.filter((d) => d <= lim).length / dists.length) * 100).toFixed(1)}%)`);
  }
}

console.log('\n=== is the link reciprocal? ===');
const tot = selfLink.bothWays + selfLink.oneWay;
console.log(`  target points back at owner : ${selfLink.bothWays} / ${tot} (${((selfLink.bothWays / tot) * 100).toFixed(1)}%)`);
console.log(`  one-directional              : ${selfLink.oneWay} / ${tot}`);

console.log('\n=== splitter stacking (a Splitter sharing its cell) ===');
console.log(`  Splitter sharing a cell with something: ${sorterOnSplitter.splitterOnSplitter}`);
