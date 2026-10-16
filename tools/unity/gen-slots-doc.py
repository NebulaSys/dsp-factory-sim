"""Generate docs/BUILDING-SLOTS.md from the extracted SlotConfig data.

    python tools/unity/gen-slots-doc.py docs/research/_raw/slotconfig.json docs/BUILDING-SLOTS.md
"""

import json
import sys
from collections import defaultdict

src, out = sys.argv[1], sys.argv[2]
data = json.load(open(src, encoding="utf-8"))

by_prefab = defaultdict(list)
for e in data:
    by_prefab[e["prefab"]].append(e)

# Prefab name -> dataset building key, where the name is unambiguous.
PREFAB_TO_KEY = {
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
    "logistic-station": "PlanetaryLogisticsStation",
    "interstellar-logistic-station": "InterstellarLogisticsStation",
    "energy-exchanger": "EnergyExchanger",
    "accumulator": "Accumulator",
    "ray-receiver": "RayReceiver",
    "em-rail-ejector": "EMRailEjector",
    "fusion-reactor": "ArtificialStar",
    "piler": "AutomaticPiler",
    "splitter-a": "Splitter",
    "splitter-b": "Splitter",
    "splitter-c": "Splitter",
    "storage-tank": "StorageTank",
    "orbital-collector": "OrbitalCollector",
    "spray-coater": "SprayCoater",
    "monitor": "TrafficMonitor",
}

try:
    dataset = json.load(open("src/engine/data/dsp-vanilla.json", encoding="utf-8"))
    declared = {b["key"]: b.get("sorterAttachSlots") for b in dataset["buildings"]}
except Exception:  # noqa: BLE001
    declared = {}

rows = []
for prefab, entries in by_prefab.items():
    if prefab.startswith("space-unit-") or prefab.startswith("warship"):
        continue  # enemy units, not buildings
    e = entries[0]
    key = PREFAB_TO_KEY.get(prefab)
    rows.append(
        {
            "prefab": prefab,
            "instances": len(entries),
            "slot": e["slotPoseCount"],
            "insert": e["insertPoseCount"],
            "key": key,
            "declared": declared.get(key) if key else None,
            "poses": e["insertPoses"] if e["insertPoseCount"] else e["slotPoses"],
            "which": "insertPoses" if e["insertPoseCount"] else "slotPoses",
        }
    )

rows.sort(key=lambda r: (-(r["slot"] + r["insert"]), r["prefab"]))

# Cross-check: does the extracted count equal the dataset's sorterAttachSlots?
checked = [r for r in rows if r["declared"] is not None and (r["slot"] or r["insert"])]
agree = [r for r in checked if (r["slot"] or r["insert"]) == r["declared"]]
mismatch = [r for r in checked if (r["slot"] or r["insert"]) != r["declared"]]

lines = []
w = lines.append

