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
6. **字幕**：`bilingual`，每行 ≤14 汉字，最多 2 行。字幕是旁白的替代品，不是标题的回声——**hook 镜不加字幕**，标题本身就是大字。
7. **渲染校验**：先 `POST /still` 拿 hook 与 process 各一帧，肉眼确认排版不溢出；再 `POST /projects/:id/render` 出 mp4。

## 硬约束（违反即视为失败）

- 30 fps，所有分镜 `durationFrames` 之和 **必须等于** `totalFrames`。
- 每镜起点 `from` 必须是拍长的整数倍（`from % beatFrames === 0` 向上取整）。
- 只用 `bg` / `fg` / `accent` 三色；accent 全片只在一个地方加强。
- 禁止 `Date.now()` / `Math.random()`；随机数一律来自 `seed = hashText(brief)`。
- 文字在 1920×1080 与 1080×1920 下都不能溢出安全区（左右留白 ≥ 6%）。
- 至少 3 镜，最多 5 镜。

## 输出契约

```jsonc
{
  "brief": "熵增定律解释了为什么时间只朝一个方向流",
  "params": { "type": 0, "style": 0, "palette": 0, "durationSec": 20, "beatBpm": 120, "subtitle": "bilingual", "flow": 0 }
}
```

把这个 props 交给渲染层即可成片。不要自己编 `storyboard` 字段——除非你要覆盖 `planStoryboard()` 的默认分镜。
