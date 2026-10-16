"""Diagnose why MonoBehaviour type trees cannot be read, and locate the game's proto data.

UnityPy needs either an embedded type tree or a resolvable MonoScript + assembly to decode a
MonoBehaviour. This reports which of the two is missing, and lists the object types the survey
truncated.

    python tools/unity/diagnose.py "<path to resources.assets>"
"""

import sys
import traceback
from collections import Counter

import UnityPy

path = sys.argv[1]
env = UnityPy.load(path)

kinds = Counter()
for obj in env.objects:
    kinds[obj.type.name] += 1
print("=== all object types ===")
for kind, count in kinds.most_common():
    print(f"  {kind:<30} {count}")

# MonoScript objects tell us which assemblies the MonoBehaviours point at.
scripts = [o for o in env.objects if o.type.name == "MonoScript"]
print()
print(f"=== MonoScript objects: {len(scripts)} ===")
by_assembly = Counter()
for o in scripts[:4000]:
    try:
        d = o.read()
        by_assembly[f"{d.m_AssemblyName} :: {d.m_ClassName}"] += 1
    except Exception as exc:  # noqa: BLE001
        by_assembly[f"<fail {type(exc).__name__}>"] += 1
for name, count in by_assembly.most_common(15):
    print(f"  {name:<70} {count}")

# Now the failure itself, on one concrete object.
mb = [o for o in env.objects if o.type.name == "MonoBehaviour"]
print()
print(f"=== first MonoBehaviour type-tree attempt (of {len(mb)}) ===")
for o in mb[:3]:
    print(f"  pathId={o.path_id} byte_size={o.byte_size}")
    try:
        tt = o.read_typetree()
        print(f"    read_typetree OK, keys: {list(tt)[:12]}")
    except Exception as exc:  # noqa: BLE001
        print(f"    read_typetree FAILED: {type(exc).__name__}: {exc}")
        try:
            o.read()
        except Exception as exc2:  # noqa: BLE001
            print(f"    read() FAILED: {type(exc2).__name__}: {exc2}")
            traceback.print_exc(limit=4)

# Does the container carry type trees at all?
try:
    import UnityPy.files
    ser = next(iter(env.files.values()))
    print()
    print("=== container facts ===")
    print(f"  unity_version      {getattr(ser, 'unity_version', '?')}")
    print(f"  version            {getattr(ser, 'version', '?')}")
    print(f"  enable_type_tree   {getattr(ser, 'enable_type_tree', '?')}")
    types = getattr(ser, "types", None)
    if types is not None:
        with_tree = sum(1 for t in types if getattr(t, "nodes", None))
        print(f"  types              {len(types)}  (with nodes: {with_tree})")
except Exception as exc:  # noqa: BLE001
    print(f"container facts unavailable: {type(exc).__name__}: {exc}")
