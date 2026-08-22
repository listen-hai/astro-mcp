# Astro MCP (`@lhk714/astro-mcp`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun%20%7C%20Node-black.svg)]()

> 确定性的现代西洋占星本命盘 Model Context Protocol (MCP) server：基于 `astronomy-engine` 星历、逐项对拍 JPL Horizons、出生时间未知时诚实降级而非伪造、默认中文输出。

[中文文档 (Chinese)](README_zh.md) | [English](README.md)

---

## 0. 流派声明：本项目是现代占星

**本项目实现的是现代西洋占星（modern astrology），不是古典 / 希腊化占星（traditional / Hellenistic astrology）。** 这条必须写在最前面，因为下面几乎所有默认值的选择都建立在这个前提之上：

| 选择 | 归属 |
|---|---|
| 天王星、海王星、冥王星 | 现代（古典占星只用七曜） |
| 凯龙、莉莉丝 | 现代 |
| 容许度（orb）按**相位类型**定 | 现代（古典占星按星体光体 moiety 定） |
| Placidus 宫位制默认 | 现代主流 |
| 保留：整宫制作为可选项、福点的日夜盘（sect）判定 | 本项目仍保留的古典元素 |

**明确不在范围内**：三分性 / 界 / 面（必然尊贵的另外三层细分）、古典容许度（moiety）、福点以外的阿拉伯点、映点与对分映点（antiscia）、命主星/七曜专属论断。如果你需要古典占星的技法，这不是合适的工具——比起悄悄给出一个错误的近似结果，明确告知「不支持」更负责任。

---

## 🌟 概览

