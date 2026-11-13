---
name: explainer-run
description: 科普解说的标准流水线：拆题 → 写结论 → 分镜 → 卡点 → 字幕 → 渲染校验
---

# AiBench Explainer · 科普解说流水线

无人出镜、无口播。用画面和字幕把一件硬核的事讲清楚。

## 你只能用这套动效语言

| look id | 气质 | 适用 |
|---|---|---|
| `swiss-dynamic-type` | 瑞士国际主义：巨字、网格、单一强调色 | 判断句、反直觉结论 |
| `blueprint` | 蓝图：技术网格、标注线、等宽字体 | 公式、结构、流程 |
| `terminal-crt` | 终端 CRT：扫描线、荧光绿、光标 | 代码、模型、系统行为 |
| `halftone-dossier` | 半调案卷：纸感、网点、案卷标签 | 调查、历史、证据 |
| `one-line` | 一笔画：一根线走完全片 | 抽象关系、因果链 |

## 流水线

1. **拆题**：把选题压成一句判断句（≤18 汉字），它必须是 hook 镜的主标题，且第一眼就能看懂。
2. **拆三层**：把结论拆成 3 个递进的支撑点，每点一句中文（≤12 字）+ 一句英文 gloss。这就是 process 镜的 `steps`。
3. **定 look**：从上表选 1 个主 look。判断句 → swiss；公式/结构 → blueprint；代码/系统 → crt。
4. **定节奏**：BPM 100–130。1 拍 = 60/BPM 秒 = 1800/BPM 帧（BPM 120 → 15 帧）。
5. **卡点**：hook 落在第 1 拍；三个 step 依次落在第 6/12/18 拍；cta 落在整数拍上。
6. **字幕**：`bilingual`，每行 ≤14 汉字，最多 2 行。字幕是旁白的替代品，不是标题的回声——hook 镜也要字幕，但写的是「这句话凭什么成立」，不是把标题复读一遍。
7. **渲染校验**：先 `POST /still` 拿 hook 与 process 各一帧，肉眼确认排版不溢出；再 `POST /projects/:id/render` 出 mp4。

## 硬约束（违反即视为失败）

- 30 fps，所有分镜 `durationFrames` 之和 **必须等于** `totalFrames`。
- 每镜起点 `from` 必须是拍长的整数倍（`from % beatFrames === 0` 向上取整）。
- 只用 `bg` / `fg` / `accent` 三色；accent 全片只在一个地方加强。
- 禁止 `Date.now()` / `Math.random()`；随机数一律来自 `seed = hashText(brief)`。
- 文字在 1920×1080 与 1080×1920 下都不能溢出安全区（左右留白 ≥ 6%）。
- 至少 3 镜，最多 5 镜。
- **每镜都要有 `caption`**。字幕模式下漏写会让字幕静默消失（不报错、不告警、视频照常出片）。

## 脚本契约

内容用 `script` 传，不要自己算帧数——`planScriptedStoryboard()` 会按 `weight` 分配时间轴并吸附到拍上。

```jsonc
{
  "title": "中轴上的紫禁城",                       // ≤18 字，项目标题
  "shots": [
    { "kind": "hook",    "copy": "紫禁城先有一条线", "caption": "看懂中轴线，才看懂紫禁城的秩序",
      "en": "A line comes first", "weight": 2 },
    { "kind": "process", "copy": "先定线，再定城",   "caption": "中轴线先把空间的主次定下来",
      "en": "Line first, city second", "weight": 3,
      "steps": [ { "zh": "定南北中心", "en": "Set the north-south center" },
                 { "zh": "排门殿次序", "en": "Order gates and halls" },
                 { "zh": "控左右对称", "en": "Control the symmetry" } ] },
    { "kind": "cta",     "copy": "先看线，再看宫", "caption": "顺着中轴线走，紫禁城就清楚了", "weight": 2 }
  ]
}
```

配套的渲染参数（`params`）：

```jsonc
{ "type": 0, "style": 0, "palette": 0, "durationSec": 20, "beatBpm": 120, "subtitle": "bilingual", "flow": 0 }
```

规则：首镜必须 `hook`、末镜必须 `cta`；`process` 必须给 2–4 个 `steps`（少于 2 个的会被整镜丢弃）；`weight` 1–6，数字大的镜更长；`copy` 是标题不是标签（≤34 字）；**不许编造事实、数字、日期、引文**；不写「让我们开始 / 敬请期待 / 以上就是」这类填充句。

## 版式纪律（决定了片子能不能发布）

画面下半部和右侧不是留白区，是承载区。渲染器已经按镜头种类自动填：

| 镜头 | 右栏承载物 | 你要提供的内容 |
|---|---|---|
| `hook` | `SpecPanel`：标题 + 时长/镜头数/画幅/节拍 | `storyboard.title`（来自 `script.title`）|
| `process`（有 steps） | `EvidencePanel`：逐条淡入的中英对照 | 每条 step 的 `zh` 与 `en` 都必须写 |
| `cta` | `RecapPanel`：按顺序回顾前面各条过程镜 | 前面每条 process 的 `copy` 就是回顾条目 |

所以：**写 `steps` 时不写 `en` 会让右栏出现单语空行；cta 镜只重复一句结论会让收尾页什么都没带走。** 收尾要能让观众截图。

自检阈值（`scripts/check-layout.mjs` 用的就是这几条）：四边留白 ≥ `min(w,h)×1.2%`、6 条横带中 ≥4 条有墨、可读墨量 ≥ 0.9%。低于这个数就是「75% 空白」那一版。
