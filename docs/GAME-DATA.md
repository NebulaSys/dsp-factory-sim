# 游戏数值与公式（可复核清单）

模拟器的每一条公式、每一个常数都应当能追溯到下面列出的来源。本文件是**数据契约**：`src/engine/data/dsp-vanilla.json` 由 [`tools/build-dataset.mjs`](../tools/build-dataset.mjs) 从 `docs/research/*.json` 生成，并由三道校验把守：

| 校验 | 命令 | 当前状态 |
|---|---|---|
| 数据集结构与引用完整性 | `node --experimental-strip-types tools/validate-dataset.ts` | PASS |
| 原型 id 对齐 wiki 权威表 | `node tools/verify-ids.mjs src/engine/data/dsp-vanilla.json` | PASS（175 物品 + 189 配方，0 处 id 不一致） |
| 引擎行为（真实数据） | `pnpm test` → `test/dataset.test.ts` | 89 项测试全绿 |

目标游戏版本：**0.10.35.29104**。

---

## 一、生产速率公式

```
craftsPerMinPerMachine = 60 / (craftTime / speedMultiplier)
speedMultiplier        = 机器 workSpeed × 科技加成 × 增产剂加速
outputsPerMin          = 产出数量 × craftsPerMinPerMachine × 增产剂额外产出
inputsPerMin           = 投料数量 × craftsPerMinPerMachine        （额外产出不影响投料）
power                  = 机器工作功率 × 台数 × 增产剂耗电惩罚
```

实现：[`src/engine/production.ts`](../src/engine/production.ts)

### 机器工作速度表（双源确认：prefabs `AssemblerDesc.speedf` + wiki 建筑页）

| 机器 | workSpeed | 工作功率 |
|---|---|---|
| 制造台 Mk.I | 0.75 | 270 kW |
| 制造台 Mk.II | 1.0 | 540 kW |
| 制造台 Mk.III | 1.5 | 1080 kW |
| 重组式制造台 | 3.0 | 2700 kW |
| 电弧熔炉 | 1.0 | 360 kW |
| 位面熔炉 | 2.0 | 1440 kW |
| 化工厂 | 1.0 | 720 kW |
| 量子化工厂 | 2.0 | 2160 kW |
| 原油精炼厂 | 1.0 | 960 kW |
| 微型粒子对撞机 | 1.0 | **12000 kW** |
| 矩阵研究站 | 1.0 | 480 kW |

> 对撞机的 12 MW 已按渲染后的 wiki 页面复核（`Work Consumption = 12.0 MW`、`Idle = 120 kW`）。早期手抄的 1.2 MW 是错的，这是「以游戏数据为准」而非「以记忆为准」的一个具体例子。

**配方必须由正确的机器承载**：`recipe.facility` 是权威字段。矩阵配方（如电磁矩阵，3 s）跑在矩阵研究站（1.0×）上是 20/min；若被错配到制造台 Mk.I（0.75×）会得到 15/min。`resolveMachine()` 按 `recipeFacility` 匹配，因此两者不会混淆，`test/engine.test.ts` 有对应断言。

---

## 二、增产剂（Proliferator）

