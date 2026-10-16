/**
 * Derive where a sorter or belt can attach to each building, from real blueprints.
 *
 * A sorter record stores both ends of its arm: `(x, y, z)` and the secondary anchor
 * `(x2, y2, z2)`, 1..3 cells apart — the physical reach. Each end touches something, so matching
 * the ends against the buildings they land on yields, for every building type, the set of
 * positions in that building's **own frame** where a connection exists.
 *
 * Outputs a per-building table: attach offsets (rotated into the building's local frame by its
 * yaw), which side the sorter comes from, and how often each was observed. Nothing here changes
 * the simulator; it is measurement.
 *
 *   node --experimental-strip-types tools/derive-attach-points.ts [--json <path>]
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')),
);
const byId = new Map(data.buildings.map((b) => [b.id, b]));
const keyOf = (id: number): string => byId.get(id)?.key ?? `id${id}`;

const isBelt = (id: number): boolean => id >= 2001 && id <= 2003;
const isSorter = (id: number): boolean => id >= 2011 && id <= 2014;

interface Building {
  index: number;
  itemId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  x2: number;
  y2: number;
  z2: number;
}

/** Footprint box half-extents, in cells. */
function halfExtent(b: Building): { hw: number; hh: number } {
  const def = byId.get(b.itemId);
  const fp = def?.footprint;
  if (fp && fp.w > 0 && fp.h > 0) return { hw: fp.w / 2, hh: fp.h / 2 };
  return { hw: 0.5, hh: 0.5 };
}

/** Is `p` inside or on the box of `b` (allowing a small slack for float noise)? */
function touches(b: Building, px: number, py: number, slack = 0.35): boolean {
  const { hw, hh } = halfExtent(b);
  return Math.abs(px - b.x) <= hw + slack && Math.abs(py - b.y) <= hh + slack;
}

const rot = (dx: number, dy: number, deg: number): { x: number; y: number } => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
};

// ---------------------------------------------------------------- data collection

interface Observation {
  hostKey: string;
  hostId: number;
  /** Which arm end landed on the host. */
  end: 'A' | 'B';
  /** Sorter type that made the connection. */
  viaId: number;
  /** Local-frame offset from the host centre to the attach point, in cells. */
  lx: number;
  ly: number;
  /** Local-frame offset of the sorter's *other* end: the direction the arm reaches out. */
  ox: number;
  oy: number;
  /** Slot index reported by the game for this link, when the link resolved. */
  slot: number | null;
  /** Host yaw, kept so the spread can be judged. */
  yaw: number;
}

const observations: Observation[] = [];
let sorterCount = 0;
let unresolvedEnds = 0;
let linkA = 0;
let linkB = 0;
let linkNeither = 0;

