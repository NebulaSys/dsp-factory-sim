/**
 * Builds src/engine/data/dsp-vanilla.json from the wiki + verified research
 * artifacts.
 *
 *   node tools/build-dataset.mjs
 *
 * Inputs (docs/research):
 *   items.json          — item list with real internal ids (verified)
 *   recipes.json        — recipes with real internal ids (verified)
 *   buildings.json      — buildings, when the wiki extraction succeeded
 *   tech.json           — tech tree + repeatable upgrades
 *   proliferator.json   — proliferator marks
 *   mining-belts.json   — belts, sorters, mining constants
 *
 * Anything missing is filled from the built-in tables in this file, which are
 * transcribed from the wiki pages listed in docs/GAME-DATA.md. The script prints
 * exactly which parts came from files and which from the fallback tables so the
 * provenance of every number stays auditable.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const RESEARCH = resolve(ROOT, 'docs/research');
const OUT = resolve(ROOT, 'src/engine/data/dsp-vanilla.json');

const provenance = { fromFiles: [], fallback: [] };

function readResearch(name) {
  const path = resolve(RESEARCH, name);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    provenance.fromFiles.push(name);
    return parsed;
  } catch (err) {
    console.warn(`! could not parse ${name}: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fallback tables — transcribed from dsp-wiki.com. Only used when the research
// file is absent, and always reported.
// ---------------------------------------------------------------------------

/**
 * Building crafting-speed multipliers and power draw.
 * Sources: each building's wiki page ("Work Consumption") and the
 * Assembling Machines / Arc Smelter / Chemical Plant page speed tables.
 */
