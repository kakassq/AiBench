---
name: data-run
description: 数据故事的流水线：抛数 → 拆结构 → 找异常 → 给结论
---

# AiBench Data · 数据故事流水线

不念旁白，用数字和图形说话。**观众记住的永远是三个数字和一句话，不是一张完整的图表。**

## 你只能用这套动效语言

| look id | 气质 | 适用 |
|---|---|---|
| `blueprint` | 蓝图：技术网格、标注线、等宽字体 | 指标、参数、对照 |
| `swiss-dynamic-type` | 瑞士排版：巨字、网格、单一强调色 | 判断句、结论 |
| `halftone-dossier` | 半调案卷：纸感、网点 | 报告、调查、结构拆分 |
| `one-line` | 一笔画：一根线走完全片 | 趋势、时间线 |
| `terminal-crt` | 终端 CRT：扫描线、荧光绿 | 实时数据、监控 |

## 流水线

1. **抛一个数**：选一个反直觉的数字做 hook。它必须是钩子镜的巨字标题，后面不加解释。
2. **给两个支撑数**：第二、第三个数字必须能和第一个形成对比（更大 / 更小 / 占比）。
3. **一句结论**：cta 镜只写一句结论（≤16 汉字），句子里不许出现第二个统计量。
4. **定图形**：趋势 → one-line 或 blueprint；结构拆分 → halftone；对照 → blueprint。
5. **卡点**：BPM 90–120。每个数字出现落整拍；拐点单独占一拍。
6. **标注来源**：如果有数据来源，放在 cta 镜右下角小字，10px，不要抢视觉。
7. **校验**：出 still 检查数字在竖版下是否被截断；出 mp4 检查数字是否在拍上换掉。

## 硬约束（违反即视为失败）

- 全片数字总数不超过 **3 个**（不含年份、不含页码）。
- 数字必须带单位或量级（`亿` / `%` / `×`），否则观众无法感知大小。
- 结论句里不许出现数字——数字在画面上，结论用嘴说。
- 30 fps，所有分镜帧数之和必须等于 `totalFrames`。
- 只用 `bg` / `fg` / `accent` 三色；accent 只加在**最关键的哪一个数字**上。
- 禁止 `Date.now()` / `Math.random()`；随机一律来自 `seed = hashText(brief)`。
- 横版 1920×1080 时数字字号不超过 0.22 × 高度，否则中文单位会被挤出画面。
- **每镜都要有 `caption`**。漏写会让字幕静默消失。

## 脚本契约

内容走 `script`，帧数由 `planScriptedStoryboard()` 按 `weight` 分配并吸附到拍上：

```jsonc
{
  "title": "三年四倍，只赚一成",
  "shots": [
    { "kind": "hook", "copy": "4 倍", "caption": "全球 AI 资本支出三年涨了 4 倍", "en": "4x in three years", "weight": 2 },
    { "kind": "process", "copy": "钱去了哪里", "caption": "四个口袋，只有一个在回本", "en": "Where the money went", "weight": 3,
      "steps": [ { "zh": "算力 58%", "en": "Compute 58%" },
                 { "zh": "模型 27%", "en": "Models 27%" },
                 { "zh": "应用 15%", "en": "Apps 15%" } ] },
    { "kind": "cta", "copy": "只有一成在赚钱", "caption": "11% 的公司在里面赚到钱", "weight": 2 }
  ]
}
```

配套参数：

```jsonc
{ "type": 2, "style": 1, "palette": 0, "durationSec": 25, "beatBpm": 100, "subtitle": "bilingual", "flow": 0 }
```

规则：首镜 `hook`、末镜 `cta`；`process` 必须有 2–4 个 `steps`，每条 `zh` + `en` 都写（右栏 `EvidencePanel` 逐条淡入，缺 `en` 就是单语空行）；`weight` 1–6；`copy` ≤34 字；**不许编造数字**——所有数字必须来自用户给的材料，没有材料就把 `copy` 写成不带数字的定性句。

`cta` 镜在渲染器里会自动生成 `RecapPanel`（按顺序回顾前面各条过程镜）。所以 process 的 `copy` 要能独立成立——它会被收尾页重新列一遍，观众会截图这一页。
