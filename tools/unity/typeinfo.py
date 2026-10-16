"""Report whether the build ships per-script type trees, which decides how MonoBehaviours can be read.

    python tools/unity/typeinfo.py "<path to .assets>"
"""

import sys

import UnityPy

path = sys.argv[1]
env = UnityPy.load(path)
ser = next(iter(env.files.values()))

print(f"file: {path}")
print(f"  unity_version        {getattr(ser, 'unity_version', '?')}")
print(f"  serialized version   {getattr(ser, 'version', '?')}")
print(f"  enable_type_tree     {getattr(ser, 'enable_type_tree', '?')}")
print(f"  types in file        {len(getattr(ser, 'types', []))}")

types = getattr(ser, "types", [])
with_nodes = [t for t in types if getattr(t, "nodes", None)]
print(f"  types with nodes     {len(with_nodes)}")
print()

for t in types[:6]:
    nodes = getattr(t, "nodes", None) or []
    print(f"  class {t.class_id:<6} nodes={len(nodes):<6} script={getattr(t, 'script_type_index', '?')}")
    for n in nodes[:10]:
        print(f"      {n.m_Level * '  '}{n.m_Name} : {n.m_Type}")
    print()

# How big is the generic MonoBehaviour tree? A 52-byte tree is the stub.
for t in types:
    if t.class_id == 114:
        nodes = getattr(t, "nodes", None) or []
        total = sum(getattr(n, "m_ByteSize", 0) for n in nodes if getattr(n, "m_Level", 0) == 1)
        print(f"MonoBehaviour tree: {len(nodes)} nodes, top-level bytes={total}")
        for n in nodes:
            print(f"    {'  ' * n.m_Level}{n.m_Name} : {n.m_Type} ({n.m_ByteSize}B)")
        break