const FALLBACK_BUILDINGS = [
  // production
  { key: 'AssemblingMachineMk1', name: 'Assembling Machine Mk.I', nameZh: '制造台 Mk.I', id: 2303, category: 'production', powerConsumptionKW: 270, workSpeed: 0.75, recipeFacility: 'AssemblingMachineMk1', footprint: { w: 3, h: 3 }, slots: 1 },
  { key: 'AssemblingMachineMk2', name: 'Assembling Machine Mk.II', nameZh: '制造台 Mk.II', id: 2304, category: 'production', powerConsumptionKW: 540, workSpeed: 1, recipeFacility: 'AssemblingMachineMk2', footprint: { w: 3, h: 3 }, slots: 1 },
  { key: 'AssemblingMachineMk3', name: 'Assembling Machine Mk.III', nameZh: '制造台 Mk.III', id: 2305, category: 'production', powerConsumptionKW: 1080, workSpeed: 1.5, recipeFacility: 'AssemblingMachineMk3', footprint: { w: 3, h: 3 }, slots: 1 },
  { key: 'RecomposingAssembler', name: 'Re-composing Assembler', nameZh: '重组式制造台', id: 2318, category: 'production', powerConsumptionKW: 2160, workSpeed: 3, recipeFacility: 'RecomposingAssembler', footprint: { w: 3, h: 3 }, slots: 1 },
  // smelting
  { key: 'ArcSmelter', name: 'Arc Smelter', nameZh: '电弧熔炉', id: 2302, category: 'smelter', powerConsumptionKW: 360, workSpeed: 1, recipeFacility: 'ArcSmelter', footprint: { w: 3, h: 3 }, slots: 1 },
  { key: 'PlaneSmelter', name: 'Plane Smelter', nameZh: '位面熔炉', id: 2315, category: 'smelter', powerConsumptionKW: 1440, workSpeed: 2, recipeFacility: 'PlaneSmelter', footprint: { w: 3, h: 3 }, slots: 1 },
  // chemical
  { key: 'ChemicalPlant', name: 'Chemical Plant', nameZh: '化工厂', id: 2309, category: 'chemical', powerConsumptionKW: 720, workSpeed: 1, recipeFacility: 'ChemicalPlant', footprint: { w: 3, h: 3 }, slots: 1 },
  { key: 'QuantumChemicalPlant', name: 'Quantum Chemical Plant', nameZh: '量子化工厂', id: 2319, category: 'chemical', powerConsumptionKW: 2160, workSpeed: 2, recipeFacility: 'QuantumChemicalPlant', footprint: { w: 3, h: 3 }, slots: 1 },
  // refining
  { key: 'OilRefinery', name: 'Oil Refinery', nameZh: '原油精炼厂', id: 2308, category: 'refinery', powerConsumptionKW: 960, workSpeed: 1, recipeFacility: 'OilRefinery', footprint: { w: 4, h: 4 }, slots: 1 },
  { key: 'MiniatureParticleCollider', name: 'Miniature Particle Collider', nameZh: '微型粒子对撞机', id: 2310, category: 'collider', powerConsumptionKW: 1200, workSpeed: 1, recipeFacility: 'MiniatureParticleCollider', footprint: { w: 5, h: 5 }, slots: 1 },
  { key: 'Fractionator', name: 'Fractionator', nameZh: '分馏塔', id: 2311, category: 'fractionator', powerConsumptionKW: 720, workSpeed: null, recipeFacility: 'Fractionator', footprint: { w: 3, h: 3 }, note: '分馏不是配方：氢 → 氘，基础转化率 1%，增产剂加速模式按 +X% 提升转化率' },
  { key: 'MatrixLab', name: 'Matrix Lab', nameZh: '矩阵研究站', id: 2901, category: 'research', powerConsumptionKW: 480, workSpeed: 1, recipeFacility: 'MatrixLab', footprint: { w: 4, h: 4 }, slots: 6 },
  // extraction
  { key: 'MiningMachine', name: 'Mining Machine', nameZh: '采矿机', id: 2301, category: 'mining', powerConsumptionKW: 420, powerIdleKW: 24, workSpeed: null, footprint: { w: 5, h: 5 }, note: '每个覆盖矿脉 30 个/分钟' },
  { key: 'AdvancedMiningMachine', name: 'Advanced Mining Machine', nameZh: '大型采矿机', id: 2316, category: 'mining', powerConsumptionKW: 1680, workSpeed: null, footprint: { w: 9, h: 9 }, note: '大型矿机：覆盖范围更大，自带物流' },
  { key: 'WaterPump', name: 'Water Pump', nameZh: '抽水泵', id: 2306, category: 'pump', powerConsumptionKW: 300, workSpeed: null, footprint: { w: 3, h: 3 }, note: '抽取海水，速率受资源倍率影响' },
  { key: 'OilExtractor', name: 'Oil Extractor', nameZh: '原油萃取站', id: 2307, category: 'extractor', powerConsumptionKW: 840, workSpeed: null, footprint: { w: 3, h: 3 }, note: '原油产出随储量下降而衰减' },
  { key: 'OrbitalCollector', name: 'Orbital Collector', nameZh: '轨道采集器', id: 2312, category: 'extractor', powerConsumptionKW: 0, workSpeed: null, footprint: { w: 4, h: 4 } },
  // logistics
  { key: 'ConveyorBeltMk1', name: 'Conveyor Belt Mk.I', nameZh: '传送带 Mk.I', id: 2001, category: 'belt', powerConsumptionKW: 0, workSpeed: null, beltSpeedPerMin: 360, footprint: { w: 1, h: 1 } },
  { key: 'ConveyorBeltMk2', name: 'Conveyor Belt Mk.II', nameZh: '高速传送带', id: 2002, category: 'belt', powerConsumptionKW: 0, workSpeed: null, beltSpeedPerMin: 720, footprint: { w: 1, h: 1 } },
  { key: 'ConveyorBeltMk3', name: 'Conveyor Belt Mk.III', nameZh: '极速传送带', id: 2003, category: 'belt', powerConsumptionKW: 0, workSpeed: null, beltSpeedPerMin: 1800, footprint: { w: 1, h: 1 } },
  { key: 'SorterMk1', name: 'Sorter Mk.I', nameZh: '分拣器 Mk.I', id: 2011, category: 'sorter', powerConsumptionKW: 18, workSpeed: null, sorterSpeedPerSec: 1.5, footprint: { w: 1, h: 1 } },
  { key: 'SorterMk2', name: 'Sorter Mk.II', nameZh: '分拣器 Mk.II', id: 2012, category: 'sorter', powerConsumptionKW: 36, workSpeed: null, sorterSpeedPerSec: 3, footprint: { w: 1, h: 1 } },
  { key: 'SorterMk3', name: 'Sorter Mk.III', nameZh: '分拣器 Mk.III', id: 2013, category: 'sorter', powerConsumptionKW: 72, workSpeed: null, sorterSpeedPerSec: 6, footprint: { w: 1, h: 1 } },
  { key: 'Splitter', name: 'Splitter', nameZh: '四向分流器', id: 2014, category: 'belt', powerConsumptionKW: 0, workSpeed: null, footprint: { w: 1, h: 1 } },
  { key: 'AutomaticPiler', name: 'Automatic Piler', nameZh: '自动集装机', id: 2015, category: 'belt', powerConsumptionKW: 0, workSpeed: null, footprint: { w: 1, h: 1 } },
  { key: 'PlanetaryLogisticsStation', name: 'Planetary Logistics Station', nameZh: '行星内物流站', id: 2103, category: 'logistics', powerConsumptionKW: 120, workSpeed: null, footprint: { w: 5, h: 5 }, station: { maxItems: 10000, slots: 3 } },
  { key: 'InterstellarLogisticsStation', name: 'Interstellar Logistics Station', nameZh: '星际物流站', id: 2104, category: 'logistics', powerConsumptionKW: 300, workSpeed: null, footprint: { w: 5, h: 5 }, station: { maxItems: 10000, slots: 5 } },
  { key: 'LogisticsDistributor', name: 'Logistics Distributor', nameZh: '物流配送器', id: 2107, category: 'logistics', powerConsumptionKW: 60, workSpeed: null, footprint: { w: 1, h: 1 } },
  { key: 'StorageMk1', name: 'Storage Mk.I', nameZh: '储物箱 Mk.I', id: 2101, category: 'storage', powerConsumptionKW: 0, workSpeed: null, footprint: { w: 2, h: 2 } },
  { key: 'StorageMk2', name: 'Storage Mk.II', nameZh: '储物箱 Mk.II', id: 2102, category: 'storage', powerConsumptionKW: 0, workSpeed: null, footprint: { w: 2, h: 2 } },
  { key: 'SprayCoater', name: 'Spray Coater', nameZh: '喷涂机', id: 2313, category: 'other', powerConsumptionKW: 30, workSpeed: null, footprint: { w: 1, h: 1 }, note: '内部存储 600 次喷涂；每个增产剂可提供 12/24/60 次喷涂（自身喷涂后 13/28/72）' },
  // power
  { key: 'WindTurbine', name: 'Wind Turbine', nameZh: '风力涡轮机', id: 2203, category: 'power', powerConsumptionKW: 0, workSpeed: null, footprint: { w: 4, h: 4 }, note: '输出 300 kW（受行星风能倍率影响）' },
  { key: 'SolarPanel', name: 'Solar Panel', nameZh: '太阳能板', id: 2205, category: 'power', powerConsumptionKW: 0, workSpeed: null, footprint: { w: 4, h: 4 }, note: '输出 360 kW × 光照倍率' },
  { key: 'ThermalPowerPlant', name: 'Thermal Power Plant', nameZh: '火力发电厂', id: 2204, category: 'power', powerConsumptionKW: 0, workSpeed: null, footprint: { w: 4, h: 4 }, note: '燃烧燃料，输出 2.16 MW' },
  { key: 'MiniFusionPowerPlant', name: 'Mini Fusion Power Plant', nameZh: '微型聚变发电站', id: 2211, category: 'power', powerConsumptionKW: 0, workSpeed: null, footprint: { w: 4, h: 4 }, note: '输出 9 MW' },
  { key: 'ArtificialStar', name: 'Artificial Star', nameZh: '人造恒星', id: 2210, category: 'power', powerConsumptionKW: 0, workSpeed: null, footprint: { w: 4, h: 4 }, note: '输出 72 MW' },
  { key: 'RayReceiver', name: 'Ray Receiver', nameZh: '射线接收站', id: 2208, category: 'power', powerConsumptionKW: 0, workSpeed: null, footprint: { w: 6, h: 6 }, note: '接收戴森球能量，输出取决于戴森球功率' },
  { key: 'EnergyExchanger', name: 'Energy Exchanger', nameZh: '能量枢纽', id: 2209, category: 'power', powerConsumptionKW: 0, workSpeed: null, footprint: { w: 4, h: 4 } },
];

