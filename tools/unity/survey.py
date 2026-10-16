"""Survey a Unity .assets file: object types and, for MonoBehaviours, the script names.

The point is to find where the building prefab data lives before writing an extractor. UnityPy
handles the container format, so this is a few lines rather than the hand-rolled parser that
stalled in tools/unity/serialized-file.ts.

    python tools/unity/survey.py "<path to resources.assets>"
"""

import sys
from collections import Counter

import UnityPy

path = sys.argv[1]
env = UnityPy.load(path)

kinds = Counter()
scripts = Counter()
samples = {}
n = 0

for obj in env.objects:
    n += 1
    kinds[obj.type.name] += 1
    if obj.type.name == "MonoBehaviour":
        try:
            # The type trees in this build are the generic MonoBehaviour stub, so a strict read
            # fails the byte-count check. Reading leniently still yields m_Script, which is what
            # identifies the class.
            data = obj.read(check_read=False)
            name = getattr(data.m_Script, "m_Name", None) or getattr(data, "m_Name", None) or "<unnamed>"
            scripts[name] += 1
            if name not in samples:
                samples[name] = (obj.path_id, obj.byte_size)
        except Exception as exc:  # noqa: BLE001 - survey, report and continue
            scripts[f"<read failed: {type(exc).__name__}>"] += 1

print(f"file: {path}")
print(f"objects: {n}")
print()
print("=== objects per type (all) ===")
for kind, count in kinds.most_common():
    print(f"  {kind:<24} {count}")

print()
print("=== MonoBehaviour script names (top 40) ===")
for name, count in scripts.most_common(40):
    pid, size = samples.get(name, ("", ""))
    print(f"  {name:<44} {count:>6}   first pathId={pid} bytes={size}")
