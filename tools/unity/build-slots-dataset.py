"""Build `src/engine/data/building-slots.json` from the extracted SlotConfig data.

Keys the output by building **id** (the itemId the engine already uses) so nothing downstream has
to know about Unity prefab names.

The prefab -> building mapping is declared here and checked: every key must exist in the dataset,
and the extracted slot count must equal the dataset's `sorterAttachSlots` where that is declared.
A mismatch is reported rather than silently written.

    python tools/unity/build-slots-dataset.py
"""

import json
import sys
from collections import defaultdict

SRC = "docs/research/_raw/slotconfig-resources.json"
DATASET = "src/engine/data/dsp-vanilla.json"
OUT = "src/engine/data/building-slots.json"

# Unity prefab name -> engine building key. Verified by `declared` below: for every building that
# already has a sorterAttachSlots value, the extracted array length must reproduce it.
PREFAB_TO_KEY = {
    # machines (insertPoses)
    "assembler-mk-1": "AssemblingMachineMk1",
    "assembler-mk-2": "AssemblingMachineMk2",
    "assembler-mk-3": "AssemblingMachineMk3",
    "assembler-mk-4": "RecomposingAssembler",
    "smelter": "ArcSmelter",
    "smelter-2": "PlaneSmelter",
    "smelter-3": "NegentropySmelter",
    "lab": "MatrixLab",
    "lab-2": "SelfEvolutionLab",
    "storage-1": "DepotMk1",
    "storage-2": "DepotMk2",
    "oil-refinery": "OilRefinery",
    "chemical-plant": "ChemicalPlant",
    "chemical-plant-2": "QuantumChemicalPlant",
    "hadron-collider": "MiniatureParticleCollider",
    "battle-base": "BattlefieldAnalysisBase",
    "power-generator": "ThermalPowerPlant",
    "fusion-power-station": "MiniFusionPowerPlant",
    "fusion-reactor": "ArtificialStar",
    "em-rail-ejector": "EMRailEjector",
    "vertical-launching-silo": "VerticalLaunchingSilo",
    # stations / logistics / extraction (slotPoses)
    "interstellar-logistic-station": "InterstellarLogisticsStation",
    "logistic-station": "PlanetaryLogisticsStation",
    "energy-exchanger": "EnergyExchanger",
    "storage-tank": "StorageTank",
    "fractionator": "Fractionator",
    "piler": "AutomaticPiler",
    "ray-receiver": "RayReceiver",
    "mining-drill": "MiningMachine",
    "mining-drill-mk2": "AdvancedMiningMachine",
    "oil-extractor": "OilExtractor",
    "water-pump": "WaterPump",
}
# `splitter-a/b/c` are three variants of the same building.
for v in ("a", "b", "c"):
    PREFAB_TO_KEY[f"splitter-{v}"] = "Splitter"

data = json.load(open(SRC, encoding="utf-8"))
dataset = json.load(open(DATASET, encoding="utf-8"))

by_key = {b["key"]: b for b in dataset["buildings"]}
by_prefab = defaultdict(list)
for e in data:
    by_prefab[e["prefab"]].append(e)

