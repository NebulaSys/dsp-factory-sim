/**
 * Extracts, for every building prefab in the cached game data, how many sorter
 * attachment slots it exposes and where those slots sit.
 *
 * This is the piece the blueprint does NOT carry: a record says which slot a sorter
 * used (`outputToSlot` / `inputFromSlot`), but the slot's count and position are
 * properties of the building prototype, published in the prefab's `SlotConfig`
 * (`insertPoses` for the sorter attachment points, `slotPoses` for item slots).
 *
 *   node --experimental-strip-types tools/prefab-slots.ts [--json]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const prefabs = JSON.parse(readFileSync(resolve(ROOT, 'docs/research/_raw/prefabs.json'), 'utf8')) as {
  version?: string;
  prefabs: Record<string, Record<string, unknown>>;
};

type Vec = { x: number; y: number; z: number };

/** Read a Unity-style vector, or null when the entry is an empty object. */
function vec(value: unknown): Vec | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.x !== 'number' || typeof v.y !== 'number' || typeof v.z !== 'number') return null;
  return { x: v.x, y: v.y, z: v.z };
}

interface SlotReport {
  prefab: string;
  slotPoses: number;
  insertPoses: number;
  /** Attachment points with a real position, i.e. usable slots. */
  positioned: number;
  first?: Vec;
  /** Distinct directions of the positioned slots in the XZ plane. */
  directions: string[];
}

const reports: SlotReport[] = [];
for (const [key, descs] of Object.entries(prefabs.prefabs)) {
  const config = descs.SlotConfig as Record<string, unknown> | undefined;
  if (!config) continue;
  const slotPoses = (config.slotPoses as unknown[]) ?? [];
  const insertPoses = (config.insertPoses as unknown[]) ?? [];
  if (slotPoses.length === 0 && insertPoses.length === 0) continue;

  const positioned = insertPoses.map(vec).filter((v): v is Vec => v !== null);
  const directions = new Set<string>();
  for (const p of positioned) {
    // Quantise the XZ direction to one of eight compass directions.
    const angle = (Math.atan2(p.z, p.x) * 180) / Math.PI;
    const bucket = ((Math.round(angle / 45) * 45) % 360 + 360) % 360;
    directions.add(`${bucket}deg`);
  }
  reports.push({
    prefab: key,
    slotPoses: slotPoses.length,
    insertPoses: insertPoses.length,
    positioned: positioned.length,
    first: positioned[0],
    directions: [...directions].sort(),
  });
}

reports.sort((a, b) => b.insertPoses - a.insertPoses || a.prefab.localeCompare(b.prefab));

console.log(`game data version: ${prefabs.version ?? 'unknown'}`);
console.log(`prefabs with slot config: ${reports.length}`);
console.log(`  with positioned insertPoses: ${reports.filter((r) => r.positioned > 0).length}`);
console.log(`  with positioned slotPoses  : ${reports.filter((r) => r.slotPoses > 0).length}`);

console.log('\nprefabs that expose sorter attachment points (insertPoses), most first:');
for (const r of reports.filter((x) => x.insertPoses > 0).slice(0, 30)) {
  const first = r.first ? `(x=${r.first.x.toFixed(2)}, y=${r.first.y.toFixed(2)}, z=${r.first.z.toFixed(2)})` : 'no position';
  console.log(
    `  ${r.prefab.replace(/^entities\/prefabs\//, '').padEnd(34)} slots=${String(r.insertPoses).padStart(3)} positioned=${String(r.positioned).padStart(3)}  first=${first}  dirs=[${r.directions.join(' ')}]`,
  );
}

console.log('\nprefabs with item slots (slotPoses), e.g. logistics stations:');
for (const r of reports.filter((x) => x.slotPoses > 0).slice(0, 20)) {
  console.log(`  ${r.prefab.replace(/^entities\/prefabs\//, '').padEnd(34)} slotPoses=${String(r.slotPoses).padStart(3)} insertPoses=${r.insertPoses}`);
}

if (process.argv.includes('--json')) {
  const out = resolve(ROOT, 'docs/research/prefab-slots.json');
  writeFileSync(out, JSON.stringify({ version: prefabs.version ?? null, slots: reports }, null, 1));
  console.log(`\nwrote ${out}`);
}
