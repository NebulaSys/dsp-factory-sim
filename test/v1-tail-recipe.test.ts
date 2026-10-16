/**
 * The v1 record tail carries the recipe.
 *
 * v1 has no `recipeId` field — its head is `index, areaIndex, anchor, anchor2, yaw, yaw2, itemId,
 * modelIndex` and then an i32 array. Whatever a machine needs beyond position and prototype has
 * to live in that array, and until it was decoded the rate tables came out empty for 27 of the
 * 28 corpus blueprints.
 *
 * The recipe is an `i16` at tail **byte offset 14** — the high half of `tail[3]`. Read as a float
 * the same four bytes look like a plausible number (`0x42000000` is 32.0f) which is precisely the
 * trap that hid it, so these tests pin the byte-level reading.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';
import { convertBlueprint } from '../src/engine/factory.ts';

const ROOT = resolve(__dirname, '..');
const data = loadDataset(
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')),
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/building-slots.json'), 'utf8')),
);
const CORPUS = resolve(ROOT, 'docs/research/_raw/realbp');

/**
 * The real-blueprint corpus is third-party data and is NOT vendored here (see .gitignore).
 *
 * A fresh clone therefore has no corpus, and tests that measure against it must skip rather
 * than fail — otherwise `pnpm test` is red for anyone who just cloned the repo, which trains
 * people to ignore a red suite. `node tools/fetch-corpus.mjs` stages it and these run for real.
 */
const CORPUS_PRESENT = existsSync(CORPUS);
if (!CORPUS_PRESENT) {
  console.log('[v1-tail-recipe] corpus not staged — corpus-dependent assertions skipped.');
  console.log('                  run `node tools/fetch-corpus.mjs` to enable them.');
}

const decodeCorpus = async () => {
  const out: { file: string; bp: Awaited<ReturnType<typeof decodeBlueprint>> }[] = [];
  if (!CORPUS_PRESENT) return out;
  for (const f of readdirSync(CORPUS).filter((x) => x.endsWith('.txt'))) {
    try {
      out.push({ file: f, bp: await decodeBlueprint(readFileSync(resolve(CORPUS, f), 'utf8').trim()) });
    } catch {
      /* the corpus-status gate covers decodability */
    }
  }
  return out;
};

/**
 * These two need no corpus: one is pure arithmetic, the other uses a bundled sample.
 * They must keep running on a fresh clone, so they are deliberately outside the skipIf below.
 */
describe('v1 tail decoding (no corpus needed)', () => {
  it('does not fall for the 32-bit shift overflow', () => {
    // `(0x00420000 << 16) >> 16` is 0 in JavaScript because the shift overflows 32 bits, and
    // that silently loses every recipe. Pin the value that must come out.
    const tail = [-1, 3731, 0, 0x00420000, 65536, 0];
    const viaOverflow = (tail[3]! << 16) >> 16;
    expect(viaOverflow).toBe(0); // the wrong reading
    // The right one, as the codec computes it:
    const raw = (tail[3]! >> 16) & 0xffff;
    expect(raw >= 0x8000 ? raw - 0x10000 : raw).toBe(66);
  });

  it('leaves path102 records on their named fields', async () => {
    // v2 carries recipeId as a real field, so the tail path must not interfere.
    const bp = await decodeBlueprint(readFileSync(resolve(ROOT, 'public/samples/factory-v2.txt'), 'utf8').trim());
    expect(bp.body.layout).toBe('path102');
    for (const b of bp.body.buildings) expect(b.tail).toBeUndefined();
  });
});

