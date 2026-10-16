"""Dump the head of every TextAsset so its format can be identified.

    python tools/unity/dump-textassets.py "<path to .assets>" [out-dir]
"""

import os
import sys

import UnityPy

path = sys.argv[1]
out_dir = sys.argv[2] if len(sys.argv) > 2 else None

env = UnityPy.load(path)
if out_dir:
    os.makedirs(out_dir, exist_ok=True)

for obj in env.objects:
    if obj.type.name != "TextAsset":
        continue
    d = obj.read(check_read=False)
    name = getattr(d, "m_Name", "?")
    script = getattr(d, "m_Script", b"")
    if isinstance(script, str):
        data = script.encode("utf-8", "surrogateescape")
    else:
        data = bytes(script)
    print(f"=== {name}  ({len(data)} bytes) ===")
    head = data[:200]
    printable = sum(1 for b in head if 32 <= b < 127 or b in (9, 10, 13))
    print(f"  first 200 bytes: {printable}/200 printable")
    try:
        print("  text head: " + head.decode("utf-8")[:180].replace("\n", "\\n").replace("\r", "\\r"))
    except UnicodeDecodeError:
        print("  hex head:  " + head[:64].hex())
    print()
    if out_dir:
        safe = name.replace("/", "_").replace("\\", "_")
        with open(os.path.join(out_dir, safe), "wb") as fh:
            fh.write(data)
        print(f"  wrote {safe}")
        print()
