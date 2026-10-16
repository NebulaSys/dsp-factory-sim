/**
 * Generate `docs/BUILDING-CONNECTIONS.md`.
 *
 * The per-building table is emitted from the dataset rather than typed by hand, so the document
 * cannot drift from the data it describes. The prose records what was verified, what was
 * measured, and — explicitly — what could not be established.
 *
 *   node --experimental-strip-types tools/gen-building-doc.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')),
);
const meta = (JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')) as {
  meta: { version: string };
}).meta;

const CATEGORY_ZH: Record<string, string> = {
  belt: '物流',
  sorter: '物流',
  producer: '生产',
  research: '科研',
  power: '电力',
  logistics: '物流',
  storage: '仓储',
  mining: '采集',
  other: '其它',
};

/** Buildings that can take a sorter at all, ordered by how many. */
const withSlots = data.buildings
  .filter((b) => typeof b.sorterAttachSlots === 'number')
  .sort((a, b) => (b.sorterAttachSlots ?? 0) - (a.sorterAttachSlots ?? 0));

const rows: string[] = [];
for (const b of data.buildings) {
  const fp = b.footprint ? `${b.footprint.w}×${b.footprint.h}` : '—';
  const slots = b.sorterAttachSlots ?? '—';
  const item = typeof b.slots === 'number' ? String(b.slots) : '—';
  const speed =
    b.beltSpeedPerMin !== undefined
      ? `${b.beltSpeedPerMin}/min`
      : b.sorterSpeedPerSec !== undefined
        ? `${b.sorterSpeedPerSec}/s`
        : b.workSpeed !== undefined
          ? `×${b.workSpeed}`
          : '—';
  const power = b.powerConsumptionKW !== undefined ? `${b.powerConsumptionKW} kW` : '—';
  rows.push(
    `| ${b.id} | \`${b.key}\` | ${b.nameZh ?? b.name} | ${CATEGORY_ZH[b.category] ?? b.category} | ${fp} | ${item} | **${slots}** | ${speed} | ${power} |`,
  );
}

