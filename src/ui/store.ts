/**
 * Shared UI state: the loaded dataset, the current research state, the active
 * blueprint and the active plan. Views read from here and re-render on change.
 */

import { GameData } from '../engine/registry.ts';
import { computeBonuses, emptyResearch, type ActiveBonuses, type ResearchState } from '../engine/rules.ts';
import type { FactoryModel } from '../engine/factory.ts';
import type { PlanResult } from '../engine/planner.ts';
import type { ProliferatorMode } from '../engine/types.ts';

export interface ProliferatorChoice {
  markKey: string | null;
  mode: ProliferatorMode;
}

export interface UiState {
  data: GameData;
  research: ResearchState;
  bonuses: ActiveBonuses;
  blueprintText: string | null;
  factory: FactoryModel | null;
  plan: PlanResult | null;
  proliferator: ProliferatorChoice;
  planProliferator: ProliferatorChoice;
  throughput: number;
  allowAlternates: boolean;
}

type Listener = () => void;

export class Store {
  readonly state: UiState;
  private listeners = new Set<Listener>();

  constructor(data: GameData) {
    this.state = {
      data,
      research: emptyResearch(),
      bonuses: computeBonuses(data, emptyResearch()),
      blueprintText: null,
      factory: null,
      plan: null,
      proliferator: { markKey: null, mode: 'none' },
      planProliferator: { markKey: null, mode: 'none' },
      throughput: 1,
      allowAlternates: false,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Recompute derived values after a mutation, then notify views. */
  update(mutate: (state: UiState) => void): void {
    mutate(this.state);
    this.state.bonuses = computeBonuses(this.state.data, this.state.research);
    for (const listener of this.listeners) listener();
  }

  /** Research state helpers -------------------------------------------------- */

  toggleTech(key: string): void {
    this.update((s) => {
      if (s.research.technologies.has(key)) s.research.technologies.delete(key);
      else s.research.technologies.add(key);
    });
  }

  setTech(key: string, researched: boolean): void {
    this.update((s) => {
      if (researched) s.research.technologies.add(key);
      else s.research.technologies.delete(key);
    });
  }

  setUpgradeLevel(key: string, level: number): void {
    this.update((s) => {
      s.research.upgradeLevels[key] = level;
    });
  }

  researchAll(): void {
    this.update((s) => {
      for (const t of s.data.technologies) s.research.technologies.add(t.key);
    });
  }

  clearResearch(): void {
    this.update((s) => {
      s.research.technologies.clear();
      s.research.upgradeLevels = {};
    });
  }
}
