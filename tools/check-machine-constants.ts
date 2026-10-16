/**
 * Verifies the machine constants in the dataset against the game's prefab data.
 *
 * Two relations are checked exactly, across every machine that has both values:
 *
 *   workSpeed        == AssemblerDesc.speedf   (or LabDesc.assembleSpeed for labs)
 *   powerConsumptionKW == PowerDesc.workEnergyPerTick * 60 / 1000
 *
 * The second factor is the game's tick rate: energy is stored per tick and there are
 * 60 ticks per second, so kW = workEnergyPerTick * 60 / 1000. Confirming the relation
 * rather than hard-coding a value means the dataset is checked against the game rather
 * than against a number someone typed in.
 *
 * Labs carry their speed in a separate `LabDesc` as `assembleSpeed` (1 and 3), which is
 * where the matrix lab's workSpeed comes from — it has no `AssemblerDesc` at all.
 *
 * `idleEnergyPerTick` is intentionally NOT asserted: the dataset's `powerIdleKW` does
 * not follow the same factor, and the assembled-machine wiki page quotes figures that
 * disagree with the prefab, so the idle values remain unverified (see the report).
 *
 *   node --experimental-strip-types tools/check-machine-constants.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const prefabs = JSON.parse(readFileSync(resolve(ROOT, 'docs/research/_raw/prefabs.json'), 'utf8')) as {
  version?: string;
  prefabs: Record<
    string,
    {
      AssemblerDesc?: { speedf?: number; recipeType?: string };
      LabDesc?: { assembleSpeed?: number; researchSpeed?: number };
      PowerDesc?: { workEnergyPerTick?: number };
    }
  >;
};
const dataset = JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')) as {
  buildings: { key: string; workSpeed: number | null; powerConsumptionKW: number | null }[];
};

const MAP: Record<string, string> = {
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
};

interface PrefabFacts {
  /** Work-speed multiplier, from AssemblerDesc.speedf or LabDesc.assembleSpeed. */
  speed?: number;
  speedField: string;
  work?: number;
  recipeType?: string;
}
const byShort = new Map<string, PrefabFacts>();
for (const [key, value] of Object.entries(prefabs.prefabs)) {
  const assembler = value.AssemblerDesc?.speedf;
  const lab = value.LabDesc?.assembleSpeed;
  byShort.set(key.split('/').pop()!, {
    speed: assembler ?? lab,
    speedField: assembler != null ? 'AssemblerDesc.speedf' : lab != null ? 'LabDesc.assembleSpeed' : 'none',
    work: value.PowerDesc?.workEnergyPerTick,
    recipeType: value.AssemblerDesc?.recipeType,
  });
}

const TICKS_PER_SECOND = 60;
let speedChecked = 0;
let speedMismatch = 0;
let powerChecked = 0;
let powerMismatch = 0;

console.log(`prefabs ${prefabs.version ?? 'unknown'}`);
console.log('\nkey                          recipeType  speedField              speedf  workSpeed   workEnergyPerTick  derived kW  dataset kW');
for (const b of dataset.buildings) {
  const short = MAP[b.key];
  if (!short) continue;
  const p = byShort.get(short);
  if (!p) continue;

  let speedCell = '   -   ';
  if (p.speed != null && b.workSpeed != null) {
    speedChecked++;
    const ok = Math.abs(p.speed - b.workSpeed) < 1e-9;
    if (!ok) speedMismatch++;
  speedCell = ok ? '  OK   ' : ' DIFF  ';
  }

  let powerCell = '   -   ';
  let derived = '';
  if (p.work != null && b.powerConsumptionKW != null) {
    powerChecked++;
    const kW = (p.work * TICKS_PER_SECOND) / 1000;
    derived = kW.toFixed(1);
    const ok = Math.abs(kW - b.powerConsumptionKW) < 1e-6;
    if (!ok) powerMismatch++;
    powerCell = ok ? '  OK   ' : ' DIFF  ';
  }

  console.log(
    `${b.key.padEnd(28)} ${String(p.recipeType ?? '-').padEnd(11)} ${p.speedField.padEnd(22)} ` +
      `${String(p.speed ?? '-').padStart(6)} ${String(b.workSpeed ?? '-').padStart(6)}${speedCell} ` +
      `${String(p.work ?? '-').padStart(17)} ${derived.padStart(11)} ${String(b.powerConsumptionKW ?? '-').padStart(11)}${powerCell}`,
  );
}

console.log(`\nworkSpeed checked ${speedChecked}, mismatches ${speedMismatch}`);
console.log(`powerConsumptionKW checked ${powerChecked}, mismatches ${powerMismatch} (factor ${TICKS_PER_SECOND}/1000)`);
if (speedMismatch === 0 && powerMismatch === 0) {
  console.log('\nthe dataset matches the game on both relations');
} else {
  console.error('\nMISMATCH: the dataset disagrees with the game prefab data');
  process.exitCode = 1;
}
