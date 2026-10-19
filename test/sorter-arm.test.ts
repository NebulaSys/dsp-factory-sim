/**
 * Sorter arms come from the record's own anchors, not from its link fields.
 *
 * `outputObjectIndex` / `inputObjectIndex` name the object a sorter is wired to logically.
 * Measured over the whole corpus those targets are not neighbours — only 1.5% land within 0.01
 * cells of either arm end and the median distance is 4.5 cells — because several sorters feeding
 * one belt all point at the same belt record. The record's two anchors `(x, y, z)` and
 * `(x2, y2, z2)` are the ends of the arm itself: over 4427 sorters their horizontal span is 1-3
 * cells for 96% of them.
 *
 * Before this, the view classified the reach from the link fields and drew 2997 of 3232 sorters
 * as in-place layer transfers. These tests pin the corrected behaviour and — just as
 * importantly — that the sign is only claimed when the data establishes it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';
import { convertBlueprint, type FactoryNode } from '../src/engine/factory.ts';
import { sorterDirection } from '../src/ui/glyphs.ts';

const ROOT = resolve(__dirname, '..');
const data = loadDataset(
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')),
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/building-slots.json'), 'utf8')),
);

const node = (extra: Partial<FactoryNode>): FactoryNode =>
  ({ index: 0, x: 0, y: 0, z: 0, yaw: 0, itemId: 2011, kind: 'sorter', inputsFrom: [], outputsTo: [], ...extra }) as FactoryNode;

describe('sorter arm classification', () => {
  it('uses the arm anchors for a plain 2-cell arm', () => {
    const d = sorterDirection(node({ armFrom: { x: 10, y: 10 }, armTo: { x: 12, y: 10 }, picksUpFrom: { x: 10, y: 10 }, dropsOffAt: { x: 10, y: 10 } }));
    expect(d.reach).toBe('horizontal');
    expect(d.length).toBeCloseTo(2, 6);
    expect(d.dx).toBeCloseTo(1, 6);
    expect(d.dy).toBeCloseTo(0, 6);
  });

  it('does not claim a sign when the link gives none', () => {
    // The link falls back to the sorter's own cell, so it establishes nothing.
    const d = sorterDirection(node({ armFrom: { x: 10, y: 10 }, armTo: { x: 10, y: 12 }, picksUpFrom: { x: 10, y: 10 }, dropsOffAt: { x: 10, y: 10 } }));
    expect(d.reach).toBe('horizontal');
    expect(d.signKnown).toBe(false);
    expect(d.known).toBe(false);
  });

  it('claims a sign only when the link lies along the arm', () => {
    const along = sorterDirection(
      node({ armFrom: { x: 10, y: 10 }, armTo: { x: 10, y: 12 }, picksUpFrom: { x: 10, y: 10 }, dropsOffAt: { x: 10, y: 12 } }),
    );
    expect(along.signKnown).toBe(true);

    // A link that runs across the arm must not be read as establishing the sign.
    const across = sorterDirection(
      node({ armFrom: { x: 10, y: 10 }, armTo: { x: 10, y: 12 }, picksUpFrom: { x: 8, y: 10 }, dropsOffAt: { x: 10, y: 10 } }),
    );
    expect(across.signKnown).toBe(false);
  });

  it('refuses an over-long pair as an arm', () => {
    // A 7.5-cell pair occurs in the corpus and is not a sorter arm; without a usable arm the
    // classification falls back to the links, which here are also far apart.
    const d = sorterDirection(node({ armFrom: { x: 0, y: 0 }, armTo: { x: 7.5, y: 0 }, picksUpFrom: { x: 0, y: 0 }, dropsOffAt: { x: 20, y: 0 } }));
    expect(d.reach).toBe('unresolved');
  });

  it('still reports a same-cell sorter as a vertical transfer', () => {
    const d = sorterDirection(node({ picksUpFrom: { x: 5, y: 5 }, dropsOffAt: { x: 5, y: 5 } }));
    expect(d.reach).toBe('vertical');
    expect(d.signKnown).toBe(false);
  });
});

describe('blueprint conversion records the arm', () => {
  it('sets armFrom / armTo from the record anchors for real sorters', async () => {
    const bp = await decodeBlueprint(readFileSync(resolve(ROOT, 'public/samples/factory-v2.txt'), 'utf8').trim());
    const model = convertBlueprint(data, bp);
    const sorters = model.nodes.filter((n) => n.kind === 'sorter');
    expect(sorters.length).toBeGreaterThan(1000);

    const withArm = sorters.filter((n) => n.armFrom && n.armTo);
    // Measured on this sample: overwhelmingly 1-3 cell horizontal arms.
    expect(withArm.length / sorters.length).toBeGreaterThan(0.95);

    for (const n of withArm) {
      const span = Math.hypot(n.armTo!.x - n.armFrom!.x, n.armTo!.y - n.armFrom!.y);
      expect(span).toBeGreaterThanOrEqual(0.5);
      expect(span).toBeLessThanOrEqual(3.05);
      // The arm starts at the sorter's own recorded position.
      expect(n.armFrom!.x).toBeCloseTo(n.x, 6);
      expect(n.armFrom!.y).toBeCloseTo(n.y, 6);
    }
  });

  it('classifies almost every sorter in the sample as a real arm', async () => {
    const bp = await decodeBlueprint(readFileSync(resolve(ROOT, 'public/samples/factory-v2.txt'), 'utf8').trim());
    const model = convertBlueprint(data, bp);
    const sorters = model.nodes.filter((n) => n.kind === 'sorter');
    const horizontal = sorters.filter((n) => sorterDirection(n).reach === 'horizontal');
    // This is the point of the change: the link fields left only a handful horizontal.
    expect(horizontal.length / sorters.length).toBeGreaterThan(0.95);
  });
});
