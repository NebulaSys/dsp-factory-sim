import { describe, expect, it } from 'vitest';
import {
  decodeBlueprint,
  encodeBlueprint,
  encodeBody,
  decodeBody,
  buildingRecordSize,
  looksLikeBlueprint,
  type BlueprintBody,
} from '../src/engine/bp/codec.ts';

/** A small but structurally complete synthetic blueprint (2 areas, 3 buildings). */
function sampleBody(): BlueprintBody {
  return {
    header: {
      version: 2,
      cursorOffsetX: 4,
      cursorOffsetY: 5,
      cursorTargetArea: 0,
      dragboxSizeX: 12,
      dragboxSizeY: 12,
      primaryAreaIndex: 0,
      areaCount: 2,
    },
    areas: [
      {
        index: 0,
        parentIndex: -1,
        tropicAnchor: 0,
        areaSegments: 5,
        anchorLocalOffsetX: 0,
        anchorLocalOffsetY: 0,
        width: 200,
        height: 200,
      },
      {
        index: 1,
        parentIndex: 0,
        tropicAnchor: 1,
        areaSegments: 5,
        anchorLocalOffsetX: 3,
        anchorLocalOffsetY: -7,
        width: 200,
        height: 200,
      },
    ],
    buildings: [
      {
        index: 0,
        areaIndex: 0,
        x: 1.5,
        y: 2.25,
        z: 0,
        x2: 0,
        y2: 0,
        z2: 0,
        yaw: 0,
        yaw2: -1,
        tilt: 0,
        pitch: 0,
        tilt2: 0,
        pitch2: 0,
        itemId: 2303,
        recipeId: 1,
        modelIndex: 0,
        outputObjectIndex: -1,
        inputObjectIndex: -1,
        outputToSlot: 0,
        inputFromSlot: 0,
        outputFromSlot: 0,
        inputToSlot: 0,
        outputOffset: 0,
        inputOffset: 0,
        filterId: 0,
        parameters: [],
      },
      {
        index: 1,
        areaIndex: 0,
        x: -3.5,
        y: 8,
        z: 0,
        x2: 0,
        y2: 0,
        z2: 0,
        yaw: 1.5707963267948966,
        yaw2: -1,
        tilt: 0,
        pitch: 0,
        tilt2: 0,
        pitch2: 0,
        itemId: 2003,
        recipeId: 0,
        modelIndex: 1,
        outputObjectIndex: 7,
        inputObjectIndex: -1,
        outputToSlot: 1,
        inputFromSlot: 2,
        outputFromSlot: 3,
        inputToSlot: 4,
        outputOffset: 0,
        inputOffset: 0,
        filterId: 0,
        parameters: [1, -1, 0, 2],
      },
      {
        index: 2,
        areaIndex: 1,
        x: 0,
        y: 0,
        z: 0,
        x2: 0,
        y2: 0,
        z2: 0,
        yaw: 3.141592653589793,
        yaw2: -1,
        tilt: 0,
        pitch: 0,
        tilt2: 0,
        pitch2: 0,
        itemId: 2103,
        recipeId: 0,
        modelIndex: 0,
        outputObjectIndex: -1,
        inputObjectIndex: -1,
        outputToSlot: 0,
        inputFromSlot: 0,
        outputFromSlot: 0,
        inputToSlot: 0,
        outputOffset: 0,
        inputOffset: 0,
        filterId: 0,
        parameters: [],
      },
    ],
  };
}

/**
 * Positions/rotations are stored as float32, so compare them with a tolerance.
 *
 * The format has no independent second anchor for ordinary buildings: the game
 * mirrors the primary anchor onto it, and so does this codec. Fixtures therefore
 * have their secondary anchor normalised before comparison instead of asserting
 * that an unused field round-trips verbatim.
 */
function expectBodyClose(actual: BlueprintBody, expected: BlueprintBody): void {
  expect(actual.header).toEqual(expected.header);
  expect(actual.areas).toEqual(expected.areas);
  expect(actual.buildings).toHaveLength(expected.buildings.length);
  expected.buildings.forEach((want, i) => {
    const got = actual.buildings[i]!;
    const hasOwnSecondAnchor = want.itemId > 2010 && want.itemId < 2020; // sorters only
    const wanted = hasOwnSecondAnchor
      ? want
      : { ...want, x2: want.x, y2: want.y, z2: want.z, yaw2: want.yaw };
    for (const key of ['x', 'y', 'z', 'x2', 'y2', 'z2', 'yaw', 'yaw2'] as const) {
      expect(got[key], `building ${i}.${key}`).toBeCloseTo(wanted[key], 5);
    }
    // `trailer` is the record's reserved 4-byte tail: fixtures do not supply it and
    // the writer defaults it to 0, so it is excluded from the exact comparison.
    const { x: _x, y: _y, z: _z, x2: _x2, y2: _y2, z2: _z2, yaw: _yaw, yaw2: _yaw2, trailer: _t, ...exact } = wanted;
    const { x: _ax, y: _ay, z: _az, x2: _ax2, y2: _ay2, z2: _az2, yaw: _ayaw, yaw2: _ayaw2, trailer: _at, ...gotExact } = got;
    expect(gotExact, `building ${i} (non-float fields)`).toEqual(exact);
  });
}

