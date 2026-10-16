/**
 * Dataset loading and normalisation.
 *
 * The shipped dataset is a single JSON document (docs/GAME-DATA.md explains how
 * it is produced and verified). Loading goes through this module so that
 *  - every item/recipe/building referenced by a blueprint can be resolved,
 *  - slight schema drift in the data files cannot crash the engine,
 *  - the loader is the single place where raw JSON becomes typed entities.
 */

import { GameData, GameDataError, type GameDataset } from './registry.ts';
import type {
  BeltDef,
  BuildingCategory,
  BuildingDef,
  Effect,
  FacilityKey,
  ItemCategory,
  ItemDef,
  ProliferatorMark,
  RecipeDef,
  SorterDef,
  TechDef,
  UpgradeDef,
} from './types.ts';

const ITEM_CATEGORIES = new Set<ItemCategory>([
  'raw',
  'intermediate',
  'component',
  'fuel',
  'proliferator',
  'ammo',
  'building',
  'matrix',
  'other',
]);

const BUILDING_CATEGORIES = new Set<BuildingCategory>([
  'production',
  'smelter',
  'chemical',
  'refinery',
  'collider',
  'fractionator',
  'mining',
  'pump',
  'extractor',
  'logistics',
  'power',
  'belt',
  'sorter',
  'storage',
  'research',
  'turret',
  'other',
]);

/** Normalise an item record coming from JSON. */
function normaliseItem(raw: Record<string, unknown>, index: number): ItemDef {
  const key = String(raw.key ?? raw.Key ?? '');
  if (!key) throw new GameDataError(`items[${index}] has no key`);
  const category = String(raw.category ?? 'other') as ItemCategory;
  const id = raw.id == null ? null : Number(raw.id);
  return {
    id: id != null && Number.isFinite(id) ? id : null,
    key,
    name: String(raw.name ?? key),
    ...(raw.nameZh ? { nameZh: String(raw.nameZh) } : {}),
    category: ITEM_CATEGORIES.has(category) ? category : 'other',
    stackSize: Number.isFinite(Number(raw.stackSize)) && Number(raw.stackSize) > 0 ? Number(raw.stackSize) : 100,
    isRaw: Boolean(raw.isRaw ?? false),
    isFluid: Boolean(raw.isFluid ?? false),
    ...(raw.fuelEnergyMJ != null ? { fuelEnergyMJ: Number(raw.fuelEnergyMJ) } : {}),
  };
}

function normaliseRecipe(raw: Record<string, unknown>, index: number): RecipeDef {
  const key = String(raw.key ?? '');
  if (!key) throw new GameDataError(`recipes[${index}] has no key`);
  const craftTime = Number(raw.craftTime);
  if (!Number.isFinite(craftTime) || craftTime <= 0) {
    throw new GameDataError(`recipe ${key} has invalid craftTime ${String(raw.craftTime)}`);
  }
  const clean = (v: unknown): { item: string; count: number }[] =>
    Array.isArray(v)
      ? v.map((row) => ({
          item: String((row as Record<string, unknown>).item ?? ''),
          count: Number((row as Record<string, unknown>).count ?? 0),
        }))
      : [];
  return {
    id: raw.id == null ? null : Number(raw.id),
    key,
    ...(raw.name ? { name: String(raw.name) } : {}),
    ...(raw.nameZh ? { nameZh: String(raw.nameZh) } : {}),
    outputs: clean(raw.outputs),
    inputs: clean(raw.inputs),
    craftTime,
    facility: (raw.facility == null ? 'None' : String(raw.facility)) as FacilityKey,
    tech: raw.tech == null ? null : String(raw.tech),
    proliferatorBoost: raw.proliferatorBoost !== false,
    proliferatorOutput: raw.proliferatorOutput !== false,
    isDefault: raw.isDefault !== false,
    ...(raw.category ? { category: raw.category as RecipeDef['category'] } : {}),
    ...(Array.isArray(raw.fluidInputs) ? { fluidInputs: raw.fluidInputs.map(String) } : {}),
    ...(Array.isArray(raw.fluidOutputs) ? { fluidOutputs: raw.fluidOutputs.map(String) } : {}),
    ...(raw.note ? { note: String(raw.note) } : {}),
  };
}

