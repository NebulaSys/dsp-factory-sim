"""Find which object holds the building/prototype data.

Groups every MonoBehaviour by its MonoScript's assembly + class name (the script's own name is
often empty on these objects, so grouping by `m_Name` hides the answer), and lists the
TextAssets. One of these is where the prefab/slot data lives.

    python tools/unity/find-proto.py "<path to .assets>"
"""

import sys
from collections import Counter, defaultdict

import UnityPy

path = sys.argv[1]
env = UnityPy.load(path)

groups = Counter()
examples = defaultdict(list)
text_assets = []

for obj in env.objects:
    if obj.type.name == "TextAsset":
        try:
            d = obj.read(check_read=False)
            text_assets.append((getattr(d, "m_Name", "?"), obj.path_id, obj.byte_size))
        except Exception as exc:  # noqa: BLE001
            text_assets.append((f"<{type(exc).__name__}>", obj.path_id, obj.byte_size))
        continue
    if obj.type.name != "MonoBehaviour":
        continue
    try:
        d = obj.read(check_read=False)
        script = d.m_Script
        cls = getattr(script, "m_ClassName", None) or "<no class>"
        asm = getattr(script, "m_AssemblyName", None) or "<no asm>"
        key = f"{asm} :: {cls}"
        groups[key] += 1
        if len(examples[key]) < 4:
            examples[key].append((obj.path_id, obj.byte_size))
    except Exception as exc:  # noqa: BLE001
        groups[f"<read failed {type(exc).__name__}>"] += 1

print(f"file: {path}")
print()
print(f"=== MonoBehaviour script classes: {len(groups)} distinct ===")
for key, count in groups.most_common(40):
    ex = ", ".join(f"{pid}({size}B)" for pid, size in examples[key])
    print(f"  {key:<56} {count:>6}   {ex}")

print()
print(f"=== TextAssets: {len(text_assets)} ===")
for name, pid, size in sorted(text_assets, key=lambda t: -t[2]):
    print(f"  {name:<40} pathId={pid:<10} {size} bytes")
