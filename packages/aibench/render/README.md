# aibench-render

AiBench 的渲染引擎：一个 Remotion 工程，把「分镜 JSON + 参数」逐帧画成视频。

**核心承诺**：画面完全由代码绘制，不调用任何生图 / 生视频模型。同一份 brief + 同一组参数 → 同一个 mp4，帧级可复现。

## 为什么单独一个包

`dsh-aibench`（DSH 面板）需要两样东西同时成立：

1. 一个**能被 Remotion CLI 渲染**的工程（`src/Root.tsx` 注册 Composition，CLI 需要真实的 `node_modules`）；
2. 一个**能被 Host 直接 import 的分镜规划器**（面板的分镜表必须与渲染出的帧完全一致，不能各算一套）。

这两件事的依赖需求不同，所以拆成独立包：面板通过 `aibench-render` 依赖拿到它，两个布局（源码 checkout / npm 安装）都能用。

## 目录

```
src/storyboard.ts     分镜规划器 —— 纯函数，(brief, params) → Storyboard。零 import
src/theme.ts          配色与排版工具
src/AiClip.tsx        合成组件：把 Storyboard 画成帧
src/Root.tsx          注册 Composition，calculateMetadata 从 props 算时长
src/index.ts          registerRoot 入口
dist/storyboard.mjs   ← 由 src/storyboard.ts 编译而来，Host 实际 import 的文件
public/audio/         合成 BGM 与音效（无版权素材，脚本生成）
scripts/build-storyboard.mjs   编译脚本
```

## 为什么有 `dist/storyboard.mjs`

Host 要 import 分镜规划器。在源码 checkout 里可以直接 `import('src/storyboard.ts')` 让 Node 剥离类型，但**插件从 npm 安装后文件位于 `node_modules` 下，Node 拒绝为那里的文件剥离类型**：

```
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is
currently unsupported for files under node_modules
```

所以发布包里带一份预编译产物。`storyboard.ts` 刻意保持**零 import**，这样单文件 `transpileModule` 就够了，不需要打包器。

源码仍是唯一真源。改完必须重新编译：

```bash
node scripts/build-storyboard.mjs
```

`scripts/check-storyboard-build.mjs`（在仓库根）会断言磁盘上的产物与源码重新编译的结果一致，并对 108 组参数逐一比对两边产出的分镜 —— 忘了重新编译会直接失败，不会静默漂移。

## 确定性

`storyboard.ts` 里没有 `Date.now()`，没有 `Math.random()`，没有环境依赖。所有"随机"都由 `hashText(brief)` 派生，所以：

- 同一个 brief 连跑三次，mp4 的字节完全一致（MD5 相同）；
- 分镜不变量恒成立：`sum(shot durations) === totalFrames`、首镜从 0 开始、相邻镜首尾相接、每镜 ≥ 12 帧。

`scripts/check-timeline.mjs` 用 19440 组参数守着这些不变量。

## 字幕

`subtitle` 为 `zh` / `en` / `bilingual` 时，`planStoryboard` 给每个镜头写 `shot.caption`（双语时另写 `shot.en`），`Captions` 组件画在底部字幕带。

**注意**：`Captions` 只认 `shot.caption`，**绝不回落到 `shot.copy`** —— 大标题和字幕是给两个不同读者看的，把标题复读一遍当字幕是错的。所以旁白必须由 `planStoryboard` 自己产出；漏掉这步字幕会**静默消失**（不报错、不告警、视频照常出片）。`check-timeline.mjs` 现在把「有字幕模式必须每镜有 caption、none 模式必须没有」当不变量守着。

## 用法

```bash
# 需要先装依赖（773 MB，主要是 Remotion 的 Chrome Headless Shell）
pnpm install

# 预览
pnpm studio

# 渲染
pnpm render
```

面板（`dsh-aibench`）会自动 spawn `@remotion/cli` 并传 `--props` 文件，不需要手动跑。

## 许可证

MIT。音效与 BGM 由 `scripts/generate-audio.mjs` 合成，无第三方素材授权问题。