const doc = `# 建筑连接点：逐建筑清单与逆向结论

> 数据集 **${meta.version}**（${data.buildings.length} 建筑 / ${data.items.length} 物品 / ${data.recipes.length} 配方）
> 游戏程序集：\`Assembly-CSharp.dll\`，SHA-256 \`ef314425dade51f529f184f07be136cd3c2660a6a81515603c7226fbe7ab1d8c\`，MVID \`4da04a9a-1afb-4478-934f-c1a2256c5347\`
>
> **本轮没有改动模拟器代码。** 新增的只是 \`tools/\` 下的分析脚本。

---

> **本文件记录的是第一轮（只读程序集）的结论。** 后续两轮的进展见
> [BUILDING-SLOTS.md](BUILDING-SLOTS.md) 与 [UNITY-ASSETS.md](UNITY-ASSETS.md)：
> 槽位数据**已经从游戏资源里提取出来了**（33 个建筑），但**坐标的标定失败了**。
> 下面第五、六节的「失败」记录仍然有效，是那次尝试的一手材料。

---

## 一、结论速览

| 问题 | 结论 | 依据 |
|---|---|---|
| 每个建筑能不能挂分拣器、能挂几个 | **已知**，并已由游戏资源独立复核（21/21 吻合） | 数据集 \`sorterAttachSlots\` + [BUILDING-SLOTS.md](BUILDING-SLOTS.md) |
| 这些挂点**具体在哪个位置** | **坐标已取出，但标定失败**——见 [BUILDING-SLOTS.md](BUILDING-SLOTS.md) §6 | 见第五、六节：几何推导失败，且链接字段不指向相邻物体 |
| 分拣器两端分别在哪里 | **已解出** | \`(x,y,z)\` 与 \`(x2,y2,z2)\` 就是两个臂端，实测 1–3 格 |
| 蓝图记录里各字段的权威含义与顺序 | **已解出** | \`Export\`/\`Import\` 的 IL 逐条对应（第三节） |
| \`outputObj\`/\`inputObj\` 指什么 | **已解出**：所连物体的 \`index\`，但**通常不是相邻的那个物体** | 第四节 |

---

## 二、逐建筑清单

\`分拣器位\` = 该建筑可挂分拣器的位置数（\`sorterAttachSlots\`）；\`物品槽\` = \`slots\`。
两者含义不同，不要混用：\`slots\` 是配方/库存槽，\`sorterAttachSlots\` 才是可连接分拣器的位置数。

**共 ${withSlots.length} / ${data.buildings.length} 个建筑有可挂分拣器的位置。** 其余建筑（传送带、分拣器本身、
发电/防御塔、物流站等）在数据里**没有这一项**——注意这**不等于 0**，而是「未采集到」，见第六节。

| ID | key | 名称 | 类别 | 占格 | 物品槽 | 分拣器位 | 速率 | 耗电 |
|---:|---|---|---|---|---:|---:|---|---:|
${rows.join('\n')}

---

## 三、蓝图建筑记录的权威字段（来自游戏，非推测）

\`BlueprintBuilding\` 共 30 个字段。**序列化顺序不等于字段声明顺序**——它由
\`BlueprintBuilding.Export\` / \`Import\` 的 IL 决定。下表逐条对应 IL 里的
\`ldfld\`/\`stfld\` 与读写方法，是本轮最硬的一条结果。

| 顺序 | 字段 | 类型 | 磁盘宽度 | 读取方法 |
|---:|---|---|---:|---|
| — | *记录前缀：版本判别符* | i32 | 4 | \`ReadInt32\` |
| 1 | \`index\` | i32 | 4 | \`ReadInt32\` |
| 2 | \`itemId\` | i16 | 2 | \`ReadInt16\` |
| 3 | \`modelIndex\` | i16 | 2 | \`ReadInt16\` |
| 4 | \`areaIndex\` | i8 | 1 | \`ReadSByte\` |
| 5–7 | \`localOffset_x/y/z\` | f32×3 | 12 | \`ReadSingle\` |
| 8 | \`yaw\` | f32 | 4 | \`ReadSingle\` |
| 9 | *(2000,2010) 传送带：\`tilt\`* | f32 | 4 | \`ReadSingle\` |
| 9 | *(2010,2020) 分拣器：\`tilt,pitch,x2,y2,z2,yaw2,tilt2,pitch2\`* | f32×8 | 32 | \`ReadSingle\` |
| 10 | \`outputObj\` → 序列化为目标 \`index\` | i32 | 4 | \`ReadInt32\` |
| 11 | \`inputObj\` → 序列化为目标 \`index\` | i32 | 4 | \`ReadInt32\` |
| 12–17 | \`outputToSlot, inputFromSlot, outputFromSlot, inputToSlot, outputOffset, inputOffset\` | i8×6 | 6 | \`ReadSByte\` |
| 18 | \`recipeId\` | i16 | 2 | \`ReadInt16\` |
| 19 | \`filterId\` | i16 | 2 | \`ReadInt16\` |
| 20 | *参数个数* | i16 | 2 | \`ReadInt16\` |
| 21 | \`parameters[]\` | i32×n | 4n | \`ReadInt32\` |
| 22 | \`content\` | string | 变长 | \`ReadString\` |

要点：

- **\`outputObj\` / \`inputObj\` 是运行时对象引用（\`class:2088\`），不进磁盘**。磁盘上写的是
  \`outputObj != null ? outputObj.index : -1\`。所以 \`-1\` 才是「无」，不是 \`0\`。
- 非传送带/非分拣器的固定部分 = **45 字节**；加上记录前缀的版本 i32 = 49 字节，与本项目
  codec 的 \`49 + 4n + 4\` 一致（尾部 4 字节在游戏侧是 \`content\` 字符串的编码，二者宽度
  在实测数据里等价，因为 \`content\` 恒为空）。
- 三个版本分支的判别符是 **−102 / −101 / −100**，\`Import\` 用三次 \`bgt\` 依次分流。
- 本项目 codec 的 \`path102\` 读取顺序与上表**逐字段吻合**——这是对既有逆向的独立确认。

---

## 四、连接字段指向什么（含一条重要的否定结论）

用 v2 蓝本 \`factory-v2.txt\`（2971 建筑 / 1195 分拣器）实测：

- \`outputObj\` 的取值域是 \`[-1, 2970]\`，\`index === 数组下标\` 对全部 2971 个建筑成立，
  所以查表方式本身没错。
- **但被引用的物体通常不在几何上相邻**：
  - 只按 \`(x,y)\` 算距离：p50 = 5.15 格，p90 = 175 格，max = 295 格；
  - 限制在同一 area 并检查「是否落在 3 格内的邻居里」：**2390 个引用里 0 个命中**；
  - 4 个分拣器（#578–#581）同时把 \`outputObj\` 指向同一条传送带 #2969。

**结论**：这些引用指的是**逻辑上的那条带/那条线**，不是分拣器实际接触的那一格。因此
**无法用它们反推槽位号**。原本指望的「槽位号 + 几何 = 槽位坐标」这条路走不通。

---

## 五、分拣器两端：本轮真正解出来的东西

分拣器记录里除了 \`(x,y,z)\` 还有次锚点 \`(x2,y2,z2)\`，而 \`Export\` 对分拣器会完整写出这 8 个浮点。
**实测这两个锚点就是分拣器手臂的两个端点。**

在 **30 个蓝本 / 4427 个分拣器**上统计两点间距：

| 间距 | 数量 | 占比 |
|---:|---:|---:|
| 1 格 | 287 | 6.5% |
| 2 格 | 1981 | 44.7% |
| 3 格 | 2153 | 48.6% |
| 4–5 格 | 2 | 0.05% |
| >5 格 | 4 | 0.09% |

即 **99.8% 落在 1–3 格**，正是分拣器的物理跨度。按型号：

| 型号 | 样本 | 中位跨度 |
|---|---:|---:|
| 分拣器 Mk.I | 2234 | 3.000 |
| 分拣器 Mk.II | 192 | 1.000 |
| 分拣器 Mk.III | 1957 | 1.272 |
| 集装分拣器 | 44 | 1.000 |

**这条结论本身是可用的**：现在每个分拣器都有确切的两个端点，而不是只有一个位置。

---

## 六、尝试过但**失败**的：从几何反推挂点位置

思路：分拣器某一端落在建筑上 → 该端相对建筑中心、并按建筑 yaw 旋回本地坐标 → 就是该建筑的
一个挂点位置。用全部 30 个蓝本做下来：

| 指标 | 结果 |
|---|---|
| 分拣器端点下方找不到任何建筑 | 1790 / 8854 个端点 |
| 能推导出挂点的建筑类型 | **仅 13 种** |
| 推导出的不同挂点位置数 | 269（yaw 符号取 +1）/ 270（取 −1） |
| 其中观测次数 ≥ 10 的 | **48** / 49 |

**两个 yaw 旋转方向给出的结果几乎相同**（269 vs 270），所以问题不在旋转约定上；是数据本身
没有塌缩成离散的槽位。可能的原因，按可疑程度排序：

1. **分拣器的锚点不在接触点上**。手臂 1–3 格，锚点是臂自身的原点，接触点在其一端或中部；
   对同一个槽位，锚点会随进入方向漂移。
2. **一个「挂点」可能对应多个格子**。大型建筑（如 6 格宽的火力发电厂）边界上有许多格，
   而 \`sorterAttachSlots\` 只有 5——所以「挂点位置」要么不是逐格枚举，要么我把它理解错了。
3. **\`sorterAttachSlots\` 的口径未经验证**。它来自 wiki 的 protosets 导出，我没有在游戏侧
   核对过它到底数的是什么（可挂分拣器的位置？还是别的）。

**因此本文件不给挂点坐标**。给一份 269 个噪声位置的表，比不给更糟。

---

## 七、坐标的来源（本节的建议后来被采纳，结论见 BUILDING-SLOTS.md）

按可行性排序，当时列出了三条路：

1. **Unity 资源里的 prefab 数据** —— **这条路走通了**。做法与结果见
   [UNITY-ASSETS.md](UNITY-ASSETS.md) 与 [BUILDING-SLOTS.md](BUILDING-SLOTS.md)：
   数据在 \`resources.assets\` 的 \`SlotConfig\` 组件里，字段是 \`Transform[]\` 而不是 \`Vector3[]\`。
   33 个建筑的坐标已提取，**21/21 个数量与数据集吻合**。
2. **Wiki 的 \`insertPoses\` / \`slotPoses\`** —— 元素为空对象 \`{}\` 的原因现在也清楚了：
   **它们是对象引用，本来就没法序列化成 JSON**，不是 wiki 的导出工具丢了内容。
3. **运行时 dump** —— 未采用，不需要了。

**但「提取到坐标」不等于「坐标可用」**：把分拣器端点与这些坐标对齐的尝试失败了
（40622 组配对，四种轴向/旋转约定 + ±1.0 格平移搜索，全局最优 4.8%），
所以坐标**目前没有接入模拟器**，只有数量在用。详见 BUILDING-SLOTS.md §6。

---

## 八、本轮顺带发现的两处不一致（未修，仅记录）

1. **制造台占格**：数据集里 \`AssemblingMachineMk1\` 的 \`footprint\` 是 **4×4**，但蓝图视图的
   界面说明写的是「制造台 Mk.I 为 3×3」。两者矛盾，需确认哪个对。
2. **\`slots\` 与 \`sorterAttachSlots\` 都是数字**，但早期代码里曾把它们当数组用过
   （\`x.slots.length\` 恒为 \`undefined\`，判断会静默失效）。列在表里是为了后续不要再混。

---

## 九、复现方式

\`\`\`bash
# 分拣器两端跨度（全语料）
node --experimental-strip-types tools/probe-sorter-ends.ts --corpus

# 连接字段语义验证（几何相邻性）
node --experimental-strip-types tools/validate-connections.ts factory-v2.txt
node --experimental-strip-types tools/adjacency-check.ts factory-v2.txt

# 挂点几何推导（本文件第六节的失败实验）
node --experimental-strip-types tools/derive-attach-points.ts

# 重新生成本文件
node --experimental-strip-types tools/gen-building-doc.ts
\`\`\`
`;

writeFileSync(resolve(ROOT, 'docs/BUILDING-CONNECTIONS.md'), doc);
console.log(`wrote docs/BUILDING-CONNECTIONS.md  (${doc.length} chars, ${rows.length} building rows)`);
console.log(`buildings with sorterAttachSlots: ${withSlots.length} / ${data.buildings.length}`);
