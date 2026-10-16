import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { base64ToBytes, decodeBody, encodeBody } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

/**
 * Byte-for-byte comparison of our WRITER against bytes the game itself produced.
 *
 * A self round-trip (encode with our writer, decode with our reader) cannot prove
 * the writer is right: both sides could share the same wrong assumption. This
 * test compares against a ground-truth body exported by game version
 * 0.10.34.28326, so a writer bug shows up as a byte difference.
 */
function groundTruthBody(): Promise<Uint8Array> {
  const text = readFileSync(resolve(import.meta.dirname, 'fixtures/reference-blueprint.txt'), 'utf8').trim();
  const body = text.slice('BLUEPRINT:'.length);
  const closeQuote = body.lastIndexOf('"');
  const prefix = body.slice(0, closeQuote);
  // v1 envelope: the base64 sits between an opening quote and the closing quote.
  const tailToken = prefix.slice(prefix.lastIndexOf(',') + 1);
  const q = tailToken.indexOf('"');
  return gunzipBytes(base64ToBytes(tailToken.slice(q + 1)));
}

/** First differing byte offset, or -1 when the ranges are equal. */
function firstDiff(a: Uint8Array, b: Uint8Array, length: number): number {
  for (let i = 0; i < length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

describe('writer vs ground-truth game body', () => {
  it('reproduces the header, areas and every building record exactly', async () => {
    const original = await groundTruthBody();
    const parsed = decodeBody(original);
    const reencoded = encodeBody(parsed);

    expect(parsed.buildings).toHaveLength(37);
    expect(parsed.areas).toHaveLength(1);
    // The game writes header version 2 for this layout.
    expect(original[0]).toBe(2);

    // Header (28 bytes) + area count (1) + area records (14 each).
    const areasEnd = 29 + parsed.areas.length * 14;
    // Sanity: this is where the game put its u32 building count.
    const view = new DataView(original.buffer, original.byteOffset, original.byteLength);
    expect(view.getUint32(areasEnd, true)).toBe(37);

    expect(firstDiff(original, reencoded, areasEnd)).toBe(-1);

    // The record section starts after the u32 count and must match for the whole
    // length of our output (the game appends a small trailer we do not write).
    const recordStart = areasEnd + 4;
    const comparable = reencoded.length - recordStart;
    expect(comparable).toBeGreaterThan(2000);
    expect(firstDiff(original.subarray(recordStart), reencoded.subarray(recordStart), comparable)).toBe(-1);

    console.log(
      `header+areas (${areasEnd} B) and records (${comparable} B) identical; ` +
        `original=${original.length} B, ours=${reencoded.length} B (game trailer: ${original.length - reencoded.length} B)`,
    );
  });

  /**
   * Field offsets, checked against geometry rather than against our own reader.
   *
   * Byte-for-byte round-tripping cannot catch a field read at the wrong offset: the
   * garbage is written back to the same wrong place and the bytes still match. This
   * blueprint is a closed ring of 37 belts, so a correctly placed
   * `outputObjectIndex` must point at a belt one cell away, and the chain it forms
   * must walk the ring. That is the check that found the belt orientation block was
   * 4 bytes rather than 8, and that a 4-byte record trailer was being skipped.
   */
  it('reads outputObjectIndex at the offset verified by belt-ring geometry', async () => {
    const original = await groundTruthBody();
    const parsed = decodeBody(original);

    const pos = new Map(parsed.buildings.map((b) => [b.index, { x: b.x, y: b.y }]));
    const round = (v: number): number => Math.round(v * 100) / 100;

    let adjacent = 0;
    let dangling = 0;
    for (const b of parsed.buildings) {
      const out = b.outputObjectIndex;
      if (out === -1) continue; // the last belt in the run has no successor
      const to = pos.get(out);
      if (!to) {
        dangling++;
        continue;
      }
      const dx = Math.abs(round(to.x) - round(b.x));
      const dy = Math.abs(round(to.y) - round(b.y));
      if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) adjacent++;
    }

    // A wrong offset yields a huge integer (16777217 style) or a scattered value, so
    // neither of these holds.
    expect(dangling).toBe(0);
    expect(adjacent).toBeGreaterThan(30);

    // And a belt's input endpoint is a belt itself, recorded as -1.
    const belts = parsed.buildings.filter((b) => b.itemId > 2000 && b.itemId < 2010);
    expect(belts.length).toBe(37);
    expect(belts.every((b) => b.inputObjectIndex === -1)).toBe(true);

    console.log(`belt chain: ${adjacent} of ${belts.length} belts feed a geometric neighbour; no dangling references`);
  });
});