w("# 建筑连接槽位：从游戏资源中提取的权威坐标")
w("")
w("> 数据：`docs/research/_raw/slotconfig.json`（本文件由 `tools/unity/gen-slots-doc.py` 生成）")
w("> 来源：`DSPGAME_Data/resources.assets`，Unity 2022.3.62f3c1，序列化版本 22")
w("")
w("**这一轮拿到了坐标。** 见 [UNITY-ASSETS.md](UNITY-ASSETS.md) 的记录：这个构建剥离了 type tree，")
w("所以 MonoBehaviour 不能按常规方式读取；本文件的数据是用 `Assembly-CSharp.dll` 里的字段定义")
w("手工解码出来的。")
w("")
w("---")
w("")
w("## 一、槽位数据在哪、为什么以前拿不到")
w("")
w("`SlotConfig`（Assembly-CSharp.dll 类型 `0x0200012b`）持有四个数组：")
w("")
w("| 字段 | 类型 | 含义 |")
w("|---|---|---|")
w("| `slotPoses` | `Transform[]` | 可连接点（物流站、分流器、储液罐…） |")
w("| `insertPoses` | `Transform[]` | 可插入点（制造台、熔炉、研究站、储物仓…） |")
w("| `addonAreaCol` | `Transform[]` | 附加区域碰撞体 |")
w("| `addonAreaCenter` | `Vector3[]` | 附加区域中心 |")
w("")
w("**关键：它们是 `Transform` 引用，不是 `Vector3`。** 这正好解释了 wiki 的")
w("`insertPoses`/`slotPoses` 为什么「长度正确、每个元素都是空对象 `{}`」——对象引用没法序列化成")
w("JSON。顺着引用走到 Transform 才能拿到 `m_LocalPosition`，也就是真正的槽位坐标。")
w("")
w("### 记录的字节布局（对照实际对象核实过，不是推测）")
w("")
w("```")
w("+0    m_GameObject                     PPtr (12)")
w("+12   m_Script                         PPtr (12)")
w("+24   m_Name + m_EditorClassIdentifier (两个空串, 4+4)")
w("+32   Vector3 selectCenter             (12)")
w("+44   Vector3 selectSize               (12)")
w("+56   float selectDistance, selectAlpha, signHeight, signSize,")
w("      overrideBarWidth, overrideBarHeight            (6×4)")
w("+80   int slotPoses.Length        → Length × PPtr(12)")
w("      int insertPoses.Length      → Length × PPtr(12)")
w("      int addonAreaCol.Length     → Length × PPtr(12)")
w("      int addonAreaCenter.Length  → Length × Vector3(12)")
w("```")
w("")
w("`fusion-reactor` 解出 144 字节、`space-unit-lancer` 解出 180 字节，**与记录的对象大小完全相等**，")
w("没有任何富余；245 个对象全部如此。")
w("")
w("---")
w("")
w("## 二、一条重要的结构发现：槽位不能只靠坐标区分")
w("")
w("`ArcSmelter` 有 **12 个槽位，但只有 8 个不同位置**——四条边各 3 个，而四个角各被两个槽位共用，")
w("分别从相邻的两条边接入。两个共用同一坐标的槽位**旋转相差 90°**：")
w("")
w("```")
w("  [ 0] (-1, 1)  rot=[0.00431, 0,        0,       0.99999]   ← 同一条边")
w("  [ 1] ( 0, 1)  rot=[0.00431, 0,        0,       0.99999]")
w("  [ 2] ( 1, 1)  rot=[0.00431, 0,        0,       0.99999]")
w("  [ 3] ( 1, 1)  rot=[0.00305, 0.7071, -0.00305, 0.7071 ]   ← 同一坐标，转了 90°")
w("```")
w("")
w("所以 **`(位置, 旋转)` 这一对才唯一确定一个槽位**；只比坐标会让 12 个槽位塌缩成 8 个。")
w("这条已写成回归测试（`test/slot-geometry.test.ts`）。")
w("")
w("---")
w("")
w("## 三、交叉验证")
w("")
w(f"- 提取到 **{len(data)}** 个 `SlotConfig` 组件，**{len(by_prefab)}** 个不同 prefab。")
w("- **同一 prefab 的重复实例之间 0 处分歧**——提取是确定性的，不是碰巧。")
w("- 与数据集里已有的 `sorterAttachSlots` 对照（按 prefab 名可确定的建筑）：")
w("")
w(f"  **{len(agree)} 个吻合，{len(mismatch)} 个不符。**")
w("")
if mismatch:
    w("  | prefab | 提取 | 数据集声明 |")
    w("  |---|---:|---:|")
    for r in mismatch:
        w(f"  | `{r['prefab']}` | {r['slot'] or r['insert']} | {r['declared']} |")
    w("")
else:
    w("  也就是说，这份独立来源的数据与数据集完全对得上。")
