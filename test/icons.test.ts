import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { iconFor, paletteFor, ICON_KEYS, allIconUrls } from '../src/ui/icons.ts';
import manifestJson from '../src/engine/data/building-icons.json';
import datasetJson from '../src/engine/data/dsp-vanilla.json';

const manifest = (manifestJson as { icons: Record<string, { file: string; width: number | null; height: number | null; bbox: { x: number; y: number; w: number; h: number } | null; palette: { accent: string; mean: string; dark: string } | null }> }).icons;
const buildingKeys = new Set((datasetJson as { buildings: { key: string }[] }).buildings.map((b) => b.key));

/**
 * The production-line view scales each sprite's *visible* art to the building's
 * footprint, which only works if the manifest carries the measured opaque box.
 * Without it the padded 80x80 canvas is scaled instead and buildings look too
 * small for the space they occupy.
 */
describe('building icon manifest', () => {
  it('measures an opaque bounding box for every mapped icon', () => {
    const missing = Object.entries(manifest)
      .filter(([, entry]) => !entry.bbox)
      .map(([key]) => key);
    expect(missing).toEqual([]);
  });

  it('keeps every bounding box inside its source image', () => {
    for (const [key, entry] of Object.entries(manifest)) {
      const box = entry.bbox;
      expect(box, key).not.toBeNull();
      if (!box) continue;
      expect(box.w, key).toBeGreaterThan(0);
      expect(box.h, key).toBeGreaterThan(0);
      expect(box.x, key).toBeGreaterThanOrEqual(0);
      expect(box.y, key).toBeGreaterThanOrEqual(0);
      if (entry.width !== null) expect(box.x + box.w, key).toBeLessThanOrEqual(entry.width);
      if (entry.height !== null) expect(box.y + box.h, key).toBeLessThanOrEqual(entry.height);
    }
  });

  it('crops a meaningful margin: the padded canvas is not the art', () => {
    // The wiki sprites really do carry margin, so the box must be smaller than the
    // canvas for at least most icons — otherwise the measurement is a no-op.
    const entries = Object.values(manifest).filter((e) => e.bbox && e.width && e.height);
    const cropped = entries.filter((e) => e.bbox!.w < e.width! || e.bbox!.h < e.height!);
    expect(entries.length).toBeGreaterThan(20);
    expect(cropped.length / entries.length).toBeGreaterThan(0.8);
  });

  it('samples a palette from each icon, distinct per belt tier', () => {
    for (const key of Object.keys(manifest)) {
      const palette = paletteFor(key);
      expect(palette, key).not.toBeNull();
      expect(palette?.accent, key).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Belt tiers must be visually distinguishable, or the view cannot show them.
    const tiers = ['ConveyorBeltMk1', 'ConveyorBeltMk2', 'ConveyorBeltMk3'].map((k) => paletteFor(k)?.accent);
    expect(new Set(tiers).size).toBe(3);
  });

  it('only maps keys that exist in the dataset', () => {
    const unknown = [...ICON_KEYS].filter((key) => !buildingKeys.has(key));
    expect(unknown).toEqual([]);
  });

  it('has every referenced icon file on disk', () => {
    const root = resolve(import.meta.dirname, '..');
    const missing = allIconUrls().filter((url) => !existsSync(resolve(root, 'public', url.replace(/^\//, ''))));
    expect(missing).toEqual([]);
  });

  it('exposes the bounding box through the accessor the renderer uses', () => {
    const asset = iconFor('AssemblingMachineMk1');
    expect(asset).not.toBeNull();
    expect(asset?.bbox).not.toBeNull();
    // The assembler's art does not fill its 75x78 canvas.
    expect(asset!.bbox!.w).toBeLessThanOrEqual(asset!.width!);
    expect(asset!.bbox!.h).toBeLessThanOrEqual(asset!.height!);
    // An unknown building has no icon and therefore no crop.
    expect(iconFor('NotARealBuilding')).toBeNull();
    expect(iconFor(null)).toBeNull();
    expect(paletteFor(null)).toBeNull();
  });

  it('records the source and licence so the asset provenance is auditable', () => {
    const meta = manifestJson as { source?: string; license?: string; note?: string };
    expect(meta.source).toContain('dsp-wiki.com');
    expect(meta.license ?? '').toMatch(/Youthcat|wiki/i);
    expect(meta.note ?? '').toMatch(/bbox/i);
    // The generator writes a sibling palette note too; keep provenance explicit.
    expect(readFileSync(resolve(import.meta.dirname, '../tools/fetch-icons.mjs'), 'utf8')).toContain('dsp-wiki.com');
  });
});
