/**
 * Runtime registry over the static game data.
 *
 * All engine code goes through `GameData` so that datasets can be swapped
 * (base game version, alternate recipes, user-edited data) without touching
 * engine math.
 */

import type {
  BeltDef,
  BuildingDef,
  Effect,
  FacilityKey,
  ItemDef,
  ProliferatorMark,
  RecipeDef,
  SorterDef,
  TechDef,
  UpgradeDef,
} from './types.ts';

/** Gathering (non-recipe) constants, verified against the game's prefab data. */
export interface MiningConstants {
  /** Items per minute per covered vein for a Mining Machine (30). */
  baseVeinSpeedPerMinPerVein: number;
  /** Same for an Advanced Mining Machine (60). */
  advancedMiningSpeedPerMinPerVein: number;
  /** Water Pump output per minute at mining speed 1 (50). */
  waterPumpPerMin: number;
  miningSpeedMultiplierFormula: string;
  veinConsumptionFormula: string;
  notes: string;
}

export interface GameDataset {
  meta: {
    gameVersion: string;
    generatedAt?: string;
    sources?: string[];
  };
  items: ItemDef[];
  buildings: BuildingDef[];
  recipes: RecipeDef[];
  technologies: TechDef[];
  upgrades: UpgradeDef[];
  proliferator: ProliferatorMark[];
  belts: BeltDef[];
  sorters: SorterDef[];
  miningConstants?: MiningConstants;
}

export class GameDataError extends Error {
  override name = 'GameDataError';
}

export class GameData {
  readonly meta: GameDataset['meta'];
  readonly items: readonly ItemDef[];
  readonly buildings: readonly BuildingDef[];
  readonly recipes: readonly RecipeDef[];
  readonly technologies: readonly TechDef[];
  readonly upgrades: readonly UpgradeDef[];
  readonly proliferatorMarks: readonly ProliferatorMark[];
  readonly belts: readonly BeltDef[];
  readonly sorters: readonly SorterDef[];
  readonly miningConstants: MiningConstants;

  private readonly itemByKey = new Map<string, ItemDef>();
  private readonly itemById = new Map<number, ItemDef>();
  private readonly buildingByKey = new Map<string, BuildingDef>();
  private readonly buildingById = new Map<number, BuildingDef>();
  private readonly recipeByKey = new Map<string, RecipeDef>();
  private readonly recipeById = new Map<number, RecipeDef>();
  private readonly techByKey = new Map<string, TechDef>();
  private readonly upgradeByKey = new Map<string, UpgradeDef>();
  private readonly markByKey = new Map<string, ProliferatorMark>();
  private readonly beltByKey = new Map<string, BeltDef>();
  private readonly sorterByKey = new Map<string, SorterDef>();

  constructor(dataset: GameDataset) {
    this.meta = dataset.meta;
    this.items = dataset.items;
    this.buildings = dataset.buildings;
    this.recipes = dataset.recipes;
    this.technologies = dataset.technologies;
    this.upgrades = dataset.upgrades;
    this.proliferatorMarks = dataset.proliferator;
    this.belts = dataset.belts;
    this.sorters = dataset.sorters;
    this.miningConstants = dataset.miningConstants ?? {
      baseVeinSpeedPerMinPerVein: 30,
      advancedMiningSpeedPerMinPerVein: 60,
      waterPumpPerMin: 50,
      miningSpeedMultiplierFormula: 'miningSpeedMultiplier = 1 + 0.10 × VeinsUtilizationLevel',
      veinConsumptionFormula: 'vein units consumed = 0.94 ^ VeinsUtilizationLevel per item',
      notes: '',
    };

    indexUnique(this.itemByKey, this.items, (i) => i.key, 'item');
    indexUnique(this.buildingByKey, this.buildings, (b) => b.key, 'building');
    indexUnique(this.recipeByKey, this.recipes, (r) => r.key, 'recipe');
    indexUnique(this.techByKey, this.technologies, (t) => t.key, 'technology');
    indexUnique(this.upgradeByKey, this.upgrades, (u) => u.key, 'upgrade');
    indexUnique(this.markByKey, this.proliferatorMarks, (m) => m.key, 'proliferator mark');
    indexUnique(this.beltByKey, this.belts, (b) => b.key, 'belt');
    indexUnique(this.sorterByKey, this.sorters, (s) => s.key, 'sorter');

    for (const item of this.items) {
      if (item.id != null) {
        const existing = this.itemById.get(item.id);
        if (existing && existing.key !== item.key) {
          throw new GameDataError(`duplicate item id ${item.id}: ${existing.key} and ${item.key}`);
        }
        this.itemById.set(item.id, item);
      }
    }
    for (const building of this.buildings) {
      if (building.id != null) {
        const existing = this.buildingById.get(building.id);
        if (existing && existing.key !== building.key) {
          throw new GameDataError(`duplicate building id ${building.id}: ${existing.key} and ${building.key}`);
        }
        this.buildingById.set(building.id, building);
      }
    }
    for (const recipe of this.recipes) {
      if (recipe.id != null) {
        const existing = this.recipeById.get(recipe.id);
        if (existing && existing.key !== recipe.key) {
          throw new GameDataError(`duplicate recipe id ${recipe.id}: ${existing.key} and ${recipe.key}`);
        }
        this.recipeById.set(recipe.id, recipe);
      }
    }
  }