w("")
w("---")
w("")
w("## 四、prefab → 槽位数")
w("")
w("| prefab | 建筑 | 数组 | 槽位数 | 数据集声明 |")
w("|---|---|---|---:|---:|")
for r in rows:
    if not (r["slot"] or r["insert"]):
        continue
    w(f"| `{r['prefab']}` | {r['key'] or '—'} | `{r['which']}` | **{r['slot'] or r['insert']}** | {r['declared'] if r['declared'] is not None else '—'} |")
w("")
w("以下 prefab 提取到 **0** 个槽位（传送带、分拣器、发电与防御塔等，符合预期）：")
w("")
zero = [r["prefab"] for r in rows if not (r["slot"] or r["insert"])]
w(", ".join(f"`{p}`" for p in sorted(zero)))
w("")
w("---")
w("")
w("## 五、完整坐标")
w("")
w("局部坐标，单位是格（1 格 = 1 米），原点在该 prefab 的根。`rot` 是槽位的朝向四元数，")
w("表示分拣器从这里伸出的方向。")
w("")
for r in rows:
    n = r["slot"] or r["insert"]
    if not n:
        continue
    w(f"### `{r['prefab']}`{'（' + r['key'] + '）' if r['key'] else ''} — {n} 个槽位，来自 `{r['which']}`")
    w("")
    w("| # | x | y | z | rot |")
    w("|---:|---:|---:|---:|---|")
    for i, p in enumerate(r["poses"]):
        if "unresolved" in p:
            w(f"| {i} | — | — | — | 未解析 |")
        else:
            w(f"| {i} | {p['x']:.4f} | {p['y']:.4f} | {p['z']:.4f} | ({p['rx']:.3f}, {p['ry']:.3f}, {p['rz']:.3f}, {p['rw']:.3f}) |")
    w("")

