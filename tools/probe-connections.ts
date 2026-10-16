/**
 * Probe the per-building connection fields on a v2 blueprint.
 *
 * A v2 building record carries `outputObjectIndex` / `outputToSlot` / `inputObjectIndex` /
 * `inputFromSlot` alongside `parameters`. If those are what they look like — indices into the
 * blueprint's own building list, plus a slot number on the target — then the game itself is
 * telling us which slot each sorter occupies, which is the missing half of "can a sorter attach
 * here, and where is that".
 *
 * This prints the raw numbers so the interpretation is checked against data rather than assumed.
 *
 *   node --experimental-strip-types tools/probe-connections.ts [sample]
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';

const ROOT = resolve(import.meta.dirname, '..');
const BELT = (id: number): boolean => id >= 2001 && id <= 2003;
const SORTER = (id: number): boolean => id >= 2011 && id <= 2014;

const name = process.argv[2] ?? 'factory-v2.txt';
const text = readFileSync(resolve(ROOT, 'public/samples', name), 'utf8').trim();
const decoded = await decodeBlueprint(text);
const body = decoded.body;
const buildings = body.buildings;

console.log(`sample: ${name}`);
console.log(`layout: ${decoded.body.layout ?? '?'}   buildings: ${buildings.length}`);
console.log('');

// How many buildings carry any connection field at all?
const fields = [
  'outputObjectIndex',
  'inputObjectIndex',
  'outputToSlot',
  'inputFromSlot',
  'outputFromSlot',
  'inputToSlot',
  'outputOffset',
  'inputOffset',
  'filterId',
] as const;

console.log('=== non-zero/interesting value counts per field ===');
for (const f of fields) {
  const values = buildings.map((b) => (b as unknown as Record<string, number>)[f]);
  const nonZero = values.filter((v) => v !== 0).length;
  const distinct = [...new Set(values)].sort((a, b) => (a ?? 0) - (b ?? 0));
  console.log(
    `  ${f.padEnd(18)} non-zero ${String(nonZero).padStart(5)}  distinct ${String(distinct.length).padStart(4)}  ` +
      `range [${distinct[0]}, ${distinct[distinct.length - 1]}]`,
  );
}
console.log('');

/** Do the object indices stay inside the building list? */
const n = buildings.length;
const inRange = (v: number): boolean => Number.isInteger(v) && v >= 0 && v < n;
const outIdx = buildings.map((b) => b.outputObjectIndex).filter((v) => v !== 0 && !inRange(v - 1));
const inIdx = buildings.map((b) => b.inputObjectIndex).filter((v) => v !== 0 && !inRange(v - 1));
console.log(`outputObjectIndex values outside 0..${n} (treating 0 as none): ${outIdx.length}`);
console.log(`inputObjectIndex  values outside 0..${n} (treating 0 as none): ${inIdx.length}`);
console.log('');

// Sample a few sorters and the machines they point at.
console.log('=== sorters: raw connection fields ===');
const sorters = buildings.filter((b) => SORTER(b.itemId));
console.log(`sorters: ${sorters.length}`);
for (const s of sorters.slice(0, 6)) {
  console.log(
    `  #${String(s.index).padStart(5)} id=${s.itemId} pos=(${s.x.toFixed(1)},${s.y.toFixed(1)},${s.z.toFixed(1)}) ` +
      `yaw=${s.yaw}  out=${s.outputObjectIndex}/${s.outputToSlot}  in=${s.inputObjectIndex}/${s.inputFromSlot} ` +
      `params=[${s.parameters.join(',')}]`,
  );
}
console.log('');

console.log('=== machines with a non-zero output/input index (first 12) ===');
const machines = buildings.filter((b) => !BELT(b.itemId) && !SORTER(b.itemId));
let shown = 0;
for (const m of machines) {
  if (m.outputObjectIndex === 0 && m.inputObjectIndex === 0) continue;
  const out = m.outputObjectIndex !== 0 ? buildings[m.outputObjectIndex - 1] : null;
  const inp = m.inputObjectIndex !== 0 ? buildings[m.inputObjectIndex - 1] : null;
  console.log(
    `  #${String(m.index).padStart(5)} id=${m.itemId} out=${m.outputObjectIndex}` +
      `(${out ? `#${out.index} id=${out.itemId}` : '-'}) slot=${m.outputToSlot}` +
      `  in=${m.inputObjectIndex}(${inp ? `#${inp.index} id=${inp.itemId}` : '-'}) fromSlot=${m.inputFromSlot}`,
  );
  if (++shown >= 12) break;
}
console.log('');

// How do sorters distribute across the id space of what they point at?
console.log('=== what sorters point at (output) ===');
const targets = new Map<string, number>();
for (const s of sorters) {
  if (s.outputObjectIndex === 0) {
    targets.set('(none)', (targets.get('(none)') ?? 0) + 1);
    continue;
  }
  const t = buildings[s.outputObjectIndex - 1];
  const kind = t ? `${t.itemId}${BELT(t.itemId) ? ' belt' : SORTER(t.itemId) ? ' sorter' : ''}` : 'OUT OF RANGE';
  targets.set(kind, (targets.get(kind) ?? 0) + 1);
}
for (const [k, v] of [...targets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${k.padEnd(14)} ${v}`);
}

// Sanity: is the field 1-based or 0-based? Check whether index === outputObjectIndex occurs.
const selfRef = buildings.filter((b) => b.outputObjectIndex === b.index + 1).length;
console.log('');
console.log(`buildings whose outputObjectIndex === index+1 (1-based interpretation): ${selfRef}`);
const selfRef0 = buildings.filter((b) => b.outputObjectIndex === b.index).length;
console.log(`buildings whose outputObjectIndex === index    (0-based interpretation): ${selfRef0}`);

// If the corpus has other v2 files, note them.
const dir = resolve(ROOT, 'docs/research/_raw/realbp');
const layouts = new Map<string, number>();
for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt'))) {
  try {
    const d = await decodeBlueprint(readFileSync(resolve(dir, f), 'utf8').trim());
    layouts.set(d.body.layout ?? '?', (layouts.get(d.body.layout ?? '?') ?? 0) + 1);
  } catch {
    layouts.set('decode-failed', (layouts.get('decode-failed') ?? 0) + 1);
  }
}
console.log('');
console.log('corpus body layouts:', [...layouts.entries()].map(([k, v]) => `${k}=${v}`).join('  '));
