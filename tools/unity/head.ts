/**
 * Dump a Unity SerializedFile header and the first bytes of its metadata, so the layout can be
 * read off the file instead of assumed.
 *
 *   node --experimental-strip-types tools/unity/head.ts <file>
 */

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: head.ts <path>');
  process.exit(2);
}
const buf = readFileSync(path);
console.log(`file: ${path}`);
console.log(`size: ${buf.length} bytes (${(buf.length / 1048576).toFixed(1)} MB)`);
console.log('');

const head = buf.subarray(0, 64);
console.log('first 64 bytes:');
console.log('  hex   ' + head.toString('hex').replace(/(.{8})/g, '$1 '));
for (let i = 0; i < 64; i += 4) {
  console.log(
    `  +${String(i).padStart(2)}  u32be=${String(buf.readUInt32BE(i)).padStart(12)}  ` +
      `u32le=${String(buf.readUInt32LE(i)).padStart(12)}`,
  );
}
console.log('');
console.log('as u64be:');
for (let i = 0; i < 64; i += 8) {
  console.log(`  +${String(i).padStart(2)}  ${buf.readBigUInt64BE(i)}`);
}
console.log('');

// Where does the metadata plausibly start? Show the u32 at each candidate.
console.log('u32be from offset 40 to 140 (looking for the type count):');
for (let i = 40; i < 140; i += 4) {
  const v = buf.readUInt32BE(i);
  const ascii = buf
    .subarray(i, i + 4)
    .toString('latin1')
    .replace(/[^\x20-\x7e]/g, '.');
  console.log(`  +${String(i).padStart(3)}  ${String(v).padStart(12)}  '${ascii}'`);
}
console.log('');
console.log(`dataOffset - metadataSize = ${Number(buf.readBigUInt64BE(32)) - Number(buf.readBigUInt64BE(16))}`);