problems = []
out = {}
for prefab, key in PREFAB_TO_KEY.items():
    entries = by_prefab.get(prefab)
    if not entries:
        problems.append(f"prefab `{prefab}` not found in the extracted data")
        continue
    b = by_key.get(key)
    if b is None:
        problems.append(f"building key `{key}` is not in the dataset")
        continue

    e = entries[0]
    # Do all instances agree?
    sigs = {
        tuple((round(s["x"], 4), round(s["y"], 4), round(s["z"], 4)) for s in (x["insertPoses"] or x["slotPoses"]))
        for x in entries
    }
    if len(sigs) > 1:
        problems.append(f"`{prefab}`: {len(entries)} instances disagree on slot layout")

    poses = e["insertPoses"] if e["insertPoseCount"] else e["slotPoses"]
    source = "insertPoses" if e["insertPoseCount"] else "slotPoses"

    declared = b.get("sorterAttachSlots")
    if declared is not None and declared != len(poses):
        problems.append(f"`{prefab}` -> {key}: extracted {len(poses)} slots but dataset declares {declared}")

    bid = b["id"]
    entry = {
        "key": key,
        "prefab": prefab,
        "source": source,
        # Prefab-local coordinates. `x`/`z` span the ground plane and `y` is height, because the
        # prefab is a Unity object (Y-up) while a blueprint stores (x, y) horizontal + z vertical.
        "slots": [
            {"x": round(p["x"], 5), "y": round(p["y"], 5), "z": round(p["z"], 5)} for p in poses
        ],
        "rotations": [
            [round(p["rx"], 5), round(p["ry"], 5), round(p["rz"], 5), round(p["rw"], 5)]
            for p in poses
        ],
    }
    if bid in out:
        # Several Unity prefabs can back one building (the three splitter visual variants). A
        # blueprint only records `itemId`, so which variant is in use is not recoverable from the
        # save data; keep every distinct layout instead of pretending there is only one.
        existing = out[bid]
        if existing["slots"] == entry["slots"]:
            existing["prefab"] = f"{existing['prefab']},{prefab}"
            continue
        existing.setdefault("variants", []).append(
            {"prefab": prefab, "slots": entry["slots"], "rotations": entry["rotations"]}
        )
        existing["prefab"] = f"{existing['prefab']},{prefab}"
        problems.append(
            f"building id {bid} ({key}): `{prefab}` has a different layout from "
            f"`{existing['prefab'].split(',')[0]}` — kept as a variant"
        )
        continue
    out[bid] = entry

if problems:
    print("PROBLEMS:")
    for p in problems:
        print(f"  - {p}")
    if any("not found" in p or "not in the dataset" in p or "disagree" in p or "declares" in p for p in problems):
        sys.exit(1)

payload = {
    "_source": (
        "Extracted from DSPGAME_Data/resources.assets (Unity 2022.3.62f3c1, serialized version 22) "
        "by tools/unity/extract-slots.py. SlotConfig (Assembly-CSharp.dll type 0x0200012b) holds "
        "slotPoses/insertPoses as Transform references; this build strips type trees, so the "
        "MonoBehaviour bodies were decoded against the field list read from the assembly."
    ),
    "_coordinates": (
        "Prefab-local. x/z are the ground plane and y is height (the prefab is a Unity Y-up "
        "object; a blueprint stores x/y horizontal and z vertical). Index order matches the "
        "game's outputToSlot / inputFromSlot. "
        "WARNING — the POINTS ARE NOT CALIBRATED AND ARE NOT VERIFIED TO BE SORTER ATTACHMENT "
        "POINTS. A fit over 40622 (building, sorter arm end) pairs from 28 real blueprints found "
        "no axis mapping or translation that aligns these points with observed sorter positions "
        "(best single translation 4.8%). Only the ARRAY LENGTH is verified, against the "
        "independent sorterAttachSlots figure. See docs/BUILDING-SLOTS.md section 6."
    ),
    "_verified": (
        "Every building that already declared sorterAttachSlots reproduces that count exactly "
        f"({sum(1 for bid, v in out.items() if by_key[v['key']].get('sorterAttachSlots') is not None)} buildings). "
        "No duplicate prefab instance disagrees on its slot layout."
    ),
    "buildings": out,
}

json.dump(payload, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"wrote {OUT}")
print(f"buildings with slots: {len(out)}")
checked = [(v["key"], len(v["slots"]), by_key[v["key"]].get("sorterAttachSlots")) for v in out.values()]
agree = [c for c in checked if c[2] is not None and c[2] == c[1]]
print(f"cross-checked against sorterAttachSlots: {len(agree)} agree, 0 mismatch")
for key, n, declared in sorted(checked, key=lambda c: -c[1]):
    mark = "ok " if declared is None or declared == n else "BAD"
    print(f"  {mark} {key:<30} slots={n:<3} declared={declared if declared is not None else '—'}")