describe.skipIf(!CORPUS_PRESENT)('v1 tail recipe decoding (needs third-party corpus)', () => {
  it('reads the recipe from the high half of tail[3]', async () => {
    // The three 星际熔炉 blueprints are named 钛合金 / 钛块 / 高效金刚石, and that is exactly
    // what their PlaneSmelters are set to build.
    const expected: [string, number, string][] = [
      ['钛合金', 66, 'TitaniumAlloy'],
      ['钛块', 65, 'TitaniumIngot'],
      ['高效金刚石', 61, 'DiamondAdvanced'],
    ];
    const files = readdirSync(CORPUS).filter((f) => f.includes('星际熔炉'));
    expect(files.length).toBe(3);

    for (const [namePart, recipeId, recipeKey] of expected) {
      const file = files.find((f) => f.includes(namePart));
      expect(file, `no corpus file named ${namePart}`).toBeTruthy();
      const bp = await decodeBlueprint(readFileSync(resolve(CORPUS, file!), 'utf8').trim());
      const smelters = bp.body.buildings.filter((b) => b.itemId === data.buildings.find((x) => x.key === 'PlaneSmelter')!.id);
      expect(smelters.length).toBeGreaterThan(100);
      expect(new Set(smelters.map((b) => b.recipeId))).toEqual(new Set([recipeId]));
      expect(data.recipeByIdOrUndefined(recipeId)?.key).toBe(recipeKey);
    }
  });

  it('gives every crafting machine a valid recipe and no other building one', async () => {
    const CRAFT = new Set(['production', 'smelter', 'research', 'chemical']);
    const byId = new Map(data.buildings.map((b) => [b.id, b]));
    let crafting = 0;
    let craftingWithRecipe = 0;
    let nonCraftingWithRecipe = 0;

    for (const { bp } of await decodeCorpus()) {
      for (const b of bp.body.buildings) {
        if (!b.tail || b.tail.length < 4) continue;
        const def = byId.get(b.itemId);
        if (!def) continue;
        if (CRAFT.has(def.category)) {
          crafting++;
          if (b.recipeId > 0) {
            craftingWithRecipe++;
            // A recipe id that the dataset does not know would mean the offset is wrong.
            expect(data.recipeByIdOrUndefined(b.recipeId), `${def.key} recipe ${b.recipeId}`).toBeTruthy();
          }
        } else if (b.recipeId > 0) {
          nonCraftingWithRecipe++;
        }
      }
    }

    expect(crafting).toBeGreaterThan(500);
    expect(craftingWithRecipe).toBe(crafting); // 100%, not "most"
    expect(nonCraftingWithRecipe).toBe(0);
  });

  it('turns the recipes into real production lines and power', async () => {
    const file = readdirSync(CORPUS).find((f) => f.includes('星际熔炉') && f.includes('钛合金'));
    expect(file).toBeTruthy();
    const bp = await decodeBlueprint(readFileSync(resolve(CORPUS, file!), 'utf8').trim());
    const model = convertBlueprint(data, bp);

    // Before the fix this was 0 kW for the whole corpus.
    expect(model.totals.producers).toBeGreaterThan(100);
    expect(model.totals.craftingPowerKW).toBeGreaterThan(0);
    expect(model.lines.length).toBeGreaterThan(0);

    // 168 PlaneSmelters at 1440 kW each.
    const smelter = data.buildings.find((b) => b.key === 'PlaneSmelter')!;
    const n = bp.body.buildings.filter((b) => b.itemId === smelter.id).length;
    expect(model.totals.craftingPowerKW).toBe(n * (smelter.powerConsumptionKW ?? 0));
  });
});

/**
 * What `tail[1]` is — and is not.
 *
 * On a sorter it is a **building index**: 2037 of 2037 resolve to a real building in the same
 * blueprint, and 1496 (73%) are inside a sorter's 3-cell reach. That is a far better link than
 * v2's `outputObjectIndex`, where 0 of 2390 references landed on a neighbour.
 *
 * But it is *not* the sorter's travel direction. Measured against the arm from the record's own
 * two anchors, the target sits within 1.2 cells of the **near** anchor 67.6% of the time and of
 * the far anchor only 0.5%; just 1.9% lie along the arm at all. So it names the object the
 * sorter is attached to at its own end, which is why it is deliberately not wired in as a pickup
 * or drop-off.
 *
 * These tests exist so the boundary stays where the evidence put it: a link, yes; a direction,
 * no.
 */
describe.skipIf(!CORPUS_PRESENT)('v1 tail[1] is a link, not a direction (needs third-party corpus)', () => {
  it('always resolves to a real building in the same blueprint', async () => {
    const SORTER = new Set([2011, 2012, 2013, 2014]);
    let examined = 0;
    let resolved = 0;

    for (const { bp } of await decodeCorpus()) {
      const byIndex = new Map(bp.body.buildings.map((b) => [b.index, b]));
      for (const b of bp.body.buildings) {
        if (!SORTER.has(b.itemId) || !b.tail || b.tail.length < 2) continue;
        examined++;
        const v = b.tail[1]!;
        expect(v).toBeGreaterThanOrEqual(0); // never the -1 sentinel on a sorter
        if (byIndex.has(v)) resolved++;
      }
    }

    expect(examined).toBeGreaterThan(1000);
    expect(resolved).toBe(examined); // 100%, not "most"
  });

  it('is NOT a travel direction: the target sits at the near anchor', async () => {
    const SORTER = new Set([2011, 2012, 2013, 2014]);
    let n = 0;
    let nearAnchor = 0;
    let farAnchor = 0;

    for (const { bp } of await decodeCorpus()) {
      const byIndex = new Map(bp.body.buildings.map((b) => [b.index, b]));
      for (const b of bp.body.buildings) {
        if (!SORTER.has(b.itemId) || !b.tail || b.tail.length < 2) continue;
        const t = byIndex.get(b.tail[1]!);
        if (!t) continue;
        const arm = Math.hypot(b.x2 - b.x, b.y2 - b.y);
        if (arm < 0.5 || arm > 3.05) continue;
        n++;
        const dFrom = Math.hypot(t.x - b.x, t.y - b.y);
        const dTo = Math.hypot(t.x - b.x2, t.y - b.y2);
        if (dFrom <= 1.2) nearAnchor++;
        if (dTo <= 1.2) farAnchor++;
      }
    }

    expect(n).toBeGreaterThan(1000);
    // Overwhelmingly at the sorter's own end; almost never at the far end of the arm.
    expect(nearAnchor / n).toBeGreaterThan(0.5);
    expect(farAnchor / n).toBeLessThan(0.05);
  });
});
