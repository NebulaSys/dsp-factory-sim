"""Summarise the extracted SlotConfig data: one row per prefab, with coordinates.

    python tools/unity/summarise-slots.py docs/research/_raw/slotconfig.json
"""

import json
import sys
from collections import defaultdict

data = json.load(open(sys.argv[1], encoding="utf-8"))

by_prefab = defaultdict(list)
for e in data:
    by_prefab[e["prefab"]].append(e)

print(f"SlotConfig components: {len(data)}")
print(f"distinct prefab names: {len(by_prefab)}")
print()

# Do repeated instances of the same prefab agree? If they do, the extraction is stable.
disagreements = []
for prefab, entries in by_prefab.items():
    sigs = {
        tuple((round(s["x"], 4), round(s["y"], 4), round(s["z"], 4)) for s in e["slotPoses"] if "unresolved" not in s)
        for e in entries
    }
    if len(sigs) > 1:
        disagreements.append((prefab, len(entries), len(sigs)))
print(f"prefabs whose duplicate instances disagree on slotPoses: {len(disagreements)}")
for p, n, k in disagreements[:10]:
    print(f"  {p:<30} instances={n} distinct layouts={k}")
print()

rows = sorted(by_prefab.items(), key=lambda kv: (-kv[1][0]["slotPoseCount"], kv[0]))
print("=== prefab -> slot count (deduplicated) ===")
print(f"{'prefab':<34} {'instances':>9} {'slotPoses':>9} {'insertPoses':>11}")
for prefab, entries in rows:
    e = entries[0]
    print(f"{prefab:<34} {len(entries):>9} {e['slotPoseCount']:>9} {e['insertPoseCount']:>11}")

print()
print("=== coordinates for the largest slot sets ===")
for prefab, entries in rows[:6]:
    e = entries[0]
    print(f"-- {prefab}  ({e['slotPoseCount']} slots)")
    for i, s in enumerate(e["slotPoses"]):
        if "unresolved" in s:
            print(f"   [{i}] unresolved")
        else:
            print(f"   [{i}] local=({s['x']:>8.4f}, {s['y']:>8.4f}, {s['z']:>8.4f})  rot=({s['rx']:.4f},{s['ry']:.4f},{s['rz']:.4f},{s['rw']:.4f})")