function normaliseBuilding(raw: Record<string, unknown>, index: number): BuildingDef {
  const key = String(raw.key ?? '');
  if (!key) throw new GameDataError(`buildings[${index}] has no key`);
  const category = String(raw.category ?? 'other') as BuildingCategory;
  const workSpeed = raw.workSpeed == null ? null : Number(raw.workSpeed);
  return {
    key,
    name: String(raw.name ?? key),
    ...(raw.nameZh ? { nameZh: String(raw.nameZh) } : {}),
    id: raw.id == null ? null : Number(raw.id),
    category: BUILDING_CATEGORIES.has(category) ? category : 'other',
    powerConsumptionKW: Number.isFinite(Number(raw.powerConsumptionKW)) ? Number(raw.powerConsumptionKW) : 0,
    ...(raw.powerIdleKW != null ? { powerIdleKW: Number(raw.powerIdleKW) } : {}),
    workSpeed: workSpeed != null && Number.isFinite(workSpeed) ? workSpeed : null,
    ...(raw.recipeFacility ? { recipeFacility: String(raw.recipeFacility) as FacilityKey } : {}),
    ...(raw.slots != null ? { slots: Number(raw.slots) } : {}),
    // Sorter attachment points, from the game's SlotConfig.insertPoses length. Only
    // a positive count is meaningful; absence means a sorter cannot attach.
    ...(Number(raw.sorterAttachSlots) > 0 ? { sorterAttachSlots: Number(raw.sorterAttachSlots) } : {}),
    ...(raw.footprint ? { footprint: raw.footprint as { w: number; h: number } } : {}),
    ...(raw.beltSpeedPerMin != null ? { beltSpeedPerMin: Number(raw.beltSpeedPerMin) } : {}),
    ...(raw.sorterSpeedPerSec != null ? { sorterSpeedPerSec: Number(raw.sorterSpeedPerSec) } : {}),
    ...(raw.extractPerMinPerVein != null ? { extractPerMinPerVein: Number(raw.extractPerMinPerVein) } : {}),
    ...(raw.station ? { station: raw.station as BuildingDef['station'] } : {}),
    ...(raw.note ? { note: String(raw.note) } : {}),
  };
}

function normaliseTech(raw: Record<string, unknown>, index: number): TechDef {
  const key = String(raw.key ?? '');
  if (!key) throw new GameDataError(`technologies[${index}] has no key`);
  const effects = Array.isArray(raw.effects)
    ? raw.effects.map((e) => {
        const row = e as Record<string, unknown>;
        return {
          kind: String(row.kind ?? 'other'),
          ...(row.value != null ? { value: Number(row.value) } : {}),
          ...(Array.isArray(row.recipes) ? { recipes: row.recipes.map(String) } : {}),
          ...(Array.isArray(row.buildings) ? { buildings: row.buildings.map(String) } : {}),
          ...(row.target ? { target: String(row.target) } : {}),
        } as Effect;
      })
    : undefined;
  return {
    key,
    name: String(raw.name ?? key),
    ...(raw.nameZh ? { nameZh: String(raw.nameZh) } : {}),
    prerequisites: Array.isArray(raw.prerequisites) ? raw.prerequisites.map(String) : [],
    ...(raw.cost ? { cost: raw.cost as TechDef['cost'] } : {}),
    ...(raw.unlocks ? { unlocks: raw.unlocks as TechDef['unlocks'] } : {}),
    ...(effects ? { effects } : {}),
    ...(raw.note ? { note: String(raw.note) } : {}),
  };
}

function normaliseUpgrade(raw: Record<string, unknown>, index: number): UpgradeDef {
  const key = String(raw.key ?? '');
  if (!key) throw new GameDataError(`upgrades[${index}] has no key`);
  const toEffect = (value: unknown): Effect => {
    const effect = (value ?? {}) as Record<string, unknown>;
    return {
      kind: String(effect.kind ?? 'other'),
      ...(effect.value != null ? { value: Number(effect.value) } : {}),
      ...(effect.note ? { note: String(effect.note) } : {}),
    } as Effect;
  };
  const primary = toEffect(raw.effectPerLevel);
  const extras = Array.isArray(raw.effectsPerLevel)
    ? (raw.effectsPerLevel as unknown[]).map(toEffect).filter((e) => e.value != null)
    : [];
  return {
    key,
    name: String(raw.name ?? key),
    ...(raw.nameZh ? { nameZh: String(raw.nameZh) } : {}),
    maxLevel: Number.isFinite(Number(raw.maxLevel)) ? Number(raw.maxLevel) : 1,
    effectPerLevel: primary,
    ...(extras.length > 0 ? { effectsPerLevel: extras } : {}),
    ...(raw.curve ? { curve: String(raw.curve) } : {}),
    ...(raw.note ? { note: String(raw.note) } : {}),
  };
}

