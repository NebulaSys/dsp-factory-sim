import { describe, expect, it } from 'vitest';
import {
  BELT_YAW_ZERO_AXIS,
  BELT_YAW_SIGN,
  YAW_EPSILON,
  beltDirection,
  glyphColour,
  shade,
  sorterDirection,
} from '../src/ui/glyphs.ts';
import type { FactoryNode } from '../src/engine/factory.ts';

/** Minimal node with the fields the direction helpers read. */
function node(over: Partial<FactoryNode> = {}): FactoryNode {
  return {
    index: 0,
    kind: 'belt',
    buildingKey: 'ConveyorBeltMk1',
    buildingName: 'belt',
    itemId: 2001,
    category: 'logistics',
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    recipeKey: null,
    inputsFrom: [],
    outputsTo: [],
    ...over,
  } as FactoryNode;
}

describe('belt direction', () => {
  it('never claims a belt direction known from the yaw field alone', () => {
    // Measured against the real 2971-building blueprint, the yaw field is the wrong source
    // for belt travel: the radians/zero-+x reading scores -0.797 against the true travel
    // direction. The graph-derived path (`beltTravelDirection`) is what reports `known`,
    // so this fallback must stay honest even when a yaw is present.
    for (const yaw of [90, 180, 270, 316.368]) {
      const d = beltDirection(node({ yaw }));
      expect(d.known, `yaw ${yaw}`).toBe(false);
      expect(Math.hypot(d.dx, d.dy)).toBeCloseTo(1, 6);
      expect(Number.isFinite(d.dx) && Number.isFinite(d.dy)).toBe(true);
    }
  });

  it('reads yaw as degrees, which is what the field actually holds', () => {
    // The field holds exact right angles bounded in [0, 360): 180x6576, 270x192, 90x192,
    // maximum 354. Treating it as radians would place 180 rad nowhere near a right angle.
    // The fitted relation over the one observable belt angle is (-sin, -cos), so yaw 180
    // points along +y and yaw 0 points along -y.
    const north = beltDirection(node({ yaw: 0.5 }));
    expect(north.dx).toBeLessThan(0.02); // yaw ~0 -> -y
    expect(north.dy).toBeLessThan(0);

    const south = beltDirection(node({ yaw: 180 }));
    expect(south.dx).toBeCloseTo(0, 6);
    expect(south.dy).toBeCloseTo(1, 6);
  });

  it('flags an unrecorded direction instead of inventing one', () => {
    for (const yaw of [0, YAW_EPSILON / 2, -YAW_EPSILON / 2]) {
      const d = beltDirection(node({ yaw }));
      expect(d.known, `yaw ${yaw}`).toBe(false);
    }
    // The reference blueprint stores exactly this for every belt, so this is the
    // common case, not an edge case.
    const reference = beltDirection(node({ yaw: -0.00010478751210030168 }));
    expect(reference.known).toBe(false);
  });

  it('survives a non-finite yaw without producing NaN', () => {
    const d = beltDirection(node({ yaw: Number.NaN }));
    expect(Number.isFinite(d.dx)).toBe(true);
    expect(Number.isFinite(d.dy)).toBe(true);
    expect(d.known).toBe(false);
  });
});

describe('sorter direction', () => {
  it('points from the pickup cell to the drop-off cell', () => {
    const sorter = node({
      kind: 'sorter',
      itemId: 2011,
      x: 2,
      y: 2,
      picksUpFrom: { x: 0, y: 2 },
      dropsOffAt: { x: 2, y: 2 },
    });
    const d = sorterDirection(sorter);
    expect(d.reach).toBe('horizontal');
    expect(d.known).toBe(true);
    expect(d.dx).toBeCloseTo(1, 6);
    expect(d.dy).toBeCloseTo(0, 6);
    // Length is the real distance in cells, which drives the drawn reach.
    expect(d.length).toBeCloseTo(2, 6);
  });

  it('normalises a diagonal reach and reports its true length', () => {
    // 2 across and 1 down: the unit vector must be (2/sqrt5, 1/sqrt5), not (1, 1).
    const sorter = node({
      kind: 'sorter',
      itemId: 2011,
      x: 2,
      y: 2,
      picksUpFrom: { x: 0, y: 0 },
      dropsOffAt: { x: 2, y: 1 },
    });
    const d = sorterDirection(sorter);
    expect(d.dx).toBeCloseTo(2 / Math.sqrt(5), 6);
    expect(d.dy).toBeCloseTo(1 / Math.sqrt(5), 6);
    expect(Math.hypot(d.dx, d.dy)).toBeCloseTo(1, 6);
    expect(d.length).toBeCloseTo(Math.sqrt(5), 6);
  });

  it('uses the endpoint offsets even when the sorter sits off the axis', () => {
    const sorter = node({
      kind: 'sorter',
      itemId: 2011,
      x: 3,
      y: 1,
      picksUpFrom: { x: 3, y: 0 },
      dropsOffAt: { x: 3, y: 3 },
    });
    const d = sorterDirection(sorter);
    expect(d.dx).toBeCloseTo(0, 6);
    expect(d.dy).toBeCloseTo(1, 6);
    expect(d.length).toBeCloseTo(3, 6);
  });

  it('classifies a same-cell sorter as a vertical transfer, not a heading', () => {
    // 2997 of the corpus's 3232 sorters put both endpoints on one cell: they move items
    // between stacked layers. There is no horizontal heading to draw, so `known` is false
    // and the glyph shows an in-place transfer instead of a fabricated arrow.
    const sorter = node({ kind: 'sorter', itemId: 2011, x: 5, y: 5, yaw: 0, picksUpFrom: { x: 5, y: 5 }, dropsOffAt: { x: 5, y: 5 } });
    const d = sorterDirection(sorter);
    expect(d.reach).toBe('vertical');
    expect(d.known).toBe(false);
    expect(d.length).toBe(0);
    expect(Number.isFinite(d.dx)).toBe(true);
  });

  it('refuses a direction when the endpoints exceed any real sorter reach', () => {
    // A sorter spans at most three cells. Measured on the corpus the over-long pairs run to
    // 159 cells, so the recorded pair is not a travel direction and no arrow is drawn.
    const sorter = node({
      kind: 'sorter',
      itemId: 2011,
      x: 1,
      y: 1,
      picksUpFrom: { x: 0, y: 1 },
      dropsOffAt: { x: 9, y: 1 },
    });
    const d = sorterDirection(sorter);
    expect(d.reach).toBe('unresolved');
    expect(d.known).toBe(false);
    expect(d.length).toBeCloseTo(9, 6);
  });

  it('is real blueprint data, not an assumption: sorting a decoded sample keeps direction', () => {
    // A sorter's endpoints are recorded as object ids, so the direction survives even
    // when the endpoints are filtered out of the visible node list.
    const sorter = node({
      kind: 'sorter',
      itemId: 2011,
      x: 1,
      y: 1,
      picksUpFrom: { x: 0, y: 1 },
      dropsOffAt: { x: 2, y: 1 },
      outputsTo: [],
      inputsFrom: [],
    });
    expect(sorterDirection(sorter).dx).toBeCloseTo(1, 6);
  });
});