async function analyse(text: string): Promise<void> {
  const d = await decodeBlueprint(text);
  const buildings = d.body.buildings as unknown as Building[];
  if (buildings.length === 0) return;

  // Coarse grid keyed on floor(x), floor(y) so a query examines a handful of candidates.
  const grid = new Map<string, Building[]>();
  const gk = (x: number, y: number): string => `${Math.floor(x)}|${Math.floor(y)}`;
  for (const b of buildings) {
    const k = gk(b.x, b.y);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(b);
  }
  const near = (x: number, y: number): Building[] => {
    const out: Building[] = [];
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) out.push(...(grid.get(gk(x + dx, y + dy)) ?? []));
    }
    return out;
  };

  for (const s of buildings) {
    if (!isSorter(s.itemId)) continue;
    sorterCount++;

    const raw = s as unknown as { inputObjectIndex?: number; outputObjectIndex?: number; inputFromSlot?: number; outputToSlot?: number };
    const inRef = raw.inputObjectIndex ?? -1;
    const outRef = raw.outputObjectIndex ?? -1;
    const slotFor = (end: 'A' | 'B'): number | null => {
      // Which reference names a building this end touches?
      for (const [ref, slot, which] of [
        [inRef, raw.inputFromSlot ?? -1, 'in'] as const,
        [outRef, raw.outputToSlot ?? -1, 'out'] as const,
      ]) {
        if (ref < 0) continue;
        const t = buildings[ref];
        if (!t) continue;
        const [ex, ey] = end === 'A' ? [s.x, s.y] : [s.x2, s.y2];
        if (touches(t, ex, ey)) return slot;
        void which;
      }
      return null;
    };

    const ends: { end: 'A' | 'B'; x: number; y: number }[] = [
      { end: 'A', x: s.x, y: s.y },
      { end: 'B', x: s.x2, y: s.y2 },
    ];

    // Track which reference resolved to which end, to learn the convention.
    const resolvedEnds = new Set<'A' | 'B'>();
    for (const { end, x, y } of ends) {
      const candidates = near(x, y).filter((c) => c !== s && touches(c, x, y));
      if (candidates.length === 0) {
        unresolvedEnds++;
        continue;
      }
      // A sorter end that lands on a belt should be attributed to the belt, but a machine
      // footprint can also contain belts; prefer a machine, then a belt, then a sorter.
      const host =
        candidates.find((c) => !isBelt(c.itemId) && !isSorter(c.itemId)) ??
        candidates.find((c) => isBelt(c.itemId)) ??
        candidates[0]!;

      const other = end === 'A' ? { x: s.x2, y: s.y2 } : { x: s.x, y: s.y };
      const local = rot(x - host.x, y - host.y, host.yaw);
      const outer = rot(other.x - host.x, other.y - host.y, host.yaw);
      observations.push({
        hostKey: keyOf(host.itemId),
        hostId: host.itemId,
        end,
        viaId: s.itemId,
        lx: local.x,
        ly: local.y,
        ox: outer.x,
        oy: outer.y,
        slot: slotFor(end),
        yaw: host.yaw,
      });

      if (inRef >= 0 && buildings[inRef] === host) resolvedEnds.add(end);
      if (outRef >= 0 && buildings[outRef] === host) resolvedEnds.add(end);
    }

    // Which end does each reference name?
    if (inRef >= 0 || outRef >= 0) {
      const refName = (ref: number): 'A' | 'B' | null => {
        if (ref < 0) return null;
        const t = buildings[ref];
        if (!t) return null;
        if (touches(t, s.x, s.y)) return 'A';
        if (touches(t, s.x2, s.y2)) return 'B';
        return null;
      };
      const ri = refName(inRef);
      const ro = refName(outRef);
      if (ri === 'A' && ro === 'B') {
        linkA++;
      } else if (ri === 'B' && ro === 'A') {
        linkB++;
      } else {
        linkNeither++;
      }
    }
  }
}

const sources: { name: string; text: string }[] = [];
for (const dir of ['docs/research/_raw/realbp', 'public/samples']) {
  const full = resolve(ROOT, dir);
  for (const f of readdirSync(full).filter((x) => x.endsWith('.txt'))) {
    sources.push({ name: `${dir}/${f}`, text: readFileSync(resolve(full, f), 'utf8').trim() });
  }
}
let decoded = 0;
let firstError: unknown = null;
for (const s of sources) {
  try {
    await analyse(s.text);
    decoded++;
  } catch (e) {
    if (!firstError) firstError = e;
  }
}
if (firstError) console.log('first failure:', (firstError as Error).stack?.split('\n').slice(0, 4).join('\n'));

console.log(`blueprints decoded: ${decoded} / ${sources.length}`);
console.log(`sorters examined:   ${sorterCount}`);
console.log(`arm ends with no building under them: ${unresolvedEnds}`);
console.log('');
console.log('=== which arm end do the game\'s link fields name? ===');
console.log(`  input=endA & output=endB : ${linkA}`);
console.log(`  input=endB & output=endA : ${linkB}`);
console.log(`  neither / unresolvable   : ${linkNeither}`);
console.log('');