function normaliseMark(raw: Record<string, unknown>, index: number): ProliferatorMark {
  const key = String(raw.key ?? '');
  if (!key) throw new GameDataError(`proliferator[${index}] has no key`);
  const spraysPerItem = Number(raw.spraysPerItem ?? 12);
  // The research file uses `spraysPerItemSelfSprayed` / `energyConsumptionBonus`;
  // accept both spellings so the loader is robust to either source.
  const selfSprayed = Number(raw.spraysWhenSelfSprayed ?? raw.spraysPerItemSelfSprayed ?? spraysPerItem);
  const energy = Number(raw.energyPenalty ?? raw.energyConsumptionBonus ?? 0);
  return {
    key,
    item: String(raw.item ?? key),
    tier: Number(raw.tier ?? index + 1),
    extraProductsBonus: Number(raw.extraProductsBonus ?? 0),
    speedBonus: Number(raw.speedBonus ?? 0),
    spraysPerItem,
    spraysWhenSelfSprayed: selfSprayed,
    energyPenalty: energy,
    ...(raw.conflictNote ? { conflictNote: String(raw.conflictNote) } : {}),
  };
}

/**
 * Accepts the raw JSON document (already parsed) and returns a validated
 * `GameData`. Throws `GameDataError` with a precise message on structural
 * problems so that a broken dataset fails loudly at load time.
 *
 * `slotsRaw` is the optional `building-slots.json` document recovered from the
 * shipped Unity assets. It is separate because it comes from a different
 * pipeline than the wiki-derived dataset, and because it is authoritative where
 * the two overlap: when both give a count they must agree, and a disagreement
 * throws rather than being silently resolved.
 */
export function loadDataset(raw: unknown, slotsRaw?: unknown): GameData {
  if (typeof raw !== 'object' || raw === null) throw new GameDataError('dataset must be a JSON object');
  const doc = raw as Record<string, unknown>;
  const meta = (doc.meta ?? {}) as Record<string, unknown>;

  const dataset: GameDataset = {
    meta: {
      gameVersion: String(meta.gameVersion ?? 'unknown'),
      ...(meta.generatedAt ? { generatedAt: String(meta.generatedAt) } : {}),
      ...(Array.isArray(meta.sources) ? { sources: meta.sources.map(String) } : {}),
    },
    items: asArray(doc.items).map(normaliseItem),
    recipes: asArray(doc.recipes).map(normaliseRecipe),
    buildings: asArray(doc.buildings).map(normaliseBuilding),
    technologies: asArray(doc.technologies ?? doc.tech).map(normaliseTech),
    upgrades: asArray(doc.upgrades).map(normaliseUpgrade),
    proliferator: asArray(doc.proliferator ?? doc.proliferatorMarks).map(normaliseMark),
    belts: asArray(doc.belts).map((b, i) => normaliseBelt(b, i)),
    sorters: asArray(doc.sorters).map((s, i) => normaliseSorter(s, i)),
    ...(doc.miningConstants
      ? {
          miningConstants: {
            baseVeinSpeedPerMinPerVein: Number((doc.miningConstants as Record<string, unknown>).baseVeinSpeedPerMinPerVein ?? 30),
            advancedMiningSpeedPerMinPerVein: Number((doc.miningConstants as Record<string, unknown>).advancedMiningSpeedPerMinPerVein ?? 60),
            waterPumpPerMin: Number((doc.miningConstants as Record<string, unknown>).waterPumpPerMin ?? 50),
            miningSpeedMultiplierFormula: String((doc.miningConstants as Record<string, unknown>).miningSpeedMultiplierFormula ?? ''),
            veinConsumptionFormula: String((doc.miningConstants as Record<string, unknown>).veinConsumptionFormula ?? ''),
            notes: String((doc.miningConstants as Record<string, unknown>).notes ?? ''),
          },
        }
      : {}),
  };

  if (slotsRaw !== undefined && slotsRaw !== null) attachSlotPoses(dataset, slotsRaw);

  const data = new GameData(dataset);
  const problems = data.validate();
  if (problems.length > 0) {
    throw new GameDataError(`dataset validation failed:\n  - ${problems.slice(0, 25).join('\n  - ')}`);
  }
  return data;
}

