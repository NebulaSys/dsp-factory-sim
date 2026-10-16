"""Locate the SlotConfig components and their owning prefabs.

`SlotConfig` is the class that holds `slotPoses` / `insertPoses` / `addonAreaCol` (Transform
references) and `addonAreaCenter` (Vector3). This finds which MonoBehaviour objects carry it and
what prefab each belongs to.

The MonoBehaviour type trees are stripped from this build, so the script reference is resolved
explicitly rather than through a full object read.

    python tools/unity/find-slotconfig.py "<path to .assets>"
"""

import sys
from collections import Counter, defaultdict

import UnityPy

path = sys.argv[1]
env = UnityPy.load(path)

by_class = Counter()
examples = defaultdict(list)
total_mb = 0

for obj in env.objects:
    if obj.type.name != "MonoBehaviour":
        continue
    total_mb += 1
    try:
        d = obj.read(check_read=False)
        script_ptr = d.m_Script
        script = script_ptr.read() if hasattr(script_ptr, "read") else script_ptr
        cls = getattr(script, "m_ClassName", None) or "<no class>"
        by_class[cls] += 1
        if cls == "SlotConfig" and len(examples[cls]) < 20:
            go = None
            try:
                go = d.m_GameObject.read()
            except Exception:  # noqa: BLE001
                pass
            examples[cls].append((obj.path_id, obj.byte_size, getattr(go, "m_Name", "?")))
    except Exception as exc:  # noqa: BLE001
        by_class[f"<fail {type(exc).__name__}>"] += 1

print(f"file: {path}")
print(f"MonoBehaviours: {total_mb}")
print()
print("=== top script classes ===")
for cls, n in by_class.most_common(30):
    print(f"  {cls:<40} {n}")
print()
print(f"=== SlotConfig instances: {by_class.get('SlotConfig', 0)} ===")
for pid, size, name in examples.get("SlotConfig", []):
    print(f"  pathId={pid:<12} {size:>5} bytes   owner GameObject: {name}")