const FALLBACK_BELTS = [
  { key: 'ConveyorBeltMk1', name: 'Conveyor Belt Mk.I', nameZh: '传送带 Mk.I', id: 2001, speedPerSec: 6, speedPerMin: 360 },
  { key: 'ConveyorBeltMk2', name: 'Conveyor Belt Mk.II', nameZh: '高速传送带', id: 2002, speedPerSec: 12, speedPerMin: 720 },
  { key: 'ConveyorBeltMk3', name: 'Conveyor Belt Mk.III', nameZh: '极速传送带', id: 2003, speedPerSec: 30, speedPerMin: 1800 },
];

const FALLBACK_SORTERS = [
  { key: 'SorterMk1', name: 'Sorter Mk.I', nameZh: '分拣器 Mk.I', id: 2011, speedPerSec: 1.5, powerConsumptionKW: 18 },
  { key: 'SorterMk2', name: 'Sorter Mk.II', nameZh: '分拣器 Mk.II', id: 2012, speedPerSec: 3, powerConsumptionKW: 36 },
  { key: 'SorterMk3', name: 'Sorter Mk.III', nameZh: '分拣器 Mk.III', id: 2013, speedPerSec: 6, powerConsumptionKW: 72 },
];

/** dsp-wiki.com/Spray_Coater — the Proliferator Bonuses table. */
const FALLBACK_PROLIFERATOR = [
  { key: 'Proliferator1', item: 'Proliferator1', tier: 1, extraProductsBonus: 0.125, speedBonus: 0.25, spraysPerItem: 12, spraysWhenSelfSprayed: 13, energyPenalty: 0.3 },
  { key: 'Proliferator2', item: 'Proliferator2', tier: 2, extraProductsBonus: 0.2, speedBonus: 0.5, spraysPerItem: 24, spraysWhenSelfSprayed: 28, energyPenalty: 0.7 },
  { key: 'Proliferator3', item: 'Proliferator3', tier: 3, extraProductsBonus: 0.25, speedBonus: 1.0, spraysPerItem: 60, spraysWhenSelfSprayed: 72, energyPenalty: 1.5 },
];