/**
 * Merge the recovered slot geometry onto the buildings, keyed by building id.
 *
 * Deliberately strict: a slot array whose length disagrees with the count the
 * dataset already declares is a contradiction between two independent sources,
 * so it throws instead of picking a winner. A building id in the slot document
 * that the dataset does not know is also an error, because it means the two
 * files were generated from different game versions.
 */
function attachSlotPoses(dataset: GameDataset, slotsRaw: unknown): void {
  if (typeof slotsRaw !== 'object' || slotsRaw === null) {
    throw new GameDataError('building-slots document must be a JSON object');
  }
  const doc = slotsRaw as Record<string, unknown>;
  const byId = doc.buildings;
  if (typeof byId !== 'object' || byId === null) {
    throw new GameDataError('building-slots document has no `buildings` map');
  }
  const known = new Set(dataset.buildings.map((b) => b.id));
  for (const [idText, value] of Object.entries(byId as Record<string, unknown>)) {
    const id = Number(idText);
    if (!known.has(id)) {
      throw new GameDataError(`building-slots lists id ${id}, which the dataset does not define`);
    }
    const entry = value as Record<string, unknown>;
    const raw = entry.slots;
    if (!Array.isArray(raw)) {
      throw new GameDataError(`building-slots entry ${id} has no \`slots\` array`);
    }
    const poses = raw.map((p, i) => {
      const row = p as Record<string, unknown>;
      const x = Number(row.x);
      const y = Number(row.y);
      const z = Number(row.z);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new GameDataError(`building-slots entry ${id} slot ${i} is not a finite point`);
      }
      return { x, y, z };
    });
    const building = dataset.buildings.find((b) => b.id === id)!;
    if (building.sorterAttachSlots !== undefined && building.sorterAttachSlots !== poses.length) {
      throw new GameDataError(
        `building-slots entry ${id} (${building.key}) has ${poses.length} slots but the dataset declares ${building.sorterAttachSlots}`,
      );
    }
    building.sorterSlotPoses = poses;
    if (building.sorterAttachSlots === undefined) building.sorterAttachSlots = poses.length;
  }
}

function normaliseBelt(raw: Record<string, unknown>, index: number): BeltDef {
  const key = String(raw.key ?? `Belt${index}`);
  const speedPerMin = Number(raw.speedPerMin ?? Number(raw.speedPerSec ?? 0) * 60);
  return {
    key,
    name: String(raw.name ?? key),
    ...(raw.nameZh ? { nameZh: String(raw.nameZh) } : {}),
    id: raw.id == null ? null : Number(raw.id),
    speedPerSec: Number(raw.speedPerSec ?? speedPerMin / 60),
    speedPerMin,
    ...(raw.stackSize != null ? { stackSize: Number(raw.stackSize) } : {}),
  };
}

function normaliseSorter(raw: Record<string, unknown>, index: number): SorterDef {
  const key = String(raw.key ?? `Sorter${index}`);
  return {
    key,
    name: String(raw.name ?? key),
    ...(raw.nameZh ? { nameZh: String(raw.nameZh) } : {}),
    id: raw.id == null ? null : Number(raw.id),
    speedPerSec: Number(raw.speedPerSec ?? 0),
    powerConsumptionKW: Number(raw.powerConsumptionKW ?? 0),
  };
}

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

/** Convenience for tests and tools: parse a JSON string and load it. */
export function loadDatasetFromJson(json: string, slotsJson?: string): GameData {
  return loadDataset(JSON.parse(json), slotsJson === undefined ? undefined : JSON.parse(slotsJson));
}
