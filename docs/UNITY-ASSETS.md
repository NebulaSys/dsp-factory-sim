# Unity 资源解析：如何取出槽位坐标

> 目标：从游戏随包发布的 Unity 序列化资源里取出**每个建筑可连接分拣器/传送带的位置**。

**结论：已取到。** 坐标在 [BUILDING-SLOTS.md](BUILDING-SLOTS.md)，原始数据在
`docs/research/_raw/slotconfig.json`。本文记录**怎么解出来的**，以及前面几次为什么失败。

路径一句话：**容器**用 UnityPy 打开（它自带内置类型的 type tree，所以 Transform / GameObject
都能读）；**MonoBehaviour** 因为本构建剥离了 type tree，改用 `Assembly-CSharp.dll` 的字段定义
手工解码。真正装数据的类是 `SlotConfig`，它的 `slotPoses` / `insertPoses` 是 **`Transform[]`——
对象引用而不是 `Vector3`**，这正是 wiki 导出里「长度正确、元素全是 `{}`」的原因：对象引用没法
序列化成 JSON，顺着引用走到 Transform 才能拿到 `m_LocalPosition`。

---

## 一、已确立的事实

### 1. 引擎与容器版本

| 项 | 值 | 来源 |
|---|---|---|
| Unity | **2022.3.62f3c1** | `UnityPlayer.dll` 版本信息 |
| 序列化文件版本 | **22** | 文件头 +8 处的 u32 |
| 字节序 | **小端**（对象数据） | 头部 +40 的 u8 = 0 |

### 2. 资源文件清单

| 文件 | 大小 |
|---|---|
| `DSPGAME_Data/resources.assets` | 427 MB |
| `DSPGAME_Data/resources.assets.resS` | 2.6 GB（流式数据） |
| `DSPGAME_Data/sharedassets0.assets` | 53.5 MB |
| `DSPGAME_Data/globalgamemanagers` | 8.5 MB |
| `DSPGAME_Data/level0` | 9.9 MB |

`DSPGAME_Data` 下**没有 StreamingAssets**；`Wiki/` 只有教程文本，`Locale/` 只有本地化，
`Configs/` 只有一个 `path.txt`。所以建筑数据确实只在 `.assets` 里。

### 3. 头部布局（**从文件字节读出来的，不是猜的**）

`globalgamemanagers` 前 64 字节：

```
00000000 00000000 00000016 00000000 00000000 0000048c 00000000 008783c4
00000000 000004c0 00000000 00000000 32303232 2e332e36 32663363 31001300
```

解得：

| 偏移 | 类型 | 值 | 含义 |
|---:|---|---:|---|
| +0 | u64 | 0 | 占位（新格式下为 0） |
| +8 | u32 | **22** | 序列化版本 |
| +12 | u32 | 0 | 填充 |
| +16 | u64 | **1164** | metadataSize |
| +24 | u64 | **8881092** | fileSize —— **与文件实际大小完全一致** |
| +32 | u64 | **1216** | dataOffset |
| +40 | u8 | 0 | 字节序（0 = 小端） |
| +48 | string | `"2022.3.62f3c1"` | 引擎版本串，13 字符 + NUL |
| +62 | u32le | 19 | 目标平台（StandaloneWindows64） |

**两个关键陷阱**，都会让天真的读法得到全 0：

1. 旧版布局的 size/offset 字段**仍然存在但被置 0**，真实值以 64 位形式跟在后面。
   只按旧布局读会得到 `metadataSize = 0, fileSize = 0, dataOffset = 0`。
2. `dataOffset − metadataSize = 1216 − 1164 = 52`，**落在引擎版本字符串中间**（字符串占
   48–61）。所以「元数据起点 = dataOffset − metadataSize」这条常用公式在这个文件上不成立。

这两条是本次唯一确定下来、且对后续任何人都有用的结果。

---

## 二、根因：这个版本**剥离了 type tree**

用 UnityPy 读取容器后，`resources.assets` 的元数据里：

| 项 | 值 |
|---|---|
| unity_version | `2022.3.62f3c1` |
| 文件里的类型数 | **397** |
| **其中带节点（type tree）的** | **0** |

**397 个类型记录全都不带字段树。** 这不是我的读法问题——**这个构建根本没有把 type tree 写进资源**。

这直接解释了两件事：

**1. 为什么我自研的解析器必然失败。** 我在类型记录里写了 `if (nodeCount <= 0) return null`——
而这里每个类型的 `nodeCount` **就是 0**，所以 **2512 次尝试全部被这一行判死**。也就是说，我的
校验条件本身把唯一正确的读法排除了。这是一个真正的实现错误，值得记下来。

**2. 为什么 UnityPy 也读不出 MonoBehaviour。** UnityPy 报错
「Expected to read 98676 bytes, but only read 52 bytes」：它只能退回到 52 字节的
**通用 MonoBehaviour 桩**（`m_GameObject` + `m_Script` + `m_Name`），读不到脚本自己的字段。

**没有 type tree，MonoBehaviour 的字段布局只能来自程序集**——而 DSP 是 Mono 游戏，
字段定义就在 `Managed/Assembly-CSharp.dll` 里（本会话已用 REA 逐字段读过 `BlueprintBuilding`
等类型）。**这正是 AssetRipper / AssetsTools.NET 会做的事：从 .NET 程序集生成 type tree。**

