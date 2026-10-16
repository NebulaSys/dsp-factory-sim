"""Dump the raw bytes of SlotConfig components so their layout can be read off them.

`SlotConfig` is declared in the assembly as:

    Vector3 selectCenter, selectSize;
    float   selectDistance, selectAlpha, signHeight, signSize;
    float   overrideBarWidth, overrideBarHeight;
    Transform[] slotPoses, insertPoses, addonAreaCol;
    Vector3[]   addonAreaCenter;

but this build strips type trees, so the byte layout has to be confirmed against real objects
rather than assumed. Objects of a few different sizes are dumped so the array counts and the
Transform path IDs are visible.

    python tools/unity/dump-slotconfig-raw.py "<path to .assets>"
"""

import struct
import sys

import UnityPy

path = sys.argv[1]
env = UnityPy.load(path)

wanted = {96: 3, 120: 2, 144: 2, 180: 2, 240: 2}
seen = {}

for obj in env.objects:
    if obj.type.name != "MonoBehaviour":
        continue
    size = obj.byte_size
    if size not in wanted or wanted[size] <= 0:
        continue
    try:
        d = obj.read(check_read=False)
        script = d.m_Script.read()
        if getattr(script, "m_ClassName", "") != "SlotConfig":
            continue
    except Exception:  # noqa: BLE001
        continue

    wanted[size] -= 1
    raw = obj.get_raw_data()
    owner = "?"
    try:
        owner = d.m_GameObject.read().m_Name
    except Exception:  # noqa: BLE001
        pass

    print(f"=== {owner}   pathId={obj.path_id}   {size} bytes ===")
    for i in range(0, len(raw), 16):
        chunk = raw[i : i + 16]
        hexs = " ".join(f"{b:02x}" for b in chunk)
        print(f"  +{i:>3}  {hexs:<48}")
    print("  as i32 (4-byte aligned):")
    for i in range(0, len(raw) - 3, 4):
        v = struct.unpack_from("<i", raw, i)[0]
        f = struct.unpack_from("<f", raw, i)[0]
        print(f"    +{i:>3}  i32={v:>12}   f32={f:>14.5f}")
    print()
    if all(n <= 0 for n in wanted.values()):
        break
