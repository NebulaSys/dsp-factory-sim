"""Extract每 building prefab 的可连接槽位坐标 from SlotConfig components.

Why this works: `SlotConfig` (Assembly-CSharp.dll, type 0x0200012b) declares

    Vector3 selectCenter, selectSize;
    float   selectDistance, selectAlpha, signHeight, signSize;
    float   overrideBarWidth, overrideBarHeight;
    Transform[] slotPoses, insertPoses, addonAreaCol;
    Vector3[]   addonAreaCenter;

The arrays are **Transform references**, not raw coordinates — which is exactly why the wiki's
`protosets.json` export shows a correct length but `{}` for every element: an object reference
does not serialise to JSON. Following each reference to its Transform yields `m_LocalPosition`,
the real slot coordinate.

This build strips type trees, so the MonoBehaviour body is decoded here using the field list
above. The layout was confirmed against real objects rather than assumed:

    32 (m_GameObject 12 + m_Script 12 + two empty strings 8)
  + 48 (Vector3, Vector3, 6 floats)
  + 4 + 12*n(slotPoses) + 4 + 12*n(insertPoses) + 4 + 12*n(addonAreaCol) + 4 + 12*n(addonAreaCenter)

For `fusion-reactor` that is 32+48+4+4*12+4+4+4 = 144 bytes, and for `space-unit-lancer`
32+48+4+7*12+4+4+4 = 180 — both exactly the recorded object sizes, with no slack.

    python tools/unity/extract-slots.py "<path to .assets>" <out.json>
"""

import json
import struct
import sys

import UnityPy

assets_path = sys.argv[1]
out_path = sys.argv[2]
env = UnityPy.load(assets_path)

# pathID -> object, for resolving the Transform references.
by_path = {}
for obj in env.objects:
    by_path[obj.path_id] = obj


def read_pptr(raw, off):
    """PPtr: int32 fileID then int64 pathID."""
    file_id = struct.unpack_from("<i", raw, off)[0]
    path_id = struct.unpack_from("<q", raw, off + 4)[0]
    return file_id, path_id


def decode_slotconfig(raw):
    """Return (slotPoses, insertPoses, addonAreaCol, addonAreaCenter, header) or None."""
    if len(raw) < 32:
        return None
    o = 32
    o += 48  # Vector3 selectCenter, Vector3 selectSize, 6 floats
    out = {}
    for name, stride in (("slotPoses", 12), ("insertPoses", 12), ("addonAreaCol", 12), ("addonAreaCenter", 12)):
        if o + 4 > len(raw):
            return None
        n = struct.unpack_from("<i", raw, o)[0]
        o += 4
        if n < 0 or n > 4096 or o + n * stride > len(raw):
            return None
        items = []
        for _ in range(n):
            if stride == 12 and name == "addonAreaCenter":
                items.append(struct.unpack_from("<3f", raw, o))
            else:
                items.append(read_pptr(raw, o))
            o += stride
        out[name] = items
    return out, o


def _quat_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def _quat_rotate(q, v):
    """Rotate vector v by quaternion q (x, y, z, w)."""
    x, y, z, w = q
    vx, vy, vz = v
    # t = 2 * cross(q.xyz, v); v' = v + w*t + cross(q.xyz, t)
    tx = 2 * (y * vz - z * vy)
    ty = 2 * (z * vx - x * vz)
    tz = 2 * (x * vy - y * vx)
    return (
        vx + w * tx + (y * tz - z * ty),
        vy + w * ty + (z * tx - x * tz),
        vz + w * tz + (x * ty - y * tx),
    )