来源：[Spray_Coater § Proliferator Bonuses](https://dsp-wiki.com/Spray_Coater) + [Proliferator](https://dsp-wiki.com/Proliferator)，并与 biligame 交叉。

| 等级 | 每次喷涂覆盖 | 自身喷涂后 | 额外产出 | 生产加速 | 耗电惩罚 |
|---|---|---|---|---|---|
| Mk.I | 12 | 13 | +12.5% | +25% | +30% |
| Mk.II | 24 | 28 | +20% | +50% | +70% |
| Mk.III | 60 | 75（EN wiki 记 72，见冲突） | +25% | +100% | +150% |

要点（引擎均已实现）：

- 两种模式**互斥**：额外产出乘在产出数量上，生产加速除在工序时间上；**投料不变**。
- 生产加速与机器自身速度**乘算**：Mk.III 加速让制造台 Mk.III 的 1.5× 变成 3×（wiki 原文举例）。
- **全部**原料都必须喷涂，且**取最低等级**；任一原料未喷涂则完全无加成（`effectiveMark`）。
- 耗电惩罚施加在**加工该物品的建筑**上。
- **不可额外产出**：反物质、反物质燃料棒、X 射线裂解，以及一切「以建筑为产物」的配方（如 Mk.II/Mk.III 传送带、分拣器、制造台）——这些只能加速。引擎会自动降级为加速模式并给出警告（`allowsExtraProducts`）。
- **不可喷涂**：采矿机 / 大型采矿机 / 抽水泵 / 原油萃取站 / 轨道采集器本体，以及发电建筑本体（只有燃料可喷涂）；分馏塔只吃加速。
- 喷涂机存储恒为 600 喷；集装堆整堆一次标记、按堆叠数消耗喷涂次数。

---

## 三、采集（Mining）

来源：[Mining Machine](https://dsp-wiki.com/Mining_Machine) + [Vein Utilization (Upgrade)](https://dsp-wiki.com/Vein_Utilization_(Upgrade))，并用 prefabs `MinerDesc.periodf` 复核（`60 / periodf` 恰好得到 30 / 60 / 50 / 油田速率，四点全中）。

```
产量/min = 每矿脉速率 × 覆盖矿脉数 × 采矿速度倍率
采矿速度倍率 = 1 + 0.10 × 矿脉利用等级
每件矿石消耗 = 0.94 ^ 矿脉利用等级
矿脉总可采量 = 初始储量 / 0.94 ^ 等级
```

| 采集建筑 | 每矿脉/井速率 |
|---|---|
| 采矿机 | 30 /min |
| 大型采矿机 | 60 /min |
| 抽水泵 | 50 /min（海水；也可抽硫酸） |
| 原油萃取站 | 油田显示速率 × 采矿速度倍率（储量衰减，12 h 半衰期） |
| 轨道采集器 | 巨星基础产率 × 8 × 采矿速度倍率（30 MW 维护从采集物中扣除） |

**注意一个「看似冲突」的点**：`VeinProtoSet.MiningTime` 逐矿不同（煤 30、石 45、铁 60、金伯利 90、单极磁石 120）。若矿机使用它，各矿速率就会不同；但英文 wiki、中英 ItemInfo、biligame 三处都明确写「所有矿脉一律 30/min」，且 `periodf` 复核也支持平坦值。结论：`MiningTime` 作用于手动采集/机甲采集，不影响矿机吞吐。**因此引擎采用平坦的 30/min。**

**升级键名的坑**：游戏数据里这条升级叫 `VeinUtilization`（单数），而 wiki 页面标题是 `Vein Utilization`、很多工具写成 `VeinsUtilization`。更麻烦的是游戏数据只记录了 `0.94^等级` 的**矿脉消耗**乘数，`+10%/级 采矿速度` 只写在 wiki 页面上。因此：

- `tools/build-dataset.mjs` 把它拆成 `effectsPerLevel: [miningSpeedMultiplier +0.10, veinConsumptionMultiplier 0.94]`；
- `src/engine/rules.ts` 的 `findUpgrade()` 支持键名别名与反查，避免改个拼写就把加成静默清零。

这两点都有测试：`test/dataset.test.ts` 断言等级 5 → 1.5×、45/min·矿脉、消耗 ×0.94⁵，并断言复数别名同样生效。

---

## 四、物流与电力

| 传送带 | 速率 |
|---|---|
| Mk.I | 6/s = 360/min |
| Mk.II | 12/s = 720/min |
| Mk.III | 30/s = 1800/min（自动集装机 4 层堆叠时 6000/min） |

| 分拣器 | 速率 | 耗电 |
|---|---|---|
| Mk.I | 1.5/s | 18 kW |
| Mk.II | 3/s | 36 kW |
| Mk.III | 6/s | 72 kW |

**已记录的未解冲突**：0.10.35 中「分拣器集装」升级链（protoset 4→8）已标记 `IsObsolete`，被「集装分拣器升级」（3311–3316）取代；wiki 的传输速率表（2..6 → 12..36 件/s）是针对已废弃链写的。本数据集采用 wiki 值，并把 0.10.x 的现行集装上限标为 UNCONFIRMED。见 `sorters[].cargoStackingWithUpgrade.conflict`。

电力按建筑工作功率累加；`powerReport()` 可换算成所需风机/火电/聚变/人造恒星台数。注意矿机有 420 kW 工作 / 24 kW 待机，对撞机 12 MW，轨道采集器 30 MW——早期蓝图的电力预算主要由这几项决定。

---

## 五、已登记的来源冲突（不隐藏）

数据集中保留了 `conflict` / `conflictNote` 字段，模拟器不做「悄悄取一个值」这种事：

| 项目 | 冲突 | 取值与理由 |
|---|---|---|
| 增产剂 Mk.III 自身喷涂 | biligame 75 ↔ EN wiki 72 | 取 75：额外产出公式 `floor(喷数 × (1+加成))` 同时复现 Mk.I=13、Mk.II=28 |
| 分拣器集装 | wiki 2..6 ↔ protoset 4..8 | 取 wiki；该链在 0.10.35 已废弃，现行值标 UNCONFIRMED |
| 矿脉速率 | 平坦 30/min ↔ `MiningTime` 逐矿不同 | 取平坦 30/min（三处文案 + `periodf` 复核） |
| 对撞机功率 | 手抄 1.2 MW ↔ 游戏数据 12 MW | 取 12 MW（渲染页复核） |
| 制造台 Mk.II/III 待机功率 | prefabs 18/24 kW ↔ wiki 15/18 kW | 取 prefabs |
| 科技消耗 | protoset（电磁学 磁线圈×30）↔ 两处 wiki（×10） | 两者都存，`costNote` 记录；hashes 三方一致 |
| 存储建筑名称 | Depot Mk.I/II（0.10.x 现行）↔ Storage Mk.I/II（旧名/wiki） | 取现行名 Depot，ID 页仍写 Storage |

---

## 六、数据来源

- [dsp-wiki.com](https://dsp-wiki.com/)：`Module:GameData/protosets.json`（游戏本体数据）、`Module:GameData/prefabs.json`（`AssemblerDesc.speedf`、`MinerDesc.periodf`、`BeltDesc`）
- [Modding:Items IDs](https://dsp-wiki.com/Modding:Items_IDs)、[Modding:Recipe IDs](https://dsp-wiki.com/Modding:Recipe_IDs)
- [Spray_Coater](https://dsp-wiki.com/Spray_Coater)、[Mining Machine](https://dsp-wiki.com/Mining_Machine)、[Vein Utilization (Upgrade)](https://dsp-wiki.com/Vein_Utilization_(Upgrade))
- [wiki.biligame.com/dsp](https://wiki.biligame.com/dsp/)（中文名与升级数值）
- 交叉源：[antian369/dsp-calc](https://github.com/antian369/dsp-calc)、`dspbp` 的 `enums.rs`、[DSPCalculator](https://dyson-calculator.com/)

### 连接槽位：来自游戏本体，不是 wiki

`BuildingDef.sorterAttachSlots`（可连接分拣器的位置数）与 `sorterSlotPoses`（坐标）**不来自 wiki**，
而是从游戏随包发布的 Unity 资源里提取的：

- 位置：`DSPGAME_Data/resources.assets` → `SlotConfig` 组件（`Assembly-CSharp.dll` 类型 `0x0200012b`）
- 字段：`slotPoses` / `insertPoses` / `addonAreaCol`（`Transform[]`）与 `addonAreaCenter`（`Vector3[]`）
- **它们不是 `Vector3` 而是 `Transform` 引用**——这正是 wiki 的 `protosets.json` 里
  「长度正确、每个元素都是空对象 `{}`」的原因：对象引用没法序列化成 JSON

覆盖 **33 个建筑**，其中**21 个**与数据集原有的 `sorterAttachSlots` 独立吻合（21/21，0 处不符）。
**模拟器目前只用数量，坐标未接入**（标定失败，原因见
[BUILDING-SLOTS.md](BUILDING-SLOTS.md) §6）。

提取与验证过程：[BUILDING-SLOTS.md](BUILDING-SLOTS.md)、[UNITY-ASSETS.md](UNITY-ASSETS.md)。

### 明确应降权/忽略的来源

- `@eurydos/dsp-item-registry`、cabmoomoo 的 `data.json`：存在已确认的错误（磁线圈投料、推进器产出、部分工时）
- antian369 与 DSPCalculator 的 `Vanilla.json` 是**同一个文件**（MD5 相同），不构成两个独立来源
- wiki 的 `Modding:Items IDs` / `Recipe IDs` 页面**已过时**：缺 1211（黑雾透镜）、缺配方 105 与 117–162。因此 `verify-ids.mjs` 报告 44 条「wiki 未收录」是**预期现象**，不判为失败（这些条目来自游戏数据本身）
- fandom wiki：403 且内容陈旧
