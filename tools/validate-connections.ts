/**
 * Validate the v2 connection fields geometrically.
 *
 * `outputObjectIndex` / `inputObjectIndex` are only useful if they name a building the source
 * actually touches. This checks that directly: for every reference, how far apart are the two
 * buildings? If the fields mean "the thing I connect to", the distances must be small and
 * bounded; if they mean something else, they will be scattered.
 *
 * It also cross-checks the slot numbers against the per-building `sorterAttachSlots` counts
 * already in the dataset, which is the strongest available confirmation that the slot index is
 * a real slot on the target rather than an ordinal of something else.
 *
 *   node --experimental-strip-types tools/validate-connections.ts [sample]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')),
);
const byId = new Map(data.buildings.map((b) => [b.id, b]));

const name = process.argv[2] ?? 'factory-v2.txt';
const decoded = await decodeBlueprint(readFileSync(resolve(ROOT, 'public/samples', name), 'utf8').trim());
const buildings = decoded.body.buildings;
const n = buildings.length;

const belt = (id: number): boolean => id >= 2001 && id <= 2003;
const sorter = (id: number): boolean => id >= 2011 && id <= 2014;
const label = (id: number): string => {
  const b = byId.get(id);
  return `${b?.key ?? '?'}(${id})`;
};

/** Gap between two buildings' anchors, in cells. */
const gap = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

console.log(`sample: ${name}  buildings: ${n}\n`);

interface Stats {
  pairs: number;
  missing: number;
  self: number;
  distances: number[];
}

function collect(which: 'outputObjectIndex' | 'inputObjectIndex'): Stats {
  const s: Stats = { pairs: 0, missing: 0, self: 0, distances: [] };
  for (const b of buildings) {
    const ref = b[which];
    if (ref < 0) continue;
    const t = buildings[ref];
    if (!t) {
      s.missing++;
      continue;
    }
    if (t === b) {
      s.self++;
      continue;
    }
    s.pairs++;
    s.distances.push(gap(b, t));
  }
  return s;
}

function summarise(field: string, s: Stats): void {
  if (s.distances.length === 0) {
    console.log(`${field}: no usable pairs`);
    return;
  }
  const sorted = [...s.distances].sort((a, b) => a - b);
  const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
  const within = (d: number): number => sorted.filter((x) => x <= d).length;
  console.log(
    `${field}: pairs=${s.pairs} missing=${s.missing} self=${s.self}\n` +
      `   min=${sorted[0]!.toFixed(2)} p50=${q(0.5).toFixed(2)} p90=${q(0.9).toFixed(2)} p99=${q(0.99).toFixed(2)} max=${sorted[sorted.length - 1]!.toFixed(2)}\n` +
      `   within 0.6=${((within(0.6) / sorted.length) * 100).toFixed(1)}%  ` +
      `1.5=${((within(1.5) / sorted.length) * 100).toFixed(1)}%  ` +
      `3=${((within(3) / sorted.length) * 100).toFixed(1)}%  ` +
      `6=${((within(6) / sorted.length) * 100).toFixed(1)}%`,
  );
}

summarise('outputObjectIndex', collect('outputObjectIndex'));
summarise('inputObjectIndex ', collect('inputObjectIndex'));
console.log('');

// What kinds of pairs do the fields describe?
console.log('=== pair kinds ===');
for (const which of ['outputObjectIndex', 'inputObjectIndex'] as const) {
  const kinds = new Map<string, number>();
  for (const b of buildings) {
    const ref = b[which];
    if (ref < 0) continue;
    const t = buildings[ref];
    if (!t) continue;
    const kind = (x: number): string =>
      belt(x) ? 'belt' : sorter(x) ? 'sorter' : x === 1131 ? 'foundation' : 'machine';
    const k = `${kind(b.itemId)} -> ${kind(t.itemId)}`;
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  console.log(` ${which}:`);
  for (const [k, v] of [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`   ${k.padEnd(24)} ${v}`);
  }
}
console.log('');

// The decisive cross-check: slot numbers must fit the target's declared attach-slot count.
console.log('=== slot index vs the target type\'s declared sorterAttachSlots ===');
for (const [which, slotField] of [
  ['outputObjectIndex', 'outputToSlot'],
  ['inputObjectIndex', 'inputFromSlot'],
] as const) {
  let ok = 0;
  let tooBig = 0;
  let unknownType = 0;
  let noDeclared = 0;
  const examples: string[] = [];
  for (const b of buildings) {
    const ref = b[which];
    if (ref < 0) continue;
    const t = buildings[ref];
    if (!t) continue;
    const slot = b[slotField];
    if (slot < 0) continue;
    const def = byId.get(t.itemId);
    if (!def) {
      unknownType++;
      continue;
    }
    const declared = def.sorterAttachSlots;
    if (typeof declared !== 'number' || declared <= 0) {
      noDeclared++;
      if (examples.length < 6) examples.push(`  ${label(t.itemId)} slot=${slot} (type declares none)`);
      continue;
    }
    if (slot < declared) ok++;
    else {
      tooBig++;
      if (examples.length < 12)
        examples.push(`  ${label(t.itemId)} slot=${slot} >= declared ${declared}  (from ${label(b.itemId)})`);
    }
  }
  console.log(`${which} / ${slotField}: within declared=${ok}  exceeding=${tooBig}  type-has-no-count=${noDeclared}  unknown-type=${unknownType}`);
  for (const e of examples) console.log(e);
}
console.log('');

// Distribution of slot numbers actually seen, per target type.
console.log('=== observed slot numbers per target type ===');
const perType = new Map<number, Map<number, number>>();
for (const b of buildings) {
  for (const [which, slotField] of [
    ['outputObjectIndex', 'outputToSlot'],
    ['inputObjectIndex', 'inputFromSlot'],
  ] as const) {
    const ref = b[which];
    if (ref < 0) continue;
    const t = buildings[ref];
    if (!t) continue;
    const slot = b[slotField];
    if (slot < 0) continue;
    if (!perType.has(t.itemId)) perType.set(t.itemId, new Map());
    const m = perType.get(t.itemId)!;
    m.set(slot, (m.get(slot) ?? 0) + 1);
  }
}
for (const [id, m] of [...perType.entries()].sort((a, b) => b[1].size - a[1].size)) {
  const def = byId.get(id);
  const slots = [...m.entries()].sort((a, b) => a[0] - b[0]);
  console.log(
    `  ${label(id).padEnd(34)} declared=${String(def?.sorterAttachSlots ?? '-').padStart(3)}  ` +
      `observed slots: ${slots.map(([s, c]) => `${s}×${c}`).join(' ')}`,
  );
}