def transform_local(path_id, depth=0):
    """Position of a Transform relative to the prefab root, in the root's frame.

    `m_LocalPosition` is relative to the transform's PARENT, so reading it directly gives a
    coordinate in whatever intermediate node the slot happens to hang under — which is why the
    first extraction produced points that did not line up with real sorter positions. This walks
    the parent chain and composes, stopping at the top of the prefab.
    """
    if depth > 16:
        return None
    obj = by_path.get(path_id)
    if obj is None or obj.type.name != "Transform":
        return None
    try:
        t = obj.read()
        p = t.m_LocalPosition
        r = t.m_LocalRotation
        local_p = (float(p.x), float(p.y), float(p.z))
        local_r = (float(r.x), float(r.y), float(r.z), float(r.w))

        father = t.m_Father
        father_id = getattr(father, "m_PathID", 0) if father is not None else 0
        if not father_id:
            parent_p, parent_r = (0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)
        else:
            up = transform_local(father_id, depth + 1)
            if up is None:
                parent_p, parent_r = (0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)
            else:
                parent_p = (up["px"], up["py"], up["pz"])
                parent_r = (up["rx"], up["ry"], up["rz"], up["rw"])

        rotated = _quat_rotate(parent_r, local_p)
        world_p = (parent_p[0] + rotated[0], parent_p[1] + rotated[1], parent_p[2] + rotated[2])
        world_r = _quat_mul(parent_r, local_r)
        return {
            "px": world_p[0],
            "py": world_p[1],
            "pz": world_p[2],
            "rx": world_r[0],
            "ry": world_r[1],
            "rz": world_r[2],
            "rw": world_r[3],
        }
    except Exception:  # noqa: BLE001
        return None


def pose(pid):
    """A slot entry in the shape the downstream builder expects, or an explicit failure."""
    r = transform_local(pid)
    if r is None:
        return {"unresolved": pid}
    return {
        "x": round(r["px"], 6),
        "y": round(r["py"], 6),
        "z": round(r["pz"], 6),
        "rx": round(r["rx"], 6),
        "ry": round(r["ry"], 6),
        "rz": round(r["rz"], 6),
        "rw": round(r["rw"], 6),
    }


results = []
skipped = 0

for obj in env.objects:
    if obj.type.name != "MonoBehaviour" or obj.byte_size < 32:
        continue
    try:
        d = obj.read(check_read=False)
        script = d.m_Script.read()
        if getattr(script, "m_ClassName", "") != "SlotConfig":
            continue
    except Exception:  # noqa: BLE001
        continue

    raw = obj.get_raw_data()
    decoded = decode_slotconfig(raw)
    if decoded is None:
        skipped += 1
        continue
    arrays, consumed = decoded

    owner_name = "?"
    owner_path = None
    try:
        go = d.m_GameObject.read()
        owner_name = getattr(go, "m_Name", "?")
        owner_path = d.m_GameObject.m_PathID
    except Exception:  # noqa: BLE001
        pass

    entry = {
        "prefab": owner_name,
        "gameObjectPathId": owner_path,
        "slotConfigPathId": obj.path_id,
        "bytes": obj.byte_size,
        "decodedBytes": consumed,
        "slotPoses": [pose(pid) for _, pid in arrays["slotPoses"]],
        "insertPoses": [pose(pid) for _, pid in arrays["insertPoses"]],
        "addonAreaColCount": len(arrays["addonAreaCol"]),
        "addonAreaCenter": [list(v) for v in arrays["addonAreaCenter"]],
        "slotPoseCount": len(arrays["slotPoses"]),
        "insertPoseCount": len(arrays["insertPoses"]),
    }
    results.append(entry)

with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(results, fh, ensure_ascii=False, indent=1)

print(f"SlotConfig components extracted: {len(results)}  (skipped {skipped})")
print(f"wrote {out_path}")
print()
print("=== prefabs with slots ===")
for e in sorted(results, key=lambda r: -r["slotPoseCount"])[:40]:
    resolved = sum(1 for s in e["slotPoses"] if "unresolved" not in s)
    print(
        f"  {e['prefab']:<28} slotPoses={e['slotPoseCount']:>3} (resolved {resolved:>3})  "
        f"insertPoses={e['insertPoseCount']:>3}  bytes={e['bytes']}->{e['decodedBytes']}"
    )
