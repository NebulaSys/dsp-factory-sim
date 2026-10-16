/**
 * Dump the raw bytes of a v1 tail, because the i32 reading looks byte-shifted.
 *
 * `PlaneSmelter` tails give column 3 the values 4325376 / 4259840 / 3997696, i.e.
 * 0x420000 / 0x410000 / 0x3D0000 — exactly the float bit patterns for 32.0 / 8.0 / 0.03125
 * shifted right by one byte. That is what reading a packed struct on a 4-byte grid looks like,
 * so the tail is probably not an array of ints at all.
 *
 * This prints each tail as bytes, as i32, and as f32 at every byte offset, so the real alignment
 * can be read off instead of guessed.
 *
 *   node --experimental-strip-types tools/dump-v1-tail-bytes.ts [prototypeKey]
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')));
const wantKey = process.argv[2] ?? 'PlaneSmelter';
const wantId = data.buildings.find((b) => b.key === wantKey)?.id;
if (wantId === undefined) {
  console.error(`no building key ${wantKey}`);
  process.exit(2);
}

const DIR = resolve(ROOT, 'docs/research/_raw/realbp');
const seen = new Map<string, { tail: number[]; file: string; index: number }>();

for (const f of readdirSync(DIR).filter((x) => x.endsWith('.txt'))) {
  let bp;
  try {
    bp = await decodeBlueprint(readFileSync(resolve(DIR, f), 'utf8').trim());
  } catch {
    continue;
  }
  for (const b of bp.body.buildings) {
    if (b.itemId !== wantId || !b.tail) continue;
    const key = b.tail.join(',');
    if (!seen.has(key)) seen.set(key, { tail: b.tail, file: f, index: b.index });
  }
}

console.log(`${wantKey} (id ${wantId}): ${seen.size} distinct tail value(s)\n`);

for (const { tail, file, index } of seen.values()) {
  const bytes = Buffer.alloc(tail.length * 4);
  tail.forEach((v, i) => bytes.writeInt32LE(v, i * 4));
  console.log(`file ${file.slice(0, 44)}  #${index}   n=${tail.length}`);
  console.log(`  bytes : ${bytes.toString('hex').replace(/(.{8})/g, '$1 ')}`);
  console.log(`  i32   : [${tail.join(', ')}]`);
  for (const off of [0, 1, 2, 3]) {
    const floats: number[] = [];
    for (let i = off; i + 4 <= bytes.length; i += 4) floats.push(bytes.readFloatLE(i));
    const printable = floats.map((x) => (Number.isFinite(x) ? x.toFixed(4) : String(x)));
    console.log(`  f32@${off} : [${printable.join(', ')}]`);
  }
  // A file name hint tells us what the machine is meant to produce.
  console.log('');
}