/** dsp-wiki.com/Upgrades — repeatable research. */
const FALLBACK_UPGRADES = [
  { key: 'VeinsUtilization', name: 'Veins Utilization', nameZh: '矿脉利用', maxLevel: 10000, effectPerLevel: { kind: 'miningSpeedMultiplier', value: 0.1 }, curve: '每级 +10% 采矿速度，矿脉消耗 ×0.94（复利）' },
  { key: 'AssemblingSpeed', name: 'Assembling Speed', nameZh: '制造速度', maxLevel: 6, effectPerLevel: { kind: 'assemblerSpeed', value: 0.25 }, curve: '每级 +25% 制造台速度' },
  { key: 'LogisticsSystem', name: 'Logistics System', nameZh: '物流系统', maxLevel: 6, effectPerLevel: { kind: 'beltSpeed', value: 0.05 }, curve: '每级 +5% 传送带速度' },
  { key: 'SorterSpeed', name: 'Sorter Speed', nameZh: '分拣器速度', maxLevel: 6, effectPerLevel: { kind: 'sorterSpeed', value: 0.1 }, curve: '每级 +10% 分拣器速度' },
  { key: 'ResearchSpeed', name: 'Research Speed', nameZh: '研究速度', maxLevel: 6, effectPerLevel: { kind: 'labSpeed', value: 0.3 }, curve: '每级 +30% 研究速度' },
  { key: 'SolarSailLife', name: 'Solar Sail Life', nameZh: '太阳帆寿命', maxLevel: 6, effectPerLevel: { kind: 'other', value: 0.1 }, curve: '每级 +10% 太阳帆寿命' },
  { key: 'RayTransmissionEfficiency', name: 'Ray Transmission Efficiency', nameZh: '射线传输效率', maxLevel: 6, effectPerLevel: { kind: 'other', value: -0.1 }, curve: '每级 −10% 射线接收站能量损失' },
  { key: 'EnergyCircuit', name: 'Energy Circuit', nameZh: '能量回路', maxLevel: 6, effectPerLevel: { kind: 'other', value: 0.1 }, curve: '每级 +10% 蓄电器容量' },
  { key: 'MechaCore', name: 'Mecha Core', nameZh: '机甲核心', maxLevel: 6, effectPerLevel: { kind: 'other', value: 0.1 }, curve: '每级 +10% 机甲核心容量' },
  { key: 'InventoryCapacity', name: 'Inventory Capacity', nameZh: '背包容量', maxLevel: 6, effectPerLevel: { kind: 'inventoryCapacity', value: 1 }, curve: '每级 +1 行背包' },
];

// ---------------------------------------------------------------------------

function normaliseBuildingKey(raw) {
  return String(raw.key ?? raw.Key ?? '');
}