西洋占星的星历生态里只有两个真引擎：瑞士星历（Swiss Ephemeris，AGPL，与 MIT 授权的 npm 包不兼容，除非下游全部开源）与 [`astronomy-engine`](https://github.com/cosinekitty/astronomy)（MIT，但没有内置小行星星历、没有真交点、没有莉莉丝）。[`auseklis`](https://github.com/igmizo/auseklis) 包了一层 `astronomy-engine`，但存在若干缺陷（交点与莉莉丝的黄纬/赤纬硬编码为 0、上升点公式在极圈以上会返回下降点、小天体积分几十年后偏差可达 100 多度）。

本项目保留了 `auseklis` 做对的部分（宫位求解器与 ayanamsa 表，见「致谢」），重写了它做错的部分：用 `GravitySimulator` 配合 JPL 状态向量种子重新实现小天体星历、由月球真实轨道角动量求出真交点、莉莉丝的真实（非零）黄纬、以及一个在极圈以上仍然有效、带东地平校正的上升点算法。

```
出生挂钟时间 + IANA 时区（1990-06-15 20:00 America/Los_Angeles）
                          │
                          ▼
                挂钟时间 → UTC 瞬时
        （DST 安全：春季空缺报错，秋季重复小时用 dstFold 消歧）
                          │
                          ▼
                 恒星时 + 地理位置
              ┌───────────┴───────────┐
              ▼                       ▼
        上升 / 天顶              各天体星历
      （东地平校正，          （astronomy-engine 算主星，
       极圈以上仍可用）        GravitySimulator 算小天体，
                                真交点，莉莉丝）
              │                       │
              ▼                       ▼
           宫头位置                星座 / 落宫 / 相位 /
      （Placidus，极圈以上          必然尊贵
       回退 Porphyry）
```

与紫微斗数、八字不同，西洋占星的挂钟时间**不需要**真太阳时修正：宫位由恒星时驱动，恒星时公式里已经包含了经度，再做一次经度修正等于重复计算——这是本项目与姊妹项目最大也最容易被忽略的差异（见下文「姊妹项目」）。

---

## 🎯 核心承诺：绝不伪造出生时间

现实中相当比例的用户不知道自己的准确出生时间。多数工具要么强制拒绝，要么静默填入 12:00 正午——生成一个看起来完全正常、但几乎必然错误的上升星座（上升每 4 分钟走 1 度，哪怕猜错 20 分钟也可能落错星座）。本项目从不这样做。根据 `clockTime` / `clockTimeRange` 是否提供，分为三种输入模式：

| 模式 | 触发条件 | 行为 |
|---|---|---|
| **A — 精确时间** | 给出 `clockTime` | 完整星盘，不降级。 |
| **B — 时间区间** | 给出 `clockTimeRange: { from, to }` | 上升/天顶/宫位/福点退化为**候选星座区段**，附带对应的时间子区间。实测上升在 \|纬度\| ≈ 66° 以内严格单调，此时用**二分**（`diagnostics.method: "bisect"`）精确定位星座边界；纬度更高时上升已可测得非单调（70°N 一天 132 次逆行），二分会静默给出错误候选，此时改用 ≤30 秒的**密集扫描**（`"scan"`）。`diagnostics.ascendantMonotonic` 会说明用了哪种。`from > to` 表示区间跨越午夜。 |
| **C — 仅日期** | 都不给 | `angles`、`houses`、`positions[].house`、`partOfFortune` 是**缺席的字段**，不是 `null` 占位——具体缺席原因见 `diagnostics.omitted`。太阳在当日跨越星座边界的约 12 天/年会给出两个候选星座；每个天体给出覆盖当日整天的 `degreeRange` 而非单一数值；相位只在当日 UTC 区间**两端点均成立**时才输出，且给出 `orbRange` 而非单一容许度；`applying`（入相位/出相位）在此两模式下一律缺席（它需要精确时刻的相对速度）。 |

`partOfFortune`（福点）值得单独说明：它既不算「角度」（angles）字段，也不算「宫位」（houses）字段，最容易被实现者遗漏而照常输出一个基于假想上升算出的福点。它的日夜盘（sect）判定与起点都依赖上升，因此在模式 B、C 下**必须缺席**，没有例外。

---

## 🚀 快速开始

```bash
bunx @lhk714/astro-mcp@latest
```

```bash
npx -y @lhk714/astro-mcp@latest
```

## ⚙️ MCP 客户端配置

```json
{
  "mcpServers": {
    "astro": {
      "command": "npx",
      "args": ["-y", "@lhk714/astro-mcp@latest"]
    }
  }
}
```

---

## 🛠️ 工具

### 1. `calculate_natal`

必填 `solarDate` 与出生地（`place`，或 `longitude` + `latitude` + `timezone`）。`clockTime` 与 `clockTimeRange` 可选且互斥（见上文三种模式）；`dstFold`（`0`/`1`）用于消歧 DST 秋季重复的那个小时。

**流派约定**——下表每一个默认值背后都是某个具体流派的选择，而非中立值，且都会回显在 `diagnostics` 中：

| 参数 | 默认值 | 可选值 | 归属 |
|---|---|---|---|
| `houseSystem` | `placidus` | `whole-sign`、`equal`、`porphyry` | 现代主流，具体来说是中文占星圈（占星之门/测测/爱星盘）压倒性使用的宫位制——不是 `auseklis` 自己默认的整宫制。实测同一张盘：10 颗行星中 9 颗落宫不同，天顶本身也从第 10 宫变成第 11 宫——这是**口径**差异，不是精度差异。 |
| `zodiac` | `tropical`（回归黄道） | `sidereal-lahiri`、`sidereal-fagan-bradley` | 回归黄道是西方主流；两种恒星黄道 ayanamsa 面向偏印度占星的使用场景。 |
| `node`（交点） | `"true"`（真交点） | `"mean"`（平交点） | 现代偏好——`auseklis` 只有平交点。真/平最大可差约 1.6°，足以跨星座边界。 |
| `lilith`（莉莉丝） | `"mean"`（平均远地点） | `"true"`（真实瞬时远地点） | 流行占星的通行口径；`"true"` 是小众选择。 |
| `minorAspects`（次相位） | `false` | `true` | 默认只算五个主相位（合/六合/刑/拱/冲）。 |
| `declinationAspects`（赤纬相位） | `false` | `true` | 小众口径——也正是 `auseklis` 曾经硬编码零赤纬伪造结果的地方。启用后使用由黄纬实算得出的真实赤纬。 |
| 容许度（orb） | 合/冲 8°，刑/拱 7°，六合 6°，次相位 2–3° | `orbs` 参数，逐相位覆写 | 现代惯例：容许度按**相位类型**定，而非按各星体自身光体（古典 moiety）定。容许度是整张盘里流派差异最大的一个数，默认值只是起点——可逐项覆写，实际生效的表会回写进 `diagnostics.orbs`。键名用英文（conjunction/sextile/square/trine/opposition/…），不随 `lang` 变化；写错的键会报错而不是被忽略。 |
| `chiron`（凯龙） | `true` | `false` | 默认开启：现代心理占星的标配，在中文社交媒体上也有真实热度。 |
| `asteroids`（谷神/智神/婚神/灶神） | `false` | `true` | 默认关闭：使用率较低；因为与凯龙共用同一条代码路径，仍用一个开关保留。 |
| 必然尊贵 | 仅庙/旺/陷/落四种 | —— | 现代占星从古典技法中保留的四层。三分性/界/面**不实现**（超出范围，见 §0）。外行星的庙旺归属（天王星→水瓶、海王星→双鱼、冥王星→天蝎）是现代惯例、非古典共识，输出中标注 `modern: true` 以便与古典七曜的归属区分。 |
| `lang` | `"zh"` | `"en"` | 默认中文输出（星座、行星、相位、尊贵、诊断文案），与 `ziwei-mcp`/`bazi-mcp` 一致。 |

**不支持**：出生时间未知时默认填 `clockTime: 12:00`——见上文「核心承诺」。本项目没有这个默认值；不提供 `clockTime`/`clockTimeRange` 即可得到诚实降级后的星盘。

### 2. `lookup_location`

将英文城市名解析为经度、纬度与 IANA 时区，覆盖 227 个国家的 7,329 座城市——与 `ziwei-mcp`/`bazi-mcp` 使用同一数据库。不同时区的同名城市（如 Springfield，或英国剑桥 vs 美国剑桥）会拒绝并列出候选列表，而不是随意猜一个——**除非**某个候选的人口数量级压倒性超过另一个（≥10 倍，例如 "Los Angeles" 会直接解析到人口约 810 万的加州城市，而不是智利 Bío-Bío 大区一个同名、人口约 13.5 万的小镇）；这种情况下会在 `mixedWarning` 中明确说明，而非静默处理。

---

## 📏 精度

对 JPL Horizons（`QUANTITIES=31`，含光行时修正）实测，覆盖 1900–2050–2100：

- **主星（太阳至冥王星）与月交点**：全程 ≤ 1 角分。月球在 2100 年附近需要用 `SetDeltaTFunction(DeltaT_JplHorizons)` 替代 `astronomy-engine` 默认的 Delta-T 模型才能守住这个精度（默认模型偏差 1.31′，换用后降到 0.02′）。
- **小天体**（凯龙 + 四颗小行星，用 `GravitySimulator` 配合 JPL 状态向量种子积分）：**≤ 0.4 角分**，远好于测试强制的 1.5′ 预算。凯龙用 4 天步长；四颗内圈小行星（轨道更快更近）需要 0.25 天步长才能守住同样的精度——4 天步长下实测偏差最大达 2°，等于落错一整个星座。
- **种子存了 11 个历元**（1900–2100 每 20 年一个），而不是只有 J2000，因此任何日期的积分距离都不超过约 10 年。这本是个性能修复——1900 年带小行星的盘原本要 4.7 秒，有撞上 MCP 客户端超时的风险，现在约 450 毫秒——但积分距离短同时也意味着漂移小，所以下表的精度是跟着速度一起变好的。`scripts/pull-seeds.ts` 可从 JPL 重新生成整张种子表。

| 天体 | 1900 | 1950 | 1990 | 2026 | 2050 | 2100 | 步长 |
|---|---|---|---|---|---|---|---|
| 凯龙 | 0.33′ | 0.32′ | 0.32′ | 0.15′ | 0.28′ | 0.26′ | 4 天 |
| 谷神 | 0.35′ | 0.26′ | 0.26′ | 0.16′ | 0.37′ | 0.15′ | 0.25 天 |
| 智神 | 0.37′ | 0.16′ | 0.39′ | 0.22′ | 0.05′ | 0.22′ | 0.25 天 |
| 婚神 | 0.35′ | 0.04′ | 0.28′ | 0.30′ | 0.27′ | 0.33′ | 0.25 天 |
| 灶神 | 0.04′ | 0.33′ | 0.20′ | 0.16′ | 0.12′ | 0.28′ | 0.25 天 |

真交点另有独立自洽校验：与 `astronomy-engine` 自身的交点穿越事件（`SearchMoonNode`/`NextMoonNode`）对照，月球在穿越时刻的黄经必须等于真交点（升）或其对点（降），容许 1 角秒以内——实测最大偏差 0.01 角秒。

---

## 🧭 姊妹项目：`ziwei-mcp` / `bazi-mcp`

本项目不计算紫微斗数或八字（四柱），需要请使用 [`@lhk714/ziwei-mcp`](https://github.com/listen-hai/ziwei-mcp) 或 [`@lhk714/bazi-mcp`](https://github.com/listen-hai/bazi-mcp)。

共有的出生输入字段（`place`、`longitude`、`timezone`、`dstFold`、`solarDate`、`clockTime`）与地理解析层（`lookup_location`）在三个 server 之间刻意保持一致，因此用同一份出生数据分别请求三者，会解析到同一个 UTC 瞬时与同一个地理位置——同一个人的西洋、紫微、八字三张盘因此天然对齐。`latitude` 是本项目在共有契约之外新增的唯一字段：西洋占星的上升点与宫位需要纬度，另外两个姊妹项目不需要。

**刻意不共享的一点**：本项目去掉了另外两个项目对挂钟时间做的真太阳时修正（见上文「概览」）——西洋占星的宫位由恒星时驱动，恒星时公式里已经包含经度，在这里再叠加一次经度修正不是精化,而是重复计算。

---

## 🙏 致谢

- [`astronomy-engine`](https://github.com/cosinekitty/astronomy)（MIT）——本项目全部天体位置的星历引擎、小天体积分用的 `GravitySimulator`，以及角度/宫位计算所需的恒星时、黄赤交角与章动。
- [`auseklis`](https://github.com/igmizo/auseklis)（MIT）——`src/ephemeris/vendor/houses.ts`（Placidus/Porphyry/等宫/整宫宫位求解器，含极圈回退）与 `src/ephemeris/vendor/sidereal.ts`（Lahiri/Fagan-Bradley ayanamsa）改编自此项目，逻辑未作修改。完整署名与 MIT 许可证全文见 [NOTICE](NOTICE)。其上升点公式与小天体/交点/莉莉丝的处理**未被复用**——原因见 §0 与上文「概览」。

## 已知局限

- 不支持 1900 年前的出生日期（与 `ziwei-mcp`/`bazi-mcp` 对齐；1883 年前的民用时区本身也没有良好定义）。
- 仅五颗小天体（凯龙 + 谷神/智神/婚神/灶神），不含完整小行星表——同一条代码路径，需要时可以再加。
- 不含恒星（fixed stars）、福点以外的阿拉伯点、映点（antiscia）。
- 仅两种 ayanamsa（Lahiri、Fagan-Bradley）——Krishnamurti 等未实现。
- 暂无合盘、行运、推运、返照盘——目前只做本命盘。

## 📜 许可证

MIT。