  // -- lookups ------------------------------------------------------------

  item(key: string): ItemDef | undefined {
    return this.itemByKey.get(key);
  }
  requireItem(key: string): ItemDef {
    const found = this.item(key);
    if (!found) throw new GameDataError(`unknown item "${key}"`);
    return found;
  }
  itemByIdOrUndefined(id: number): ItemDef | undefined {
    return this.itemById.get(id);
  }
  building(key: string): BuildingDef | undefined {
    return this.buildingByKey.get(key);
  }
  requireBuilding(key: string): BuildingDef {
    const found = this.building(key);
    if (!found) throw new GameDataError(`unknown building "${key}"`);
    return found;
  }
  buildingByIdOrUndefined(id: number): BuildingDef | undefined {
    return this.buildingById.get(id);
  }
  recipe(key: string): RecipeDef | undefined {
    return this.recipeByKey.get(key);
  }
  requireRecipe(key: string): RecipeDef {
    const found = this.recipe(key);
    if (!found) throw new GameDataError(`unknown recipe "${key}"`);
    return found;
  }
  recipeByIdOrUndefined(id: number): RecipeDef | undefined {
    return this.recipeById.get(id);
  }
  tech(key: string): TechDef | undefined {
    return this.techByKey.get(key);
  }
  upgrade(key: string): UpgradeDef | undefined {
    return this.upgradeByKey.get(key);
  }
  proliferatorMark(key: string): ProliferatorMark | undefined {
    return this.markByKey.get(key);
  }
  requireProliferatorMark(key: string): ProliferatorMark {
    const found = this.markByKey.get(key);
    if (!found) throw new GameDataError(`unknown proliferator mark "${key}"`);
    return found;
  }
  belt(key: string): BeltDef | undefined {
    return this.beltByKey.get(key);
  }
  sorter(key: string): SorterDef | undefined {
    return this.sorterByKey.get(key);
  }

  /** All recipes whose `facility` matches, optionally filtered by availability. */
  recipesForFacility(facility: FacilityKey): RecipeDef[] {
    return this.recipes.filter((r) => r.facility === facility);
  }

  /** Recipes producing `itemKey`. */
  recipesProducing(itemKey: string): RecipeDef[] {
    return this.recipes.filter((r) => r.outputs.some((o) => o.item === itemKey));
  }

  /** Recipes consuming `itemKey`. */
  recipesConsuming(itemKey: string): RecipeDef[] {
    return this.recipes.filter((r) => r.inputs.some((i) => i.item === itemKey));
  }

  /** Every effect granted by the given set of researched technologies. */
  effectsOfTechnologies(techKeys: Iterable<string>): Effect[] {
    const effects: Effect[] = [];
    for (const key of techKeys) {
      const tech = this.techByKey.get(key);
      if (!tech) continue;
      if (tech.effects) effects.push(...tech.effects);
    }
    return effects;
  }

  /** Items that appear in no recipe — i.e. must be mined/pumped/collected. */
  rawItemKeys(): string[] {
    const produced = new Set<string>();
    for (const recipe of this.recipes) for (const out of recipe.outputs) produced.add(out.item);
    return this.items.filter((i) => i.isRaw && !produced.has(i.key)).map((i) => i.key);
  }

  /** Throws when the dataset is internally inconsistent. Returns a report. */
  validate(): string[] {
    const problems: string[] = [];
    for (const recipe of this.recipes) {
      if (!(recipe.craftTime > 0)) problems.push(`recipe ${recipe.key}: craftTime must be > 0`);
      if (recipe.outputs.length === 0) problems.push(`recipe ${recipe.key}: has no outputs`);
      for (const io of [...recipe.inputs, ...recipe.outputs]) {
        if (!this.itemByKey.has(io.item)) problems.push(`recipe ${recipe.key}: unknown item "${io.item}"`);
        if (!(io.count > 0)) problems.push(`recipe ${recipe.key}: non positive count for ${io.item}`);
      }
      if (recipe.facility !== 'None' && recipe.facility !== 'MiningMachine' && !this.buildings.some((b) => b.recipeFacility === recipe.facility || b.key === recipe.facility)) {
        problems.push(`recipe ${recipe.key}: no building provides facility "${recipe.facility}"`);
      }
    }
    for (const item of this.items) {
      if (!Number.isInteger(item.stackSize) || item.stackSize <= 0) {
        problems.push(`item ${item.key}: invalid stackSize ${item.stackSize}`);
      }
    }
    for (const upgrade of this.upgrades) {
      if (!(upgrade.maxLevel >= 1)) problems.push(`upgrade ${upgrade.key}: maxLevel must be >= 1`);
    }
    for (const building of this.buildings) {
      if (building.workSpeed != null && !(building.workSpeed > 0)) {
        problems.push(`building ${building.key}: workSpeed must be > 0`);
      }
      if (building.powerConsumptionKW < 0) problems.push(`building ${building.key}: negative power`);
    }
    return problems;
  }
}

function indexUnique<T>(map: Map<string, T>, rows: readonly T[], key: (row: T) => string, what: string): void {
  for (const row of rows) {
    const k = key(row);
    const existing = map.get(k);
    if (existing) throw new GameDataError(`duplicate ${what} key "${k}"`);
    map.set(k, row);
  }
}
