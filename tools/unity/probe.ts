/**
 * Probe a Unity `SerializedFile` for the building prefab data.
 *
 * Reads the header, type table and object table, then reports what is inside. The immediate
 * question is whether the shipped assets carry type trees at all (a player build may strip
 * them) — if they do, field names like `insertPoses` are directly searchable and the slot
 * geometry is a few hours of reading away rather than a research project.
 *
 *   node --experimental-strip-types tools/unity/probe.ts <file>
 */

import { readFileSync } from 'node:fs';
import { parseSerializedFile } from './serialized-file.ts';

const path = process.argv[2];
if (!path) {
  console.error('usage: probe.ts <path-to-.assets>');
  process.exit(2);
}

const stat = readFileSync(path);
console.log(`file: ${path}`);
console.log(`size: ${(stat.length / 1024 / 1024).toFixed(1)} MB`);

const f = parseSerializedFile(stat);
console.log('');
console.log('=== header ===');
console.log(`  version      ${f.header.version}`);
console.log(`  metadataSize ${f.header.metadataSize}`);
console.log(`  fileSize     ${f.header.fileSize}`);
console.log(`  dataOffset   ${f.header.dataOffset}`);
console.log(`  endianness   ${f.header.endianness} (0 = little)`);
console.log(`  layout       ${f.layout}`);
console.log('');
console.log(`types:   ${f.types.length}`);
console.log(`objects: ${f.objects.length}`);

// Objects per class, with the tree's field count.
const byClass = new Map<number, number>();
for (const o of f.objects) byClass.set(o.classId, (byClass.get(o.classId) ?? 0) + 1);

// Unity class ids worth naming.
const CLASS_NAMES: Record<number, string> = {
  1: 'GameObject',
  4: 'Transform',
  21: 'Material',
  28: 'Texture2D',
  43: 'Mesh',
  48: 'Shader',
  49: 'TextAsset',
  74: 'AnimationClip',
  83: 'AudioClip',
  114: 'MonoBehaviour',
  115: 'MonoScript',
  128: 'Font',
  142: 'AssetBundle',
  156: 'PrefabInstance',
  213: 'Sprite',
  222: 'CanvasRenderer',
  223: 'Canvas',
  224: 'RectTransform',
  225: 'CanvasGroup',
  240: 'AudioMixer',
};

console.log('');
console.log('=== objects per class (top 20) ===');
for (const [id, n] of [...byClass.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${String(id).padStart(5)} ${(CLASS_NAMES[id] ?? '').padEnd(16)} ${n}`);
}

// Do the type trees carry field names?
const withNames = f.types.filter((t) => t.nodes.length > 0).length;
const nodeCount = f.types.reduce((a, t) => a + t.nodes.length, 0);
console.log('');
console.log(`types with a non-empty tree: ${withNames} / ${f.types.length}`);
console.log(`total type-tree nodes:       ${nodeCount}`);

const sample = f.types.find((t) => t.nodes.length > 5);
if (sample) {
  console.log('');
  console.log(`=== sample tree (classId ${sample.classId}, ${sample.nodes.length} nodes) ===`);
  for (const n of sample.nodes.slice(0, 24)) {
    console.log(`  ${'  '.repeat(n.level)}${n.name} : ${n.type}  (${n.byteSize} B)`);
  }
}

// Search every node name for the fields we care about.
const WANTED = [
  'insertPoses',
  'slotPoses',
  'insertPose',
  'slotPose',
  'sorterAttachSlots',
  'prefabDesc',
  'PrefabDesc',
  'slot',
  'poses',
  'connect',
  'beltSpeed',
  'selectSize',
];
console.log('');
console.log('=== node-name search across all type trees ===');
for (const want of WANTED) {
  const hits: { classId: number; type: number; nodes: number }[] = [];
  for (const t of f.types) {
    if (t.nodes.some((n) => n.name === want)) hits.push({ classId: t.classId, type: t.typeIndex, nodes: t.nodes.length });
  }
  console.log(`  ${want.padEnd(20)} ${hits.length === 0 ? 'not found' : hits.slice(0, 6).map((h) => `type#${h.type}(cls ${h.classId}, ${h.nodes}n)`).join('  ')}`);
}