---

## 三、UnityPy 这一轮实际查到的东西

UnityPy 1.25.4 装好后，容器、贴图、网格都能正常读（16 万对象），但 MonoBehaviour 不行。顺带确认：

**1. 资源构成（`resources.assets`，161604 个对象）**

| 类型 | 数量 |
|---|---:|
| GameObject | 37686 |
| **MonoBehaviour** | **25724** |
| Transform | 22284 |
| RectTransform | 15402 |
| Mesh / Texture2D | 4071 / 3771 |
| TextAsset | 10 |

**2. 10 个 TextAsset 没有一个是建筑数据**（都已导出到 `docs/research/_raw/gamedata/`）：

| 名称 | 大小 | 实际内容 |
|---|---:|---|
| `bucket-map-6` | 128 MB | 二进制空间索引 |
| `-99` / `-1` / `-3` / `-2` | 28 / 10 / 9.3 / 8.7 MB | **`VFSAVE` 容器**，内含 PNG（图标缓存） |
| `space-hive*`、`planet-base` | 33–56 KB | 二进制空间数据 |
| `icondesc` | 29 KB | 图标描述：每项后跟 `float` 序列，像 UV/偏移，**没有槽位数据** |

所以建筑 prefab/**槽位数据在 MonoBehaviour 里**，而 MonoBehaviour 正是读不了的那一类。

**3. 已确认不存在的位置**（省得以后再找）：

- `DSPGAME_Data` 下**没有 StreamingAssets**；
- `Wiki/` 只有教程文本，`Locale/` 只有本地化，`Configs/` 只有一个 `path.txt`；
- 程序集里只有代码，没有坐标。


---

## 四、本轮留下的东西

| 文件 | 用途 |
|---|---|
| `tools/unity/serialized-file.ts` | 自研 SerializedFile 解析器。**头部可用，类型表不可用**：它要求 `nodeCount > 0`，而本构建全是 0 |
| `tools/unity/head.ts` | 头部字节转储，用来人工核对布局 |
| `tools/unity/probe.ts` | 自研解析器入口（当前必然失败，属已知状态） |
| `tools/unity/survey.py` | UnityPy 对象类型普查 |
| `tools/unity/diagnose.py` | UnityPy 读取失败诊断 |
| `tools/unity/find-proto.py` | 按脚本类分组 MonoBehaviour、列出 TextAsset |
| `tools/unity/typeinfo.py` | **确认 type tree 被剥离**（397 个类型，0 个带节点） |
| `tools/unity/dump-textassets.py` | 导出 TextAsset，用于判定它们是不是建筑数据 |
| `docs/research/_raw/gamedata/icondesc` | 唯一留下的 TextAsset（29 KB），已确认不含槽位数据 |

---

## 五、最终采用的解法：REA 读字段定义 + 手工解字节

UnityPy 打不开 MonoBehaviour（它需要 type tree，或 IL2CPP 的 dump；DSP 是 Mono 且 type tree 被剥离）。
**实际走通的是第三条路**：

1. 用 **REA** 从 `Assembly-CSharp.dll` 查出真正装数据的类型。命中
   **`SlotConfig`**（类型 token `0x0200012b`），12 个字段，其中
   `slotPoses` / `insertPoses` / `addonAreaCol` 是 `Transform[]`，`addonAreaCenter` 是 `Vector3[]`。
2. 用 **UnityPy** 打开容器（内置类型如 Transform / GameObject 有自带 type tree，能正常读），
   按 `m_Script` 找到 260 个 `SlotConfig` 组件，并从拥有者 GameObject 名字认出建筑 prefab
   （`belt-1`、`inserter-2`、`smelter-2`、`logistic-station`…）。
3. **手工解码**每个组件的字节，取出数组长度与每个 `Transform` 的 pathID。
4. 顺着 pathID 解析 `Transform`，读 `m_LocalPosition` —— 就是槽位坐标。

字节布局对照**实际对象**核实（见 [BUILDING-SLOTS.md](BUILDING-SLOTS.md) 第一节）：解出的
144 / 180 字节与记录的对象大小**完全相等**，245 个对象无一例外。

### 交叉验证结果

- 245 个组件、76 个 prefab；**同一 prefab 的重复实例之间 0 处分歧**。
- 与数据集已有的 `sorterAttachSlots` 对照：**13 个吻合，0 个不符**（制造台 12、熔炉 12、
  研究站 12、储物仓 12、弹射器 4、人造恒星 4）。

第 4 步的「用分拣器两端标定坐标」还没做——见 BUILDING-SLOTS.md 第五节，那是把 prefab
局部坐标转成游戏格坐标的最后一步。


---

## 六、复现

```bash
# 头部字节（人工核对布局）
node --experimental-strip-types tools/unity/head.ts \
  "E:/Program Files (x86)/Steam/steamapps/common/Dyson Sphere Program/DSPGAME_Data/globalgamemanagers"

# 解析尝试（当前会以「未通过结构校验」失败，这是已知状态）
node --experimental-strip-types tools/unity/probe.ts \
  "E:/Program Files (x86)/Steam/steamapps/common/Dyson Sphere Program/DSPGAME_Data/globalgamemanagers"
```