// ---------------------------------------------------------------- aggregation

interface Group {
  hostKey: string;
  hostId: number;
  end: 'A' | 'B';
  via: string;
  count: number;
  lx: number;
  ly: number;
  ox: number;
  oy: number;
  slots: Map<number, number>;
  yaws: Set<number>;
}

const groups = new Map<string, Group>();
for (const o of observations) {
  // Round to 0.25 cells: enough to separate distinct attach points without splitting on noise.
  const r = (v: number): number => Math.round(v * 4) / 4;
  const gk = `${o.hostKey}|${o.end}|${keyOf(o.viaId)}|${r(o.lx)},${r(o.ly)}`;
  let g = groups.get(gk);
  if (!g) {
    g = {
      hostKey: o.hostKey,
      hostId: o.hostId,
      end: o.end,
      via: keyOf(o.viaId),
      count: 0,
      lx: 0,
      ly: 0,
      ox: 0,
      oy: 0,
      slots: new Map(),
      yaws: new Set(),
    };
    groups.set(gk, g);
  }
  g.count++;
  g.lx += o.lx;
  g.ly += o.ly;
  g.ox += o.ox;
  g.oy += o.oy;
  g.yaws.add(Math.round(o.yaw));
  if (o.slot !== null && o.slot >= 0) g.slots.set(o.slot, (g.slots.get(o.slot) ?? 0) + 1);
}

const hosts = new Map<string, Group[]>();
for (const g of groups.values()) {
  if (!hosts.has(g.hostKey)) hosts.set(g.hostKey, []);
  hosts.get(g.hostKey)!.push(g);
}

console.log('=== attach points per building (local frame, cells from centre) ===');
console.log('building                      declared  end  via        dx      dy    reach-to     n    yaws  slots');
for (const [hostKey, list] of [...hosts.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const declared = byId.get(list[0]!.hostId)?.sorterAttachSlots ?? '-';
  for (const g of list.sort((a, b) => a.end.localeCompare(b.end) || a.ly - b.ly || a.lx - b.lx)) {
    const lx = g.lx / g.count;
    const ly = g.ly / g.count;
    const ox = g.ox / g.count;
    const oy = g.oy / g.count;
    const slots = [...g.slots.entries()].sort((a, b) => a[0] - b[0]).map(([s, c]) => `${s}×${c}`).join(' ');
    console.log(
      `${hostKey.padEnd(29)} ${String(declared).padStart(6)}  ${g.end}   ${g.via.padEnd(10)} ` +
        `${lx.toFixed(2).padStart(6)} ${ly.toFixed(2).padStart(6)}  ` +
        `(${ox.toFixed(1)},${oy.toFixed(1)})`.padEnd(14) +
        `${String(g.count).padStart(5)}  ${String(g.yaws.size).padStart(4)}  ${slots}`,
    );
  }
}

const jsonPath = process.argv[process.argv.indexOf('--json') + 1];
if (process.argv.includes('--json') && jsonPath) {
  const out = [...hosts.entries()].map(([hostKey, list]) => ({
    hostKey,
    hostId: list[0]!.hostId,
    declaredSlots: byId.get(list[0]!.hostId)?.sorterAttachSlots ?? null,
    attach: list.map((g) => ({
      end: g.end,
      via: g.via,
      dx: Number((g.lx / g.count).toFixed(3)),
      dy: Number((g.ly / g.count).toFixed(3)),
      reachTo: [Number((g.ox / g.count).toFixed(2)), Number((g.oy / g.count).toFixed(2))],
      observations: g.count,
      yawVariants: g.yaws.size,
      slots: Object.fromEntries([...g.slots.entries()].sort((a, b) => a[0] - b[0])),
    })),
  }));
  writeFileSync(resolve(ROOT, jsonPath), JSON.stringify(out, null, 2));
  console.log(`\nwrote ${jsonPath}`);
}