describe('blueprint binary body codec', () => {
  it('round-trips through the binary body format', () => {
    const body = sampleBody();
    const bytes = encodeBody(body);
    // body v1: 32-byte header + 2 padded 16-byte area records, then path102
    // building records. Each record is 49 fixed bytes, +4 for a belt's tilt,
    // +32 for a sorter's orientation block, +4 per parameter.
    // body v1 layout: 32-byte header + 2 padded 16-byte area records, then one
    // path102 record per building. Measured record sizes (tools/tests keep these
    // pinned): plain building 49, belt 53 (+tilt float), sorter 81
    // (+32 orientation block), plus 4 bytes per parameter.
    const record = (itemId: number, parameters: number): number => buildingRecordSize(itemId, parameters);
    const sample = sampleBody();
    expect(sample.buildings.map((b) => [b.itemId, b.parameters.length])).toEqual([
      [2303, 0],
      [2003, 4],
      [2103, 0],
    ]);
    // 29-byte header + 2 x 14-byte areas + u32 building count, then one path
    // number plus record per building. `buildingRecordSize` is the single source
    // of truth for the record layout.
    const expected =
      29 +
      2 * 14 +
      4 +
      sample.buildings.reduce((sum, b) => sum + buildingRecordSize(b.itemId, b.parameters.length), 0);
    expect(bytes.length).toBe(expected);
    expectBodyClose(decodeBody(bytes), body);
  });

  it('preserves negative coordinates and fractional positions', () => {
    const body = sampleBody();
    const decoded = decodeBody(encodeBody(body));
    expect(decoded.buildings[1]!.x).toBeCloseTo(-3.5, 5);
    expect(decoded.buildings[0]!.y).toBeCloseTo(2.25, 5);
  });

  it('rejects a truncated body', () => {
    const bytes = encodeBody(sampleBody());
    expect(() => decodeBody(bytes.subarray(0, 40))).toThrow(/truncated|too short|could not decode/);
  });
});

describe('blueprint text envelope', () => {
  it('recognises blueprint strings', () => {
    expect(looksLikeBlueprint('  BLUEPRINT:0,10,...')).toBe(true);
    expect(looksLikeBlueprint('DYBPabcdef')).toBe(true);
    expect(looksLikeBlueprint('{"json":true}')).toBe(false);
  });

  it('round-trips a blueprint through the text wire format', async () => {
    const body = sampleBody();
    const text = await encodeBlueprint(body, {
      meta: {
        gameVersion: '0.10.30.24610',
        shortDesc: '铁块线',
        longDesc: '铁矿→铁块 60/min',
        timestampTicks: 638000000000000000,
      },
    });
    expect(text.startsWith('BLUEPRINT:')).toBe(true);
    expect(text).toContain('0.10.30.24610');

    const decoded = await decodeBlueprint(text);
    expect(decoded.format).toBe('text');
    expect(decoded.hashWarning).toBeUndefined();
    expect(decoded.meta.shortDesc).toBe('铁块线');
    expect(decoded.meta.longDesc).toBe('铁矿→铁块 60/min');
    expect(decoded.meta.gameVersion).toBe('0.10.30.24610');
    expect(decoded.meta.timestampTicks).toBe(638000000000000000);
    expectBodyClose(decoded.body, body);
  });

  it('reports a hash mismatch instead of silently accepting it', async () => {
    const text = await encodeBlueprint(sampleBody());
    const tampered = text.slice(0, text.length - 1) + (text.endsWith('A') ? 'B' : 'A');
    const decoded = await decodeBlueprint(tampered);
    expect(decoded.hashWarning).toMatch(/hash mismatch/);
    // still decodes structurally
    expectBodyClose(decoded.body, sampleBody());
  });

  it('rejects a malformed header', async () => {
    await expect(decodeBlueprint('BLUEPRINT:0,10,0')).rejects.toThrow(/malformed/);
  });
});

describe('blueprint binary container (DYBP)', () => {
  it('round-trips a blueprint through the binary wire format', async () => {
    const body = sampleBody();
    const text = await encodeBlueprint(body, { format: 'binary' });
    expect(text.startsWith('DYBP')).toBe(true);

    const decoded = await decodeBlueprint(text);
    expect(decoded.format).toBe('binary');
    expect(decoded.containerVersion).toBe(1);
    expect(decoded.payloadCodec).toBe('gzip');
    expectBodyClose(decoded.body, body);
  });

  it('accepts a bare payload without the DYBP prefix when it is unambiguous', async () => {
    const text = await encodeBlueprint(sampleBody(), { format: 'binary', bare: true });
    const decoded = await decodeBlueprint(text);
    expect(decoded.format).toBe('binary');
    expectBodyClose(decoded.body, sampleBody());
  });
});
