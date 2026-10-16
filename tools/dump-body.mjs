/**
 * Dumps the first 160 bytes of a real blueprint body with byte offsets.
 *
 *   node tools/dump-body.mjs [fileIndex] [byteCount]
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';
import { base64ToBytes } from '../src/engine/bp/codec.ts';

const dir = resolve(import.meta.dirname, '..', 'docs/research/_raw/realbp');
const files = readdirSync(dir).filter((f) => f.endsWith('.txt'));
const idx = Number(process.argv[2] ?? 0);
const count = Number(process.argv[3] ?? 160);

const text = readFileSync(resolve(dir, files[idx]), 'utf8').trim();
const tail = text.slice('BLUEPRINT:'.length);
const closeQuote = tail.lastIndexOf('"');
const head = tail.slice(0, closeQuote);
const openQuote = head.lastIndexOf('"');
const field = head.slice(openQuote + 1);
const b64 = field.slice(field.lastIndexOf(',') + 1).replace(/\s+/g, '');
const body = await gunzipBytes(base64ToBytes(b64));
const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);

console.log(`file      : ${files[idx]}`);
console.log(`body      : ${body.length} bytes`);
console.log(`version   : ${dv.getUint32(0, true)}`);
console.log(`areaCount : ${body[28]}`);

console.log('\nheader decode:');
console.log(`  version        u32@0  = ${dv.getUint32(0, true)}`);
console.log(`  cursorX        i32@4  = ${dv.getInt32(4, true)}`);
console.log(`  cursorY        i32@8  = ${dv.getInt32(8, true)}`);
console.log(`  cursorTarget   i32@12 = ${dv.getInt32(12, true)}`);
console.log(`  dragboxX       i32@16 = ${dv.getInt32(16, true)}`);
console.log(`  dragboxY       i32@20 = ${dv.getInt32(20, true)}`);
console.log(`  primaryArea    i32@24 = ${dv.getInt32(24, true)}`);
console.log(`  areaCount      u8 @28 = ${body[28]}`);
console.log(`  bytes 29..31         = ${body[29]},${body[30]},${body[31]}`);

console.log(`\nfirst ${count} bytes from offset 32:`);
for (let base = 32; base < Math.min(body.length, 32 + count); base += 16) {
  const hex = [];
  const ascii = [];
  for (let i = 0; i < 16 && base + i < body.length; i++) {
    const v = body[base + i];
    hex.push(v.toString(16).padStart(2, '0'));
    ascii.push(v >= 32 && v < 127 ? String.fromCharCode(v) : '.');
  }
  console.log(`  ${String(base).padStart(6)}  ${hex.join(' ').padEnd(48)}  ${ascii.join('')}`);
}

console.log('\nas i16 / i32 / f32 windows (offset: i16, i32, f32):');
for (let off = 32; off < Math.min(body.length - 4, 32 + count); off += 2) {
  const i16 = dv.getInt16(off, true);
  const i32 = dv.getInt32(off, true);
  const f32 = dv.getFloat32(off, true);
  const marker = i32 === -102 || i32 === -101 || i32 === -100 ? '  <== PATH NUMBER' : '';
  console.log(`  ${String(off).padStart(5)}: i16=${String(i16).padStart(7)} i32=${String(i32).padStart(12)} f32=${f32.toFixed(4).padStart(14)}${marker}`);
}
