import { describe, expect, it } from 'vitest';
import { decodeBody } from '../src/engine/bp/codec.ts';

/**
 * Body-version-1 variable-length records.
 *
 * The record length is `41 + 4n` — verified on 1649 of 1654 records across the corpus —
 * but `n` is not stored anywhere in the head, so the length cannot be computed from the
 * record's contents. Record starts are therefore located by the invariants the real data
 * satisfies:
 *
 *   * `index` at +0 equals the record's ordinal, and
 *   * the head at +37 is a real building prototype id, and
 *   * `areaIndex` at +4 names one of the declared areas.
 *
 * These fixtures are built here because the assertions are about the framing and the
 * guards, and a hand-built body makes the rejecting cases explicit.
 */

const HEAD = 41;

interface Rec {
  index: number;
  itemId: number;
  /** Extra i32 elements appended after the 41-byte head. */
  tail?: number[];
  /** Override the areaIndex byte, to build a deliberately invalid record. */
  areaIndex?: number;
}

function v1VariableBody(records: Rec[], areaCount = 1): Uint8Array {
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

  u32(1); // body version
  u32(0);
  u32(0);
  u32(0);
  u32(1);
  u32(1);
  u32(0);
  u8(areaCount);
  for (let i = 0; i < areaCount; i++) {
    for (const v of [i, 0xff, 0, 0, 0xa0, 0, 0, 0, 0, 0, 1, 0, 1, 0]) u8(v);
  }
  u32(records.length);

  for (const r of records) {
    i32(r.index); // +0
    u8(r.areaIndex ?? 0); // +4
    f32(r.index); // x
    f32(0); // y
    f32(r.index * 8); // z, the layer ladder
    f32(r.index);
    f32(0);
    f32(r.index * 8);
    f32(90); // yaw, degrees
    f32(90); // yaw2
    i16(r.itemId); // +37
    i16(53); // +39
    for (const t of r.tail ?? []) i32(t);
  }
  return Uint8Array.from(bytes);
}

/** The 61-byte shape carries five i32 elements after the head. */
const FIVE = [-1, -1, 16777216, 0, 0];

/** `decodeBody` still has a lenient legacy fallback, so the honest contract is that the v1
 * variable framing must not claim a malformed buffer — not that the call throws. */
function buildingsAccepted(bytes: Uint8Array): number {
  try {
    return decodeBody(bytes).buildings.length;
  } catch {
    return -1; // refusing outright is also acceptable
  }
}

describe('body version 1 with variable-length records', () => {
  it('decodes a mix of record lengths in one body', () => {
    const body = decodeBody(
      v1VariableBody([
        { index: 0, itemId: 2003, tail: FIVE },
        { index: 1, itemId: 2013, tail: [-1, -1, 16777216, 0, 0, 0] },
        { index: 2, itemId: 2003 },
        { index: 3, itemId: 2204, tail: FIVE },
      ]),
    );
    expect(body.buildings).toHaveLength(4);
    expect(body.buildings.map((b) => b.itemId)).toEqual([2003, 2013, 2003, 2204]);
    expect(body.buildings.map((b) => b.z)).toEqual([0, 8, 16, 24]);
  });

  it('reads the head fields, including orientation in degrees', () => {
    const body = decodeBody(v1VariableBody([{ index: 0, itemId: 2203, tail: FIVE }]));
    const b = body.buildings[0]!;
    expect(b.itemId).toBe(2203);
    expect(b.modelIndex).toBe(53);
    expect(b.areaIndex).toBe(0);
    // +29 / +33 hold degrees, measured as exact right angles bounded in [0, 360).
    expect(b.yaw).toBeCloseTo(90, 6);
    expect(b.yaw2).toBeCloseTo(90, 6);
  });

  it('handles both measured belt lengths in one body', () => {
    // A belt carries 5 elements, or 7 when the record holds the extra pair — the only
    // prototype whose length is not single-valued. Both must decode in the same body.
    const body = decodeBody(
      v1VariableBody([
        { index: 0, itemId: 2003, tail: FIVE },
        { index: 1, itemId: 2003, tail: [-1, -1, 16777216, 0, 131072, 1006, 360] },
        { index: 2, itemId: 2204, tail: FIVE },
      ]),
    );
    expect(body.buildings).toHaveLength(3);
    expect(body.buildings.map((b) => b.itemId)).toEqual([2003, 2003, 2204]);
    expect(body.buildings.map((b) => b.z)).toEqual([0, 8, 16]);
  });

  it('does not accept a body whose second record has an impossible prototype id', () => {
    // Without the id guard the walk would accept a spurious `index` match and silently
    // emit a wrong building, which is exactly the failure the guard exists to prevent.
    // Record 1 is given a different length so the fixed-61 path cannot handle the body and
    // the variable-length framing is the one under test.
    const bytes = v1VariableBody([
      { index: 0, itemId: 2003, tail: FIVE },
      { index: 1, itemId: 3, tail: [0] },
    ]);
    expect(buildingsAccepted(bytes)).not.toBe(2);
  });

  it('does not accept a record whose areaIndex names no declared area', () => {
    const bytes = v1VariableBody([
      { index: 0, itemId: 2003, tail: FIVE },
      { index: 1, itemId: 2003, areaIndex: 9, tail: [0] },
    ]);
    expect(buildingsAccepted(bytes)).not.toBe(2);
  });

  it('does not accept a body with a record off the 41 + 4n lattice', () => {
    // A record of 43 bytes is `41 + 2`, which no real record can be. The boundary guards can
    // be satisfied by a wrong offset (one corpus blueprint walks "complete" with lengths of
    // 52 and 70), so the lattice is checked for every record rather than assumed.
    const good = v1VariableBody([
      { index: 0, itemId: 2003, tail: FIVE },
      { index: 1, itemId: 2003, tail: FIVE },
    ]);
    // Splice in two stray bytes, making the first record 63 bytes: off-lattice.
    const shifted = new Uint8Array(good.length + 2);
    shifted.set(good.subarray(0, good.length - 59), 0);
    shifted.set(good.subarray(good.length - 59), good.length - 59 + 2);
    expect(buildingsAccepted(shifted)).not.toBe(2);
  });

  it('decodes a record far larger than the common 41-89 bytes', () => {
    // Records are not bounded at ~89 bytes: the corpus places the next record exactly 8253
    // bytes after the previous one in two blueprints, which is `41 + 4 x 2053`. A cap below
    // that silently stops the walk, which is what happened at 512 and again at 8192.
    const huge = new Array<number>(2053).fill(-1);
    const body = decodeBody(
      v1VariableBody([
        { index: 0, itemId: 2204, tail: huge },
        { index: 1, itemId: 2204, tail: FIVE },
        { index: 2, itemId: 2013, tail: [0, 0, 0, 0, 0, 0] },
      ]),
    );
    expect(body.buildings).toHaveLength(3);
    expect(body.buildings.map((b) => b.itemId)).toEqual([2204, 2204, 2013]);
    // The record really is 8253 bytes, so this is the case the cap has to allow.
    expect(HEAD + 4 * 2053).toBe(8253);
  });

  it('does not accept a body whose record area is not consumed exactly', () => {
    const bytes = v1VariableBody([{ index: 0, itemId: 2003, tail: FIVE }]);
    const padded = new Uint8Array(bytes.length + 3);
    padded.set(bytes);
    expect(buildingsAccepted(padded)).not.toBe(1);
  });
});
