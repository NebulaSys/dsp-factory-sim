/**
 * Dumps the raw shape of `insertPoses` / `slotPoses` so the pose encoding is clear.
 *
 * tools/prefab-slots.ts showed the entries are not {x,y,z} objects, so this prints
 * their actual keys and values.
 *
 *   node --experimental-strip-types tools/dump-poses.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const prefabs = JSON.parse(readFileSync(resolve(ROOT, 'docs/research/_raw/prefabs.json'), 'utf8')) as {
  prefabs: Record<string, Record<string, unknown>>;
};

/** Collect the set of key signatures seen across the entries of an array. */
function signatures(values: unknown[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    if (v === null) out.add('null');
    else if (Array.isArray(v)) out.add(`array[${v.length}]`);
    else if (typeof v === 'object') out.add(`object{${Object.keys(v as object).join(',') || 'empty'}}`);
    else out.add(typeof v);
  }
  return [...out];
}

for (const name of ['assembler-mk-1', 'smelter', 'chemical-plant', 'lab', 'storage-1', 'interstellar-logistic-station', 'belt-1']) {
  const key = Object.keys(prefabs.prefabs).find((k) => k.endsWith(`/${name}`));
  if (!key) {
    console.log(`${name}: not found`);
    continue;
  }
  const config = prefabs.prefabs[key]?.SlotConfig as Record<string, unknown> | undefined;
  console.log(`\n=== ${key} ===`);
  if (!config) {
    console.log('  no SlotConfig');
    continue;
  }
  for (const field of ['slotPoses', 'insertPoses', 'addonAreaCol', 'addonAreaCenter']) {
    const value = config[field];
    if (value === undefined) {
      console.log(`  ${field}: absent`);
      continue;
    }
    if (Array.isArray(value)) {
      console.log(`  ${field}: array(${value.length}) signatures=${signatures(value).join(' ')}`);
      if (value.length > 0) console.log(`    [0] = ${JSON.stringify(value[0])}`);
      if (value.length > 1) console.log(`    [1] = ${JSON.stringify(value[1])}`);
    } else {
      console.log(`  ${field}: ${JSON.stringify(value)}`);
    }
  }
}