w("---")
w("")
w("## 六、标定尝试：**失败**，坐标不能当作分拣器挂点")
w("")
w("> 这一节是负面结果，请先读它再使用第三、四节的数据。")
w("")
w("从 28 个真实蓝本取出 **40622 组**（建筑，分拣器手臂端点）配对，把端点按建筑 yaw 旋回本地坐标，")
w("再与槽位坐标比对；遍历 4 种轴向/旋转约定，每种做 ±1.0 格平移搜索。")
w("")
w("| 指标 | 结果 |")
w("|---|---|")
w("| 未标定落在 0.05 格内 | 0.1% |")
w("| 未标定落在 0.25 格内 | 10.3% |")
w("| 未标定中位距离 | 1.015 格 |")
w("| 全局最优平移 | dx=0.16 dy=0.00，命中 **4.8%** |")
w("| 各建筑分别最优 | 最高 50%，其余 10–30%，dx 从 −1.00 到 +1.00 都有 |")
w("")
w("**结论：`slotPoses` / `insertPoses` 里的 `Transform` 位置不是分拣器的挂点位置。**")
w("它们可能是模型上的接口标记或指示箭头。**在弄清真实含义前，这些坐标不应被当作挂点使用。**")
w("")
w("### 又排除了一个假设：不是旋转约定的问题")
w("")
w("数字上有个很像的信号：`ThermalPowerPlant` 单类型能到 14.4%，而它的 yaw 是 0/90/180/270 均分，")
w("四分之一恰好是 yaw=0——这正是「平移对了、旋转错了」的特征。所以按 yaw 分桶分别拟合：")
w("")
w("| yaw | 样本 | 最优平移 | 命中率 |")
w("|---:|---:|---|---:|")
w("| 0 | 11712 | dx=-3.00 dy=-0.05 | **18.9%** |")
w("| 90 | 17632 | dx=-0.90 dy=-2.00 | 9.5% |")
w("| 180 | 5671 | dx=-0.25 dy=1.00 | 9.1% |")
w("| 270 | 5607 | dx=1.00 dy=0.25 | 8.3% |")
w("")
w("**yaw=0 也只有 18.9%**，而且最优 dx=-3.00 是搜索边界值，属于网格上的偶然对齐。")
w("四个桶的最优平移互不一致，所以**旋转约定不是原因**——这个假设被否掉了。")
w("")
w("（一条留作线索但没有被证实的观察：`ThermalPowerPlant` 的槽位在 x 上是 −2.12 与 +0.87，")
w("关于 **x = −0.625** 对称而不是关于 0 对称，暗示 prefab 根可能不在建筑中心。")
w("但按宿主逐一的平移搜索只有 14.4%，没能证实这一点，所以不作为结论。）")
w("")
w("因此模拟器目前**只用数组长度**（与独立的 `sorterAttachSlots` 完全吻合，21/21），**没有使用坐标**。")
w("`building-slots.json` 的 `_coordinates` 字段里写明了这个警告。")
w("")
w("**下一步应读代码而不是继续拟合**：查谁读 `SlotConfig.slotPoses`（token `0x04000995`）与")
w("`insertPoses`（`0x04000996`），即可确定坐标系与用途。")
w("")
w("### 查过一次，但查询范围选错了（记下来免得重走）")
w("")
w("`field_accesses` 共 2161 条，头部 400 条与尾部 200 条（1961–2161，已到末尾）都看过：")
w("")
w("| 范围 | 内容 |")
w("|---|---|")
w("| 0–400 | `SlotConfig..ctor`（6 条）、`PrefabDesc..ctor`×3、`PrefabDesc.Free`、`PrefabDesc.ReadPrefab` |")
w("| 1961–2161 | `ItemProto.GetPropValue`、`ItemProto..cctor` |")
w("")
w("**这 2161 条里没有任何一条读 `slotPoses` 或 `insertPoses`。**")
w("")
w("**原因是对集合范围的理解错了**：REA 明确写了 `field_accesses` **只覆盖被选中的声明类型**")
w("（我选的是 `SlotConfig` / `PrefabDesc` / `ItemProto`），也就是只包含**这三个类型自己的方法体里**")
w("访问的字段。`SlotConfig` 自己的方法只有构造函数，而构造函数不碰那四个数组——")
w("**真正的读取者在别的类型里，从一开始就不可能出现在这 2161 条中。**")
w("")
w("所以「一页页翻到消费方」是**方向性错误**，不是没翻到。")
w("下一步应改成：选一个**猜测的消费方类型**再查它的 `field_accesses`，或者用不带 `type_names`")
w("的全类型查询。`SlotConfig` 的值会被拷进 `PrefabDesc`，所以先看 `PrefabDesc` 是否自带")
w("`slotPoses`/`insertPoses` 字段、以及谁读它们，是值得的第一步。")
w("")
w("---")
w("")
w("## 七、其它限制")
w("")
w("1. **prefab → 物品 id 的映射有一部分是手写的**，但 21 个已声明 `sorterAttachSlots` 的建筑**全部吻合**。")
w("2. **splitter 的三个 prefab 布局不同**（`splitter-b`/`c` 的槽位在 y=1.333 高度，是堆叠变体）。")
w("   蓝图只记录 `itemId`，无法判断变体，所以两个变体都保留在 `variants` 里。")
w("3. **敌人单位已排除**（`space-unit-*`、`warship-*`）。")
w("4. 提取只扫了 `resources.assets`；`sharedassets0` / `level0` / `globalgamemanagers.assets`")
w("   里各 0 个 `SlotConfig`，这是查过的。")

with open(out, "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines) + "\n")

print(f"wrote {out}  ({len(lines)} lines)")
print(f"prefabs with slots: {sum(1 for r in rows if r['slot'] or r['insert'])}")
print(f"cross-check: {len(agree)} agree, {len(mismatch)} mismatch")
for r in checked:
    print(f"  {r['prefab']:<32} extracted={r['slot'] or r['insert']:<3} declared={r['declared']}")
