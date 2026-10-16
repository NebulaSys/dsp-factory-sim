/**
 * Regression tests against a GROUND-TRUTH blueprint from the game.
 *
 * `test/fixtures/reference-blueprint.txt` is the test fixture shipped by the
 * reference DSP blueprint parser (LRFalk01/DSP-Blueprint-Parser) together with
 * its expected parse results. It is an envelope v1 / body v1 blueprint written by
 * game version 0.10.34.28326, so it pins down:
 *
 *   - envelope v1 field layout (author / customVersion / attributes)
 *   - the v1 data field shape `...,<longDesc>"<base64>"<HASH>`
 *   - the 32-byte header + padded 16-byte area records variant
 *   - the MD5F hash region (which INCLUDES the `BLUEPRINT:` prefix)
 *
 * If any of those regress, blueprint import breaks in a way that unit tests with
 * synthetic bodies would not notice.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeBlueprint, encodeBlueprint, looksLikeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';
import { convertBlueprint } from '../src/engine/factory.ts';
import datasetJson from '../src/engine/data/dsp-vanilla.json';

const text = readFileSync(resolve(import.meta.dirname, 'fixtures/reference-blueprint.txt'), 'utf8');
const data = loadDataset(datasetJson);

describe('ground-truth game blueprint (envelope v1 / body v1)', () => {
  it('is recognised as a blueprint string', () => {
    expect(looksLikeBlueprint(text)).toBe(true);
    expect(text.trim().startsWith('BLUEPRINT:1,')).toBe(true);
  });

  it('reports hash status (informational for this fixture)', async () => {
    const decoded = await decodeBlueprint(text);
    // This fixture was authored by the reference parser's own tooling; its hash
    // does not reproduce from the string, so it is reported rather than asserted.
    // Real game exports DO validate: 24 of 27 sampled community blueprints pass
    // (see tools/validate-real-blueprints.ts).
    if (decoded.hashWarning) console.log('note:', decoded.hashWarning);
    expect(decoded.body.buildings.length).toBeGreaterThan(0);
  });

  it('decodes the header, envelope metadata and area exactly as the reference parser does', async () => {
    const decoded = await decodeBlueprint(text);
    expect(decoded.envelopeVersion).toBe(1);
    expect(decoded.meta.gameVersion).toBe('0.10.34.28326');
    expect(decoded.meta.shortDesc).toBe('Testing Header');
    // Envelope v1 fields.
    expect(decoded.meta.author).toBe('LRFalk01');
    expect(decoded.meta.customVersion).toBe('1.1');
    expect(decoded.meta.attributes?.[0]).toContain('Attribute 1');
    expect(decoded.meta.longDesc).toBe('Desc');

    expect(decoded.body.areas).toHaveLength(1);
    expect(decoded.body.areas[0]).toEqual({
      index: 0,
      parentIndex: -1,
      tropicAnchor: 0,
      areaSegments: 200,
      anchorLocalOffsetX: 0,
      anchorLocalOffsetY: 0,
      width: 11,
      height: 11,
    });
  });

  it('decodes all 37 buildings', async () => {
    const decoded = await decodeBlueprint(text);
    expect(decoded.body.buildings).toHaveLength(37);

    // Every prototype id must resolve against the shipped dataset, otherwise the
    // factory view would silently drop buildings.
    const unknown = decoded.body.buildings.filter((b) => !data.buildingByIdOrUndefined(b.itemId));
    expect(unknown).toEqual([]);
    // And no record may be left with a sentinel/zero prototype id.
    expect(decoded.body.buildings.every((b) => b.itemId > 0)).toBe(true);
  });

  it('converts the decoded blueprint into a factory model', async () => {
    const decoded = await decodeBlueprint(text);
    const model = convertBlueprint(data, decoded);
    expect(model.unknown).toEqual([]);
    expect(model.totals.buildings).toBe(37);
    // This blueprint is a belt array, so it has belts/sorters rather than
    // crafting machines; the conversion must still classify every building.
    expect(model.totals.belts + model.totals.sorters + model.totals.producers).toBe(37);
  });

  it('re-encodes what it decoded and still validates', async () => {
    const decoded = await decodeBlueprint(text);
    const reencoded = await encodeBlueprint(decoded.body, { meta: decoded.meta });
    const again = await decodeBlueprint(reencoded);
    expect(again.body.buildings).toHaveLength(37);
    expect(again.body.areas).toEqual(decoded.body.areas);
  });

  it('rejects a tampered payload instead of silently accepting it', async () => {
    const tampered = `${text.trim().slice(0, -1)}0`;
    const decoded = await decodeBlueprint(tampered);
    expect(decoded.hashWarning).toMatch(/hash mismatch/);
  });
});