function main() {
  const itemsFile = readResearch('items.json');
  const recipesFile = readResearch('recipes.json');
  const buildingsFile = readResearch('buildings.json');
  const techFile = readResearch('tech.json');
  const proliferatorFile = readResearch('proliferator.json');
  const beltsFile = readResearch('mining-belts.json');

  if (!itemsFile || !recipesFile) {
    console.error('items.json and recipes.json are required (run the data extraction first).');
    process.exitCode = 1;
    return;
  }

  const items = itemsFile.items ?? [];

  // ---- de-duplicate items ------------------------------------------------
  // The extraction can produce two spellings of the same prototype (observed:
  // "SelfevolutionLab" vs "SelfEvolutionLab" both carrying id 2902). A duplicate
  // id makes blueprint resolution ambiguous, so keep the first occurrence and
  // report the rest.
  const seenItemIds = new Map();
  const seenItemKeys = new Set();
  const dedupedItems = [];
  const droppedItems = [];
  for (const item of items) {
    const key = String(item.key ?? '');
    if (!key) {
      droppedItems.push(`<no key, id ${item.id}>`);
      continue;
    }
    if (seenItemKeys.has(key.toLowerCase())) {
      droppedItems.push(key);
      continue;
    }
    if (item.id != null) {
      const prev = seenItemIds.get(item.id);
      if (prev !== undefined) {
        droppedItems.push(`${key} (duplicate id ${item.id} of ${prev})`);
        continue;
      }
      seenItemIds.set(item.id, key);
    }
    seenItemKeys.add(key.toLowerCase());
    dedupedItems.push(item);
  }
  if (droppedItems.length > 0) {
    provenance.fallback.push(`dropped ${droppedItems.length} duplicate item entries: ${droppedItems.slice(0, 6).join(', ')}`);
  }
  items.length = 0;
  items.push(...dedupedItems);

  // ---- buildings ---------------------------------------------------------
  let buildings;
  // Filled when the prefab data is read, then attached to `dataset.meta` below.
  let sorterAttachSlotsSource = null;
  if (buildingsFile && Array.isArray(buildingsFile.buildings) && buildingsFile.buildings.length > 0) {
    buildings = buildingsFile.buildings;
    // The extraction writes explicit nulls for fields it could not determine
    // (`slots` is the observed case: every entry has `slots: null`). Replacing the
    // fallback table outright therefore DELETED the hand-transcribed slot counts, so
    // a null from the file is now treated as "unknown" and the fallback value wins.
    // Non-null file values still take precedence, and each filled field is reported
    // so the provenance stays auditable.
    const fallbackByKey = new Map(FALLBACK_BUILDINGS.map((b) => [String(b.key).toLowerCase(), b]));
    const filled = [];
    for (const building of buildings) {
      const fallback = fallbackByKey.get(String(building.key).toLowerCase());
      if (!fallback) continue;
      for (const [field, value] of Object.entries(fallback)) {
        if (field === 'key') continue;
        const current = building[field];
        if (value == null) continue;
        if (current == null) {
          building[field] = value;
          filled.push(`${building.key}.${field}`);
        }
      }
    }
    if (filled.length > 0) {
      provenance.fallback.push(
        `filled ${filled.length} field(s) the research file left null from the built-in tables: ${filled.slice(0, 8).join(', ')}${filled.length > 8 ? ', …' : ''}`,
      );
    }
  } else {
    buildings = FALLBACK_BUILDINGS;
    provenance.fallback.push(`buildings (${FALLBACK_BUILDINGS.length} entries) — docs/research/buildings.json missing`);
  }

  // ---- sorter attachment slots -------------------------------------------
  // Where a sorter may physically connect to a building is a property of the
  // building prototype, published as `SlotConfig.insertPoses.length` in the game's
  // prefab data. A blueprint records which slot a sorter used, so carrying the count
  // lets the simulator range-check that index instead of trusting it.
  //
  // The dataset key is camel-case from the game's item table while the prefab path is
  // kebab-case ("AssemblingMachineMk1" vs "assembler-mk-1"), and the two are not
  // derivable from each other, so the mapping is explicit. See tools/lib/prefab-slots.ts
  // for the same table with the reasoning, and SLOT_MAP below is kept in step with it.
  const SLOT_MAP = {
    AssemblingMachineMk1: 'assembler-mk-1',
    AssemblingMachineMk2: 'assembler-mk-2',
    AssemblingMachineMk3: 'assembler-mk-3',
    RecomposingAssembler: 'assembler-mk-4',
    ArcSmelter: 'smelter',
    PlaneSmelter: 'smelter-2',
    NegentropySmelter: 'smelter-3',
    ChemicalPlant: 'chemical-plant',
    QuantumChemicalPlant: 'chemical-plant-2',
    OilRefinery: 'oil-refinery',
    MiniatureParticleCollider: 'hadron-collider',
    MatrixLab: 'lab',
    SelfEvolutionLab: 'lab-2',
    DepotMk1: 'storage-1',
    DepotMk2: 'storage-2',
    ThermalPowerPlant: 'power-generator',
    MiniFusionPowerPlant: 'fusion-power-station',
    ArtificialStar: 'fusion-reactor',
    EMRailEjector: 'em-rail-ejector',
    VerticalLaunchingSilo: 'vertical-launching-silo',
    BattlefieldAnalysisBase: 'battle-base',
  };
  const prefabsRaw = readResearch('_raw/prefabs.json');
  if (prefabsRaw && prefabsRaw.prefabs) {
    const attachByShort = new Map();
    for (const [prefabKey, entry] of Object.entries(prefabsRaw.prefabs)) {
      const short = prefabKey.split('/').pop();
      const count = entry?.SlotConfig?.insertPoses?.length ?? 0;
      if (short && count > 0) attachByShort.set(short, count);
    }
    let applied = 0;
    const mismatched = [];
    for (const building of buildings) {
      const short = SLOT_MAP[building.key];
      if (!short) continue;
      const count = attachByShort.get(short);
      if (count === undefined) {
        mismatched.push(`${building.key} -> ${short}`);
        continue;
      }
      building.sorterAttachSlots = count;
      applied++;
    }
    provenance.fromFiles.push(`_raw/prefabs.json (sorter attach slots for ${applied} buildings, game ${prefabsRaw.version ?? 'unknown'})`);
    if (mismatched.length > 0) {
      console.warn(`! sorter attach slots: mapped prefabs with no attachment points: ${mismatched.join(', ')}`);
    }
    // Stashed here and attached to the dataset object further down, once it exists.
    sorterAttachSlotsSource = {
      source: 'docs/research/_raw/prefabs.json',
      gameVersion: prefabsRaw.version ?? null,
      field: 'SlotConfig.insertPoses.length — sorter attachment points on the building',
      note:
        'Counts are authoritative. The individual pose vectors are empty objects in the published data, so slot POSITIONS are unknown; see docs/SLOT-DATA-REVERSING.md. A blueprint slot index of -1 means unspecified.',
    };
  } else {
    provenance.fallback.push('sorter attach slots unavailable — docs/research/_raw/prefabs.json missing');
  }
  // Merge in any building present in the item list but absent from the table,
  // classified from the item data so nothing referenced by a recipe is
  // unresolvable. Duplicate prototype ids (observed: "SelfevolutionLab" and
  // "SelfEvolutionLab" both at id 2902) would make blueprint resolution
  // ambiguous, so they are dropped here.
  const seenBuildingIds = new Map();
  const seenBuildingKeys = new Set();
  const uniqueBuildings = [];
  const droppedBuildings = [];
  for (const b of buildings) {
    const key = normaliseBuildingKey(b);
    if (!key) continue;
    if (seenBuildingKeys.has(key.toLowerCase())) {
      droppedBuildings.push(key);
      continue;
    }
    if (b.id != null) {
      const prev = seenBuildingIds.get(b.id);
      if (prev !== undefined) {
        droppedBuildings.push(`${key} (duplicate id ${b.id} of ${prev})`);
        continue;
      }
      seenBuildingIds.set(b.id, key);
    }
    seenBuildingKeys.add(key.toLowerCase());
    uniqueBuildings.push(b);
  }
  buildings = uniqueBuildings;
  if (droppedBuildings.length > 0) {
    provenance.fallback.push(`dropped ${droppedBuildings.length} duplicate buildings: ${droppedBuildings.join(', ')}`);
  }

  // Any item categorised as a building that has no building entry yet is added
  // with neutral stats. Keys and ids are compared case-insensitively: the
  // research data contains "SelfevolutionLab" and "SelfEvolutionLab" for the
  // same prototype (id 2902), and a second entry on one id would make blueprint
  // resolution ambiguous.
  const buildingKeys = new Set(buildings.map((b) => normaliseBuildingKey(b).toLowerCase()));
  const buildingIdOwner = new Map();
  for (const b of buildings) if (b.id != null) buildingIdOwner.set(b.id, normaliseBuildingKey(b));
  for (const item of items) {
    if (item.category !== 'building') continue;
    const lower = String(item.key ?? '').toLowerCase();
    if (!lower || buildingKeys.has(lower)) continue;
    if (item.id != null && buildingIdOwner.has(item.id)) {
      provenance.fallback.push(`skipped item-derived building ${item.key} (id ${item.id} already covered by ${buildingIdOwner.get(item.id)})`);
      continue;
    }
    buildings.push({
      key: item.key,
      name: item.name,
      nameZh: item.nameZh,
      id: item.id,
      category: 'other',
      powerConsumptionKW: 0,
      workSpeed: null,
      note: '来自物品表，未在建筑表中单独统计',
    });
    buildingKeys.add(lower);
    if (item.id != null) buildingIdOwner.set(item.id, item.key);
    provenance.fallback.push(`building metadata for ${item.key}`);
  }

  // The full item list must contain every building so blueprint ids resolve.
  // Compare case-insensitively (the extraction uses both "SelfevolutionLab" and
  // "SelfEvolutionLab") and re-check prototype ids, since a differently spelled
  // duplicate would otherwise register two items on one id.
  const itemKeysLower = new Set(items.map((i) => String(i.key).toLowerCase()));
  const itemIdOwner = new Map();
  for (const i of items) if (i.id != null) itemIdOwner.set(i.id, i.key);
  const appendedBuildings = [];
  for (const b of buildings) {
    if (!b.key) continue;
    const lower = String(b.key).toLowerCase();
    if (itemKeysLower.has(lower)) continue;
    if (b.id != null && itemIdOwner.has(b.id)) {
      // An item already owns this id under a different spelling: reuse that key
      // for the building instead of creating a second item on the same id.
      const owner = itemIdOwner.get(b.id);
      provenance.fallback.push(`building ${b.key} shares id ${b.id} with item ${owner}; reusing ${owner}`);
      break;
    }
    items.push({
      id: b.id ?? null,
      key: b.key,
      name: b.name,
      ...(b.nameZh ? { nameZh: b.nameZh } : {}),
      category: 'building',
      stackSize: 50,
      isRaw: false,
      isFluid: false,
    });
    itemKeysLower.add(lower);
    if (b.id != null) itemIdOwner.set(b.id, b.key);
    appendedBuildings.push(b.key);
  }
  for (const key of appendedBuildings) provenance.fallback.push(`item entry for building ${key}`);

  const proliferator = proliferatorFile?.marks ?? proliferatorFile?.proliferator ?? FALLBACK_PROLIFERATOR;
  if (!proliferatorFile) provenance.fallback.push('proliferator marks');
  else {
    // The research file keys marks by prototype name ("ProliferatorMk1") while
    // the item table uses the abbreviation form ("Proliferator1"). Re-key the
    // marks onto the item table so `mark.item` always resolves.
    const itemByDisplayName = new Map();
    for (const item of items) {
      if (item.name) itemByDisplayName.set(String(item.name).toLowerCase(), item.key);
    }
    for (const mark of proliferator) {
      const byDisplay = mark.itemName ? itemByDisplayName.get(String(mark.itemName).toLowerCase()) : undefined;
      const resolved = byDisplay ?? (items.some((i) => i.key === mark.item) ? mark.item : undefined);
      if (resolved && resolved !== mark.key) {
        provenance.fallback.push(`proliferator ${mark.key} re-keyed to ${resolved} (item table key)`);
        mark.key = resolved;
      }
      if (!mark.item || !items.some((i) => i.key === mark.item)) mark.item = mark.key;
      // Record any proliferator conflict so it stays visible in the shipped data.
      if (mark.conflict && !mark.conflictNote) {
        mark.conflictNote = `${mark.conflict.field}: chose ${mark.conflict.resolved ?? '?'} (${mark.conflict.why ?? ''})`;
      }
    }
  }

  const belts = beltsFile?.belts ?? FALLBACK_BELTS;
  const sorters = beltsFile?.sorters ?? FALLBACK_SORTERS;
  if (!beltsFile) provenance.fallback.push('belts + sorters');

  // ---- extraction rates ---------------------------------------------------
  // Gathering buildings do not run recipes; their output is a rate model:
  //   output/min = extractPerMinPerVein × covered veins × mining speed multiplier
  // Verified against MinerDesc.periodf (60 / periodf reproduces 30 / 60 / 50).
  const EXTRACT_RATES = {
    MiningMachine: 30,
    AdvancedMiningMachine: 60,
    WaterPump: 50,
  };
  for (const [key, rate] of Object.entries(EXTRACT_RATES)) {
    const building = buildings.find((b) => normaliseBuildingKey(b) === key);
    if (building) {
      building.extractPerMinPerVein = rate;
    } else {
      provenance.fallback.push(`extraction rate for missing building ${key}`);
    }
  }

  // ---- gathering + mining constants for the UI ---------------------------
  const miningConstants = beltsFile?.mining
    ? {
        baseVeinSpeedPerMinPerVein: beltsFile.mining.baseVeinSpeedPerMinPerVein ?? 30,
        advancedMiningSpeedPerMinPerVein: beltsFile.mining.advancedMiningMachineSpeedPerMinPerVein ?? 60,
        waterPumpPerMin: 50,
        miningSpeedMultiplierFormula: beltsFile.mining.miningSpeedMultiplierFormula ?? '',
        veinConsumptionFormula: beltsFile.mining.veinConsumptionFormula ?? '',
        notes: beltsFile.mining.notes ?? '',
      }
    : null;
  if (!miningConstants) provenance.fallback.push('mining constants');

  const technologies = techFile?.technologies ?? [];
  let upgrades = techFile?.upgrades ?? FALLBACK_UPGRADES;
  if (!techFile) provenance.fallback.push(`upgrades (${FALLBACK_UPGRADES.length})`);
  else if (!Array.isArray(techFile.upgrades) || techFile.upgrades.length === 0) {
    upgrades = FALLBACK_UPGRADES;
    provenance.fallback.push(`upgrades (${FALLBACK_UPGRADES.length}) — tech.json had none`);
  } else {
    // ---- normalise upgrade effects -------------------------------------
    // The game data encodes Vein Utilization as a single ore-consumption
    // multiplier (0.94^level) even though it ALSO grants +10% mining speed per
    // level (dsp-wiki.com/Vein_Utilization_(Upgrade): "+10% mining speed" and
    // "−6% ore consume per level"). The engine models those as two separate
    // effects, so the speed half is added here rather than being lost.
    for (const upgrade of upgrades) {
      if (upgrade.key === 'VeinUtilization') {
        const amount = upgrade.effectPerLevel ?? {};
        upgrade.effectsPerLevel = [
          { kind: 'miningSpeedMultiplier', value: 0.1 },
          { kind: 'veinConsumptionMultiplier', value: 0.94 },
        ];
        upgrade.effectPerLevel = { kind: 'miningSpeedMultiplier', value: 0.1 };
        upgrade.veinConsumptionPerLevel = 0.94;
        upgrade.note = [
          upgrade.note ?? '',
          '游戏数据只记录 0.94^等级 的矿脉消耗乘数；+10%/级 采矿速度来自 wiki 升级页，必须在引擎里单独叠加。',
        ]
          .filter(Boolean)
          .join(' ');
        provenance.fallback.push('VeinUtilization: split into miningSpeedMultiplier (+0.10/level) + veinConsumptionMultiplier (0.94/level)');
      }
      // Effects with a null value cannot drive a multiplier; drop them so the
      // engine does not silently treat them as +0 (they are documented by
      // `curve` instead).
      if (upgrade.effectPerLevel && upgrade.effectPerLevel.value == null) {
        upgrade.effectValueUnconfirmed = upgrade.curve ?? true;
      }
    }
  }

  const dataset = {
    meta: {
      // Item/recipe ids and craft times come from the wiki's own GameData
      // module for this version, cross-checked by tools/verify-ids.mjs.
      gameVersion: '0.10.35.29104',
      generatedAt: new Date().toISOString(),
      sources: [
        'https://dsp-wiki.com/',
        'https://dsp-wiki.com/Modding:Items_IDs',
        'https://dsp-wiki.com/Modding:Recipe_IDs',
        'https://dsp-wiki.com/Spray_Coater',
        'https://dsp-wiki.com/Mining_Machine',
        'https://dsp-wiki.com/Vein_Utilization_(Upgrade)',
        ...(itemsFile.source ?? []).slice(0, 3),
        ...(recipesFile.source ?? []).slice(0, 3),
      ],
      // Provenance for the sorter attachment counts, when prefab data was available.
      ...(sorterAttachSlotsSource ? { sorterAttachSlotsSource } : {}),
    },
    items,
    buildings,
    recipes: recipesFile.recipes ?? [],
    technologies,
    upgrades,
    proliferator,
    belts,
    sorters,
    ...(miningConstants ? { miningConstants } : {}),
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(dataset, null, 1));

  console.log('=== dataset built ===');
  console.log(`items       : ${dataset.items.length}`);
  console.log(`buildings   : ${dataset.buildings.length}`);
  console.log(`recipes     : ${dataset.recipes.length}`);
  console.log(`technologies: ${dataset.technologies.length}`);
  console.log(`upgrades    : ${dataset.upgrades.length}`);
  console.log(`proliferator: ${dataset.proliferator.length}`);
  console.log(`belts       : ${dataset.belts.length}, sorters: ${dataset.sorters.length}`);
  console.log(`output      : ${OUT}`);
  console.log('\nfrom research files:');
  for (const f of provenance.fromFiles) console.log(`  + ${f}`);
  console.log('\nfrom built-in fallback tables:');
  for (const f of [...new Set(provenance.fallback)]) console.log(`  ~ ${f}`);
}

main();