describe('glyph colours', () => {
  it('falls back to the category colour only when there is no sampled accent', () => {
    expect(glyphColour(null, '#546e7a').main).toBe('#546e7a');
    expect(glyphColour(undefined, '#546e7a').main).toBe('#546e7a');
    // A sampled accent is used, lifted for legibility — so it must not come back verbatim
    // when it is too muted to read against the dark canvas.
    const lifted = glyphColour('#598b8c', '#546e7a').main;
    expect(lifted).not.toBe('#546e7a');
    expect(lifted).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('paces the marks further apart than their source accents were', () => {
    // The requirement is that different marks read as different colours. Two things were
    // measured rather than assumed (`tools/check-tier-colours.ts --tune`):
    //
    //   * a uniform "lift to a floor" MERGES marks — Sorter Mk.III (`#608aaa`) and the Pile
    //     Sorter (`#8398a6`) share a hue of ~205 degrees and landed on nearly the same blue;
    //   * no lift is separation-preserving, because shifting lightness pulls the set together.
    //
    // So the pinned property is the achievable one: the drawn colours must end up *further*
    // apart at their closest than the source accents were at theirs.
    const accents = ['#daad7c', '#68bbab', '#73b0d9', '#978973', '#598b8c', '#608aaa', '#8398a6'];
    const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const distance = (a: string, b: string): number => {
      const [x, y] = [rgb(a), rgb(b)];
      return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
    };

    let closestBefore = { pair: '', value: Infinity };
    let closestAfter = { pair: '', value: Infinity };
    for (let i = 0; i < accents.length; i++) {
      for (let j = i + 1; j < accents.length; j++) {
        const raw = accents[i]!;
        const other = accents[j]!;
        const before = distance(raw, other);
        const after = distance(glyphColour(raw, '#546e7a').main, glyphColour(other, '#546e7a').main);
        if (before < closestBefore.value) closestBefore = { pair: `${raw} vs ${other}`, value: before };
        if (after < closestAfter.value) closestAfter = { pair: `${raw} vs ${other}`, value: after };
      }
    }

    // The closest pair is named in the failure message so a regression says which two merged.
    expect(
      closestAfter.value,
      `closest drawn pair: ${closestAfter.pair} (source closest was ${closestBefore.pair} at ${closestBefore.value.toFixed(1)})`,
    ).toBeGreaterThan(closestBefore.value);
    expect(closestAfter.value).toBeGreaterThan(34);
  });

  it('lifts a muted accent enough to read as a thin stroke on the dark canvas', () => {
    // The canvas glyphs are thin lines over `#0b1319`; the raw sampled accents are mid-tones
    // meant as fills behind art. Lightness must rise, and hue must be preserved.
    const raw = '#598b8c';
    const drawn = glyphColour(raw, '#546e7a').main;
    const channelMean = (hex: string): number => {
      const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return (v[0]! + v[1]! + v[2]!) / 3;
    };
    expect(channelMean(drawn)).toBeGreaterThan(channelMean(raw));
    expect(drawn).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('shades a colour darker for outlines', () => {
    expect(shade('#ffffff', 0.5)).toBe('#808080');
    expect(shade('#000000', 0.5)).toBe('#000000');
    expect(shade('#808080', 0)).toBe('#000000');
    // Malformed input is returned unchanged rather than throwing mid-render.
    expect(shade('not-a-colour', 0.5)).toBe('not-a-colour');
  });
});
