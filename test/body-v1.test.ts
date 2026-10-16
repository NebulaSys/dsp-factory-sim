import { describe, expect, it } from 'vitest';
import { decodeBody, type BlueprintBody } from '../src/engine/bp/codec.ts';

/**
 * Body-version-1 decoding.
 *
 * Version 1 records carry no `-102` path discriminant, so the framing is a `u32`
 * building count followed by fixed 61-byte records. The field offsets were measured
 * against real game blueprints rather than guessed — see the layout comment on
 * `readV1Record` and docs/SLOT-DATA-REVERSING.md.
 *
 * These fixtures are built here rather than stored as a corpus file because the
 * assertion is about the decoder's framing rules, and a hand-built body makes the
 * failing case (a stride that does not land on the buffer end) explicit.
 */

/** Build a v1 body with the given records. */
function v1Body(records: { index: number; itemId: number; modelIndex: number; x: number; y: number; z: number; inRef: number; link: number }[]): Uint8Array {
  const bytes: number[] = [];
  const u8 = (v: number): void => void bytes.push(v & 0xff);
  const u32 = (v: number): void => {
    bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  };
  const i32 = (v: number): void => u32(v >>> 0);
  const i16 = (v: number): void => {
    bytes.push(v & 0xff, (v >> 8) & 0xff);
  };
  const f32 = (v: number): void => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, v, true);
    for (const b of new Uint8Array(buf)) bytes.push(b);
  };

  // Header: 7 u32 then the area count.
  u32(1); // body version
  u32(0);
  u32(0);
  u32(0);
  u32(1);
  u32(1);
  u32(0);
  u8(1); // areaCount
  // One 14-byte area record.
  for (const v of [0, 0xff, 0, 0, 0xa0, 0, 0, 0, 0, 0, 1, 0, 1, 0]) u8(v);
  u32(records.length);

  for (const r of records) {
    i32(r.index);
    u8(0); // areaIndex
    f32(r.x);
    f32(r.y);
    f32(r.z);
    f32(r.x);
    f32(r.y);
    f32(r.z);
    f32(0);
    f32(0);
    i16(r.itemId);
    i16(r.modelIndex);
    i32(r.inRef);
    i32(r.link);
    for (let i = 0; i < 12; i++) u8(0);
  }
  return Uint8Array.from(bytes);
}

const RECORDS = [
  { index: 0, itemId: 2203, modelIndex: 53, x: 0, y: 0, z: 0, inRef: -1, link: 2 },
  { index: 1, itemId: 2203, modelIndex: 53, x: 0, y: 0, z: 8, inRef: -1, link: 4 },
  { index: 2, itemId: 1131, modelIndex: 37, x: 0, y: 0, z: -10, inRef: 0, link: 0 },
];

describe('body version 1', () => {
  it('decodes a fixed 61-byte record sequence with no path discriminant', () => {
    const bytes = v1Body(RECORDS);
    const body: BlueprintBody = decodeBody(bytes);
    expect(body.buildings).toHaveLength(3);
    expect(body.declaredBuildingCount).toBe(3);
    expect(body.areas).toHaveLength(1);
  });

  it('reads the measured fields: prototype id, model, position and orientation', () => {
    const body = decodeBody(v1Body(RECORDS));
    const [first, second, third] = body.buildings;
    // itemId sits at +37; 2203 is the game's Wind Turbine prototype.
    expect(first!.itemId).toBe(2203);
    expect(first!.modelIndex).toBe(53);
    expect(first!.x).toBeCloseTo(0, 6);
    // The turbine ladder: 8 units per level, which is what the real blueprint shows.
    expect(second!.z).toBeCloseTo(8, 6);
    expect(third!.itemId).toBe(1131);
    // +29 and +33 are the orientation pair, measured in degrees on the real blueprints
    // (exact right angles bounded in [0, 360)).
    expect(first!.yaw).toBeCloseTo(0, 6);
    expect(first!.yaw2).toBeCloseTo(0, 6);
  });

  it('does not invent field meanings for the trailing i32 array', () => {
    // The 61-byte record carries five i32 elements after the 41-byte head. Their meaning
    // is not established — the first two read -1/-1 or a small link id depending on the
    // record — so the decoder consumes them without claiming they are object references.
    const body = decodeBody(v1Body(RECORDS));
    for (const b of body.buildings) {
      expect(b.parameters).toEqual([]);
    }
  });

  it('does not apply v1 framing when the record area is not a whole number of records', () => {
    // One byte short. `decodeBody` still has a lenient legacy fallback for very old
    // bodies, so the contract to assert is narrower and more useful: the v1 framing
    // must not claim this buffer, i.e. it must not produce exactly these records.
    const bytes = v1Body(RECORDS);
    let buildings = -1;
    try {
      buildings = decodeBody(bytes.subarray(0, bytes.length - 1)).buildings.length;
    } catch {
      buildings = -1; // refusing outright is also correct
    }
    expect(buildings).not.toBe(RECORDS.length);
  });

  it('does not apply v1 framing when a trailing byte would be left over', () => {
    const bytes = v1Body(RECORDS);
    const padded = new Uint8Array(bytes.length + 1);
    padded.set(bytes);
    let buildings = -1;
    try {
      buildings = decodeBody(padded).buildings.length;
    } catch {
      buildings = -1;
    }
    expect(buildings).not.toBe(RECORDS.length);
  });
});
