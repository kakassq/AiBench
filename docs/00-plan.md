# AiBench 总方案（v2 · S0–S4 已完成，含实测修正）

> 目标：做一个对标 BN面板（npm `bnpanel`）的 DSH 插件平台，但**开源、免费、参数化、可自己造 Agent**。
> 交付形态：一个 GitHub 仓库 `AiBench`（https://github.com/kakassq/AiBench）+ 一个可装进 DSH 的自包含 bundle `dsh-aibench`。
> **本文件是执行前的蓝图，现已回填实测结果。** 凡与原计划冲突的地方都注明了改了什么、为什么。

---

## 0. 先说三个事实（纠正三个前提）

1. **GitHub 上没有 bnpanel。** 搜 `bnpanel` 全是 2015 年 PHP 主机计费系统的无关项目。它是闭源商业产品（npm 包 `bnpanel`，author `Biunow`，license `UNLICENSED`，2026-10-29 首发，当前 0.6.3）。
   → 逆向只能靠拆 npm tarball。已拆：`D:\AI\Vibe\.tmp\bnpanel\package\`（index.js 10596 行 esbuild bundle + client.js 1877 行）。
2. **本机没有 git、没有 gh、没有 npm 命令。** 有 node v24.21.0 / pnpm 11.28.5（bundled 运行时），且该 node **不含 npm**。
   → 发布 GitHub 只能走 `api.github.com`（实测通，1.9s），`scripts/publish-github.mjs` 用 Git Data API 逐 blob 推；npm 发布脚本也直接打 registry API。
3. **`aibench` 这个 npm 包名已被占用**（elnino0009_1，AI 跑分基准工具）。GitHub 上 `steipete/aibench`、`RedisAI/aibench`、`ali-vilab/AIBench` 也都存在，社区里 `AIBench` 多指「AI 跑分」。
   → 仓库名仍叫 `AiBench`，npm 包名用 `dsh-aibench`，README 首行定调「DSH 视频创作面板」。

---

## 1. 我们和 BN面板 的差异（只抄骨架，不抄它的商业模式）

| 维度 | BN面板 | AiBench（我们） |
|---|---|---|
| 授权 | 试用次数 + 「我的授权」激活 | **无授权闸门**，装上即全功能 |
| 产出可控性 | 一段提示词丢给大模型，模型自由发挥 | **参数化模板**：表单填 7 槽位，渲染参数由本地纯函数算，模型只填文本 |
| 进度可见 | FAQ 明说「面板里看不到进度，要去 DSH 工作区」 | **面板内 ProgressHub + 分镜表 + 单帧预览** |
| 失败恢复 | 模型分神就失败，要人工回「继续任务」 | 分阶段断点续跑，每阶段产物落盘可重入 |
| 造 Agent | 没有 | **Forge 向导**：对话式生成自己的 Agent 包 |
| 成本 | 约 1.5–5 元/条 | 本地渲染 0 元；只花 token，且按角色选便宜模型 |
| 生态 | 闭源、模板锁在包里 | 模板/Agent 包全是 JSON + markdown，GitHub 上可 PR |

保留的骨架：DSH 插件双半部、侧栏入口、Agent=npm 风格包（manifest + SKILL.md + 模板）、Studio 三栏工作台、本地 Remotion 渲染。

---

## 2. 产品形态

### 2.1 面板长什么样
侧栏一个图标「AiBench」→ 点开全屏工作台（`shell.overlay` 形态，近全屏、可关闭），三个页签：

- **工作台 Studio**（主）：三栏
  - 左：模板库（按赛道分组）+ 7 槽位参数表单（表单，不是文本框）+ 分镜表
  - 中：大预览（单帧 PNG 实时刷新）+ 播放头 + 视频/音频/字幕三轨时间轴
  - 右：AI 助手（本项目的独立 session，可对话改稿）
- **智能体 Agents**：已装 Agent 包列表（图标/版本/技能数/模板数）、从本地目录安装、卸载、检查更新、回滚
- **造 Agent Forge**：4 步向导（选赛道 → 一句话目标 → 对话细化 → 预览生成的文件 → 校验并安装）

### 2.2 五个核心动作
1. 选模板 → 填参数 → 立项（`POST /projects`）
2. 点「生成分镜」→ 本地 `planStoryboard()` 秒出分镜表（不花 token）
3. 点「预览一帧」→ Remotion still → PNG 回填预览
4. 点「导出 MP4」→ Remotion render → job 轮询 → 完成下载
5. 不满意 → 右侧助手对话改脚本 → 重新出分镜

---

## 3. 技术架构

### 3.1 分层（6 层，与 DSH 运行时对齐）

```
L6 分发   GitHub 仓库 / npm 包 / DSH 插件市场收录
L5 交互   client.js（无构建 ESM，React.createElement，slot 注册）
L4 编排   index.js Host（PanelRouter / AgentManager / ProjectStore /
          RenderRunner / ProgressHub / SessionBridge / SkillBridge / Forge）
L3 知识   Agent 包（manifest + SKILL.md + templates/*.json）+ 风格档案
L4' 能力  Remotion compositions（矢量排版/图表/CRT/动态字体/一笔画…）
L5' 渲染  Remotion 4.0.542 → PNG 序列 → ffmpeg → mp4
L6' 基础  DSH 运行时：webServer / sessionController / skills / tools / subprocess
```

### 3.2 目录结构（实际落地形态）

```
D:\AI\Vibe\AiBench\
├─ package.json                     # workspace 根，private，scripts 全是闸门
├─ README.md / LICENSE (MIT) / .gitignore
├─ docs\
│  ├─ 00-plan.md                    # 本文件（含实测修正）
│  ├─ PUBLISHING.md                 # 双通道发布手册 + 三次 token 实测 + 四个坑
│  └─ marketplace-entry.yml         # 市场 PR 用的条目草案
├─ packages\aibench\                # ★ 唯一可分发的 DSH 包（自包含）
│  ├─ package.json                  # dsh.bundle + dsh.client
│  ├─ cordis.patch.yml
│  ├─ index.js                      # Host 半部（~118 KB，含 Forge / 脚本层 / LLM 路由）
│  ├─ client.js                     # Client 半部（~143 KB，5 栏导航 + 4 页 + Forge）
│  ├─ locale\{zh,en}.json
│  ├─ icon.svg
│  ├─ agents\                       # 3 个内置 Agent 包（首次启动自动播种）
│  │  ├─ aibench-explainer\         # manifest + skills/ + templates/
│  │  ├─ aibench-reel\
│  │  └─ aibench-data\
│  └─ render\                       # Remotion 渲染工程，随插件一起发布
│     ├─ src\{index.ts,Root.tsx,AiClip.tsx,storyboard.ts,theme.ts}
│     ├─ dist\storyboard.mjs        # 预编译规划器（npm 安装后 Host import 的是它）
│     ├─ public\audio\{bgm,sfx}
│     └─ scripts\{build-storyboard.mjs,generate-audio.mjs}
├─ assets\                          # icon-180.png / icon-512.png（从 icon.svg 栅格化）
├─ artifacts\                       # 验收用的成片与静帧（不进 git）
└─ scripts\                         # 15 道闸门 + 发布 + 测量工具
```

**和原方案的三处关键偏差：**

1. **`packages/render` 变成 `packages/aibench/render`。** 原计划两个独立包，实测发现跨包发布要处理版本耦合、`files` 白名单、以及「装插件的人还得单独装渲染引擎」三个问题。改成渲染引擎在插件包内部，单包自包含。
2. **`packages/agents` 变成 `packages/aibench/agents`。** 内置 Agent 包是插件自带的种子数据，不是独立可发布单元，放包内 `files` 里跟着走最省事。
3. **没有 `docs/01-architecture.md` / `02-api-contract.md` / `03-agent-package-spec.md` / `04-roadmap.md`。** 四个文档会立刻过时（这次改动里 `planStoryboard` 加了脚本层、版式重写、模型路由换通道），而这个信息在三个 README 的正文里有更强的约束力——它们必须和代码一起改才能过闸门。文档收敛成 `00-plan.md` + `PUBLISHING.md` + 三份 README。

### 3.3 Host 半部（`packages/aibench/index.js`）

```js
export default { apply }        // DSH 加载契约

function apply(ctx) {
  // 1) 数据目录
  DATA_DIR = <DSH_PROFILE_DIR>/aibench
  // 2) 服务实例
  agentManager  = new AgentManager(ctx)      // 包安装/校验/回滚
  templateLib   = new TemplateLibrary()      // 模板索引（从已装 Agent 收集）
  projectStore  = new ProjectStore()         // projects/<id>/project.json + storyboard.json + outputs/
  sessionBridge = new SessionBridge(ctx)     // ★ 见 §5 子模型路由
  renderRunner  = new RenderRunner(ctx)      // spawn Remotion CLI
  progressHub   = new ProgressHub()          // 内存 + 每秒轮询
  skillBridge   = new SkillBridge(ctx)       // SKILL.md → ctx.skills
  forge         = new Forge(ctx)
  // 3) 唯一一条 HTTP 路由（prefix 注册，重复注册会抛，必须 ctx.effect 包裹）
  ctx.inject(['webServer'], (scope) => {
    const server = scope?.webServer ?? ctx.webServer
    ctx.effect(() => server.register({
      name: 'aibench-api', kind: 'prefix', path: '/aibench-api',
      handler: async (req, res) => { try { await handle(req, res) } catch (e) {
        console.error('[aibench] route failed:', e)
        sendError(res, 500, 'internal_error', String(e?.message ?? e))
      } }
    }))
  })
}
```

关键实现细节（都是踩过的坑）：
- 路由**只能注册一次**，重装插件会二次 `apply()`，必须 `ctx.effect(() => server.register(...))` 拿到 disposer，否则 `duplicate (kind, path)` 抛错。
- 安全：只接受 loopback + 同源。校验 `req.headers.host` 是 127.0.0.1/localhost，`sec-fetch-site !== 'cross-site'`，POST 要求 `content-type: application/json`。
- 渲染：`spawn(process.execPath, [REMOTION_CLI, 'render', 'AiClip', outPath, '--props=<propsFile>'], { cwd: RENDER_DIR, windowsHide: true })`。
  **`--props` 必须传文件路径，不能传 JSON 字符串** —— 中文 brief 里的引号会让命令行直接崩，且 Remotion 会静默用默认 props 渲染，产出「看起来成功但内容不对」的片子。
- 超时：still 5 分钟、render 15 分钟，到点 `child.kill()` 并把 `[timed out]` 追加进日志。
- 渲染并发 = 1（Remotion 吃 CPU，并发会互相拖死）。

### 3.4 Client 半部（`packages/aibench/client.js`）

无构建步骤：`window.__ModuleLoader__.load({ id: 'dsh-aibench', factory(require) { ... } })`，只用 `require('react')`，全 `React.createElement`（`h(...)`）。
- 侧栏入口：`ctx.slots.register({ name: 'sidebar.panellist', id: 'aibench.launcher', order: 60 })`。
- 主面板：`shell.overlay` 近全屏容器，可关闭。面板内部是**可收起的左侧导航栏 + 内容区**。
- 所有请求走相对路径 `/aibench-api/*`，**每次 fetch 独立 try/catch**，失败变顶部 notice，绝不让一个接口 500 把整个面板打白。

**导航栏是数据驱动的**（用户明确要求「预留子栏目扩展接口」）：

```js
const SECTIONS = [
  { id: 'agents',   labelKey: 'navAgents',   icon: 'agents' },
  { id: 'studio',   labelKey: 'navStudio',   icon: 'studio' },
  { id: 'forge',    labelKey: 'navForge',    icon: 'forge' },
  { id: 'tasks',    labelKey: 'navTasks',    icon: 'tasks' },
  { id: 'settings', labelKey: 'navSettings', icon: 'settings' },
]

// A section renders its own page when it brings one; otherwise the shell falls
// back to the built-in page for that id.
function registerSection(section) {
  if (!section || typeof section.id !== 'string' || !section.id) return false
  if (SECTIONS.some((item) => item.id === section.id)) return false   // idempotent
  SECTIONS.push(section)
  return true
}
```

`registerSection()` 幂等（同 id 返回 `false` 而不重复插入）。`check-sections.mjs` 用假 module loader 加载 client.js 后断言：5 个内置 section、id 顺序、注册第 6 个后 `listSections().length === 6`。

### 3.5 数据模型（实际形态）

```ts
Agent    { id, name, version, description, tracks[], skills[], templates[],
           builtin, capabilities, defaults, path, installedAt }

Template { id, agentId, title, track, brief, defaults /* 渲染参数 */,
           style { look, palette, tokens, motion, rhythm, font },
           audio { bgm{mood,bpm}, sfxSet, voice{mode,lang}, subtitles{kind} },
           beatMap { rule, notes } }

Project  { id, title, templateId, agentId, params, status, brief,
           script, storyboard, jobId, createdAt, updatedAt,
           origin { source, prompt, skill, script{source,error,rejected} },
           outputs { stills:[{frame,url,at}], video } }

Job      { id, kind:'still'|'render'|'forge', progress 0..100, logs[], ok?, error?, startedAt, w, h, out }

Storyboard { fps:30, totalFrames, title, brief, params, palette, look,
             subtitle, shots: Shot[] }
Shot       { id, index, kind:'hook'|'process'|'cta', from, durationFrames,
             copy, caption?, en?, steps?:[{zh,en,at}],
             name, motion, transition, card }
Script     { title?, shots: [{kind, copy, caption?, en?, steps?, weight?}] }
```

持久化：纯 JSON 文件（`settings.json`、`agents.json`、`projects/<id>/project.json`），不用数据库。

**两个刻意的选择：**

- `outputs.stills` 是 `{frame, url, at}` 的对象数组而不是路径字符串数组 —— 单帧 URL 带内容哈希后缀（`still-30-mwcxnzkh.png`），这样浏览器缓存不会把改过参数的旧帧喂回来。
- `Project.script` 与 `Project.storyboard` 分开存：`script` 是模型写的词，`storyboard` 是本地算出的帧级计划。只改词时重跑 `planScriptedStoryboard()` 即可，不必重调模型。

---

## 4. 功能怎么实现（逐条）

### 4.1 模板库 & 参数表单
- 模板来源：已装 Agent 包的 `templates/*.template.json`，安装时索引进 `templates-index.json`。
- 表单 schema 写在模板里（`params: [{key,label,type:'select'|'number'|'color'|'text',options,min,max,default,locked}]`）。
- **locked 字段**：模型不许改（例如 `durationSec`、`fps`、`palette`），保证渲染可复现。用户手动改可以，模型改要被 Host 拦掉。

### 4.2 分镜生成（0 token 路径）
`planStoryboard(brief, params)` 纯函数（30fps、无 `Date.now`/`Math.random`、随机数走 `hashText(brief)` 播种）：
- 时长 → 帧数；三段权重 `hook:90 / process:150 / cta:60`（按总长缩放）
- BPM → 节拍网格 → 每个镜头起点 `snapToBeat()`
- 字幕按 `wrapCaption(text, 14, 2)` 切行（每行 ≤14 字、≤2 行）
- 输出确定性：同一个 brief + 同一套参数 → 每次分镜完全一致

这一层**不调模型**。

### 4.2b 脚本层（S1 之后补的关键一层）
`planStoryboard` 的镜头文案来自 `TYPE_COPY` 的固定句子 —— 它保证任何输入都能渲出片子，但**不承载选题内容**。第一次拿它出故宫片，画面是：

```
hook    紫禁城先有一条线   ← 用户输入衍生的
process 一件事，拆成三步讲  ← 模板硬编码
cta     记住这一句就够了。  ← 模板硬编码
```

这不是 bug，是能力边界。所以加了第三层：`planScriptedStoryboard(brief, params, script)`。

- 先跑 `planStoryboard()` 复用**全部非镜头决策**（配色/look/拍点网格/字幕模式），脚本不可能和主题系统对「palette 索引 3 是什么色」产生分歧。
- 按每镜 `weight` 用最大余数法分配帧数（`sum === totalFrames` 恒成立），边界吸附到拍上。
- `shots × MIN_SCRIPT_SHOT_FRAMES(24)` 超出总帧数时**截断尾部**，而不是把每镜压到 6 帧——一闪而过的镜头读起来像渲染故障。
- 空脚本回落原型计划，向后兼容。

写脚本的是第二次模型调用（`authorScript`），`sanitizeScript()` 守质量：`process` 少于 2 个 step 整镜丢弃、首镜补 `hook`、末镜补 `cta`、model 挂了回落确定性的 `localScript()`。

文案可以单独重写而不动画面：`POST /projects/:id/script`。挑错模板是「形状错了」，写错词是「形状对了词错了」，后者不该逼用户重选模板。

### 4.3 单帧预览（调参体验的核心）
`POST /still {projectId, frame, paramsOverride}` → 写临时 props JSON → `remotion still AiClip out/frame-<n>.png` → 返回图片 URL。前端拖动播放头即刷新（节流 300ms）。

### 4.4 渲染出片
`POST /projects/:id/render` → 建 Job → 后台 spawn → `GET /jobs/:id` 每秒轮询进度（解析 stdout 里的 `Rendered X/Y`）→ 完成把 mp4 路径写进 project.outputs.video，前端 `<video>` 播放。

### 4.5 Agent 包安装（AgentManager）
流程：读 `manifest.json` → schema 校验（必填字段/版本号/技能数≥1）→ 逐文件 sha256 比对 `integrity.files` → 写临时目录 → **原子 rename** → 更新 `agents.json` → SkillBridge 注册技能 → 模板入库。
- 从本地目录安装：`POST /agents/install {source:'path', path}`
- 从 npm 安装：`POST /agents/install {source:'npm', package, version}`（自己下载 tarball 解包，不依赖 npm 命令）
- 更新/回滚：旧版本快照在 `<agent>/.versions/<version>/`，切换指针；UI 上一键回滚
- 卸载：默认保留项目数据（`keepData:true`）

### 4.6 SkillBridge（把 SKILL.md 变成 DSH 可用技能）
`ctx.skills.register({ name, description, content })` —— 面板里造的 Agent，它的 SKILL.md 在主会话里能用 `@skill-name` 直接调到。这是 BN面板 有但我们做得更彻底的点（它的技能是锁在包里的）。

### 4.7 Forge 造 Agent
4 步向导，背后是**一个专用 session**：
1. 用户选赛道 + 一句话目标
2. Host 建 session（cwd = `<DATA_DIR>/forge/<draftId>/`），prompt 里注入「Agent 包规范」+ 一个最小样板
3. 模型在草稿目录里生成 `manifest.json / SKILL.md / templates/*.json`
4. Host 跑静态校验（JSON 可解析、manifest 必填、SKILL.md frontmatter、模板字段完整、能渲染一帧）→ 通过则一键安装

**限制**：Forge 生成的是「模板 + 提示词 + 参数」，不是新写 React 组件。想加全新视觉风格仍需写 `compositions/`（这是正确的边界，避免模型生成不可控的渲染代码）。

### 4.8 画面质量：把主观评语变成会失败的测试

第一版成片的评审结论是 *"approximately 75% of the frame is empty background… unbalanced… sparse and unfinished as a published motion-graphics frame"*。这句话对，但**无法复现**，也没法防回归。所以它被拆成三个测量脚本：

| 脚本 | 量什么 | 阈值 |
|---|---|---|
| `scripts/frame-density.mjs` | 每帧 ink（与主色差 >24，含装饰网格）与 **read ink**（>150，只算真正可读的字）、6 条横带分布、内容包围盒 | 人工看数 |
| `scripts/safe-area.mjs` | 到四边最近的 strong-ink 距离 | `min(w,h) × 0.012`，低于即 BLEED 并 exit 1 |
| `scripts/check-layout.mjs` | **3 画幅 × 4 帧，真 Remotion CLI 渲出来逐帧断言** | read ≥ 0.9%、6 带中 ≥4 带有墨、四边 ≥ 1.2% |

`check-layout.mjs` 是第 15 道闸门，进 `pnpm check`。它跑真 CLI 而不是模拟，所以「只在 16:9 好看、竖版塌掉」这类改动会当场失败。

**测量本身踩过两个坑，都值得记：**

1. 主色统计最初用 4-bit 桶（`r >> 4`，桶底 `<< 4`），每个通道最多 15 级误差 —— 平坦背景被判成 100% ink，测量结果毫无意义。改成精确颜色 `key = (r<<16)|(g<<8)|b` 才准。
2. `ffmpeg` 在本机**完全不能创建文件**（`Error opening output … Permission denied`，OS temp 和 workspace 目录都失败）。所有取帧/取 raw 必须走 `-f rawvideo -pix_fmt rgb24 pipe:1` + `execFileSync(..., {maxBuffer: 64~128MB})`，需要文件时再由 Node 写。

**版式怎么补的**（不是把字号调大）：`AiClip.tsx` 的 `metricsFor(theme)` 成为单一真源，`wide = !theme.vertical` 决定 16:9 走两栏（左陈述 46% + 右承载物）还是竖版单列堆叠。每个镜头都画常驻骨架（四角定位括号 / 顶栏 `AIBENCH … NN/NN` / 底部进度条带镜头刻度），右栏按镜头种类换承载物：

- `hook` → `SpecPanel`：标题 + 时长/镜头数/画幅/节拍四行定义栅格
- 有 `steps` 的 `process` → `EvidencePanel`：逐条淡入的中英对照
- `cta` → `RecapPanel`：按顺序重述前面各条过程镜，最后一条加粗

最后一条是有意的设计判断：**只重复一句结论的收尾画面，观众什么也带不走**。`RecapPanel` 是「观众会截图分享的那一页」。

---

## 5. 子模型怎么选（你最关心的部分）

### 5.1 为什么需要「分角色选模型」
一条视频的生成被拆成 5 个不同性质的认知任务，用同一个贵模型是浪费：

| 角色 | 干什么 | 输入 | 输出 |
|---|---|---|---|
| `scriptWriter` | 一句话 → 中文脚本/字幕行 | brief + 模板约束 | 纯文本，每行 ≤14 字 |
| `shotPlanner` | 脚本 → 结构化分镜 JSON | 脚本 + schema | 严格 JSON（20 行内） |
| `styleAnalyst` | 参考文档/风格名 → 风格 token | 长文/URL/图片描述 | `{look, palette, font, motion}` |
| `visualQA` | 渲染出的 PNG → 版式问题 | 一张图 | `{ok, issues[]}` |
| `forgeAgent` | 造 Agent 对话 + 写包文件 | 目标 + 规范 | 文件树 |
| `router` | 判断该走哪条路 / 校验修复 JSON | 短文本 | 枚举/修复后 JSON |

### 5.2 路由表（基于本机 `list_models` 实测的可用模型与倍率）

| 角色 | 首选 | 倍率 | 为什么 | 兜底链 |
|---|---|---|---|---|
| `router` / JSON 修复 | `deepseek-account/deepseek-flash` | — | 最快最便宜，够用 | `workbuddy/deepseek-v4.1-flash` (x0.11) |
| `scriptWriter` | `workbuddy/deepseek-v4.1-flash` | **x0.11** | 中文文案质量够，成本是 pro 的 1/5 | `deepseek-account/deepseek-flash` → `workbuddy/glm-5.3-flash` (x0.08) |
| `shotPlanner` | `deepseek-account/deepseek-v4-pro` | 1.0(基准) | 结构化输出最稳，分镜错了整条废 | `workbuddy/glm-5.3-flash` (x0.08) → `workbuddy/kimi-k3.1-pro` (x0.97) |
| `styleAnalyst` | `workbuddy/kimi-k3.1-pro` | **x0.97** | 长文档/风格提炼强，长上下文 | `deepseek-account/deepseek-v4-pro` |
| `visualQA` | `workbuddy-vision/hy4free` | **x0.00** | 免费读图，看帧够了 | `workbuddy-vision/minimax-m3.1-flash` (x0.08) → `deepseek-account-vision/deepseek-flash` |
| `forgeAgent` | `deepseek-account/deepseek-v4-pro` | 1.0 | 要写多文件、守规范 | `workbuddy/kimi-k3-1` (x1.62，仅复杂包) → `workbuddy/glm-5.3` (x0.69) |

> 倍率来自 `workbuddy-vision` 的计价字段（x 值，相对基准）。`deepseek-account` 走你账号额度，不额外计费。

### 5.3 具体怎么调（实际实现的路径）

**落地时改掉了原方案的 `sessionController` 路线。** 原计划是「每个角色开一个会话、`selectModel` 后再 `prompt`」，实测两个问题：一是会话是有状态的、为一次 JSON 请求开会话要等它冷却，慢且重；二是面板请求期间用户可能正好在跟那个会话对话。最终直接走 `llm.stream`：

```js
const stream = llm.stream({
  provider: route.provider, model: route.model,
  messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
  system, temperature: 0.7, maxTokens, signal,
})
for await (const chunk of stream) {
  if (chunk.type === 'text-delta') text += chunk.text
  else if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
    failure = chunk.reason.failure ?? { message: 'model call failed', code: 'UNKNOWN' }
  }
}
```

`callLlmWithFallback()` 依次试 `LLM_ROUTES`（`index.js:137`）：

```js
const LLM_ROUTES = [
  { provider: 'workbuddy',        model: 'deepseek-v4.1-flash' },
  { provider: 'deepseek-account', model: 'deepseek-flash' },
  { provider: 'workbuddy',        model: 'glm-5.3-flash' },
  { provider: 'deepseek-account', model: 'deepseek-v4-pro' },
]
```

先 `llm.listProviders()` 过滤掉没挂载的 provider，再逐条试。`failure.code === 'TIMEOUT'` 立刻 break（用户已经在等，再等一条更慢的没意义）；其余失败（`QUOTA` / `ACCOUNT_QUOTA` / `RATE_LIMIT`）继续下一条。`GET /director/models` 会把这四条的真实可用性报给面板。

三个必做的兜底（全部已实现）：

1. **额度/限流自动换模型** —— 见上。实测四条全耗尽时（`RATE_LIMIT: 402 … 积分已耗尽 / ACCOUNT_QUOTA: Insufficient Balance`）整个创作台仍然可用，`director.source` 报 `local`。
2. **schema 校验优先于模型自检** —— `sanitizeDirectorPlan()` 把模型挑的 agent/template 收敛到真实存在的项上；`sanitizeScript()` 管脚本。不过就用本地 `localDirectorPlan()` / `localScript()` 兜底，**永不失败**。
3. **确定性兜底** —— 视觉 QA 不可用时不阻塞渲染，改用本地像素测量（见 4.8）。

### 5.4 不用的模型 / 明确不做的
- **不做 AI 生图 / 生视频**（`ali-vilab` 那些 text-to-video 一律不接）。画面全部由 Remotion 用代码画。这是 BN面板 的核心承诺，也是我们能 0 成本出片的原因。
- 首批**不做旁白配音**（BN面板 用 Kokoro + Whisper 本地跑，本机没这两个模型）。字幕走硬字幕烧进画面。旁白留到 v0.3，走 DSH 的 `llm` 语音能力或 SAPI。
- 不用 `kimi-k3-1`（x1.62）做常规任务，只在 Forge 生成复杂包时用。

### 5.5 成本估算（一条 60 秒片）
| 步骤 | 模型 | 约 token | 成本 |
|---|---|---|---|
| 脚本 | v4.1-flash | 2k in / 500 out | ~0.001 元 |
| 分镜 | v4-pro | 3k in / 800 out | ~0.02 元 |
| 视觉 QA ×3 帧 | hy4free | 3 图 | 0 元 |
| 渲染 | 本地 | — | 0 元 |
| **合计** | | | **< 0.03 元** |

对比 BN面板 1.5–5 元/条 —— 这就是「参数化 + 免费视觉模型」的差距。

---

## 6. 分阶段实施计划

每个阶段结束都有**可验收的产物**，你能一步步看着它长出来。

### S0 · 骨架可装（半天）
- [x] 建仓 `D:\AI\Vibe\AiBench`（monorepo 结构、MIT LICENSE、README、.gitignore）
- [x] `packages/aibench`：manifest + `cordis.patch.yml` + `icon.svg` + `locale/{zh,en}.json`
- [x] `index.js`：`apply` + 一条 `/aibench-api/panel/info` 路由 + 静态数据目录
- [x] `client.js`：侧栏图标 + 一个空面板（显示版本号）
- **验收**：`plugin_manager install_bundle` → DSH 侧栏出现 AiBench 图标 → 点开看到面板 → 杀掉重装不报 duplicate route ✅

### S1 · 创作台闭环（2–3 天）★核心
- [x] `packages/aibench/render`：装 4.0.542 依赖，写 `Root.tsx` + `AiClip.tsx` + 3 个 composition（16:9 / 9:16 / 1:1）
- [x] 模板库：9 个模板（3 个 Agent × 3）+ 参数表单
- [x] Projects CRUD + `planStoryboard()` 分镜 + 分镜表 UI
- [x] 单帧预览（still → PNG 回填）
- [x] 导出 MP4（Job + 进度条 + 完成后播放）
- **验收**：选模板 → 填参数 → 生成分镜 → 拖播放头看帧 → 导出 mp4，**同一个模板连跑 3 次，帧数/时长/字幕行数完全一致** ✅

### S2 · Agent 包体系（2 天）
- [x] manifest schema 校验器 + sha256 完整性 + 原子安装
- [x] 3 个内置 Agent 包（解说 / 品牌片头 / 数据），各 3 个模板
- [x] Agent 页：列表/安装/卸载/配置环境
- [x] SkillBridge：SKILL.md → `ctx.skills.register`
- **验收**：卸载再装不丢项目数据；主会话里能用 `@` 调到 Agent 的技能 ✅

### S3 · Forge 造 Agent（2 天）
- [x] Forge 向导 UI（选赛道 → 一句话目标 → 预览三个包文件 → 校验并安装）
- [x] 静态校验器（manifest/frontmatter/模板/未知 look；`renderFrame` 可选试渲一帧）
- [x] 脚手架确定性（`scaffoldAgentPackage()` 纯函数，两次调用逐字节相同）
- [x] 模型润色可选、离线降级（无 llm 时 `refined:false`，草稿照旧可用）
- [x] 安装闸门（`validateDraft()` 不过 → `409 invalid_draft`，半成品进不了 `AGENTS_DIR`）
- **验收**：在面板里造出一个新 Agent 包，装上去，用它的模板渲出一条片

### S4 · 双通道发布（1 天）
- [x] GitHub：用 `api.github.com` 建仓 + 推文件（`scripts/publish-github.mjs`，无需 git）→ `kakassq/AiBench`
- [x] 自包含单包：渲染引擎（`render/src` + `render/dist` + `render/public`）随插件一起发布，无跨包版本耦合
- [x] 真实 pnpm 安装验证（`scripts/check-installed-layout.mjs`）—— 这一步抓出了一个本地符号链接开发永远发现不了的致命 bug
- [ ] npm：**用户决定不发**（首创新包只接受 Classic Automation token，Granular 全部被拒；详见 7.2）
- [ ] 市场：写 `data/plugins/kakassq__AiBench.yml`，向 `awesome-dsh-plugin` 提 PR（需仓库创建满 1 天）
- [x] README 中英双语、安装命令、仓库结构、闸门清单
- **验收**：别人 `pnpm add` 能装、DSH 市场搜得到、GitHub 首页能看懂

---

## 7. 发布双通道的具体要求（已核实）

### GitHub
- 仓库名 `AiBench`（不同 owner 下可用，但与已有 AI 跑分项目重名，README 首行必须写清「DSH 视频创作面板」）
- 必须文件：`README.md`、`LICENSE`（MIT）、`package.json`（含 `dsh.bundle`）
- 必须加 topic：`dsh-plugin`（市场 CI 会查）
- 仓库创建满 **1 天**才能进市场（CI 自动校验）
- 本机无 git → 走 `api.github.com` 的 Contents API 逐文件推送，或你在网页建仓后我用 API 推

### npm（用户已决定不发；以下是实测结论，留档）
- 包名不能叫 `aibench`（已被占，`elnino0009_1` 的 AI 跑分工具）。最终用 **`dsh-aibench`**（`ai-bench` / `@aibench/dsh` / `aibench-panel` 也空着）。
- 必须 `dsh.bundle.patch` 存在（**只在 package.json 写 `dsh.client` 是不可安装的，市场会拒**）。
- **首创新包只接受 Classic Automation token。** 实测三次：
  | token 类型 | 结果 |
  |---|---|
  | Granular（只读） | `403 credentials` |
  | Granular（write + bypass_2fa） | `403 E_STAGE_REQUIRED` |
  | Classic Automation | 可用（自检：`curl -H "Authorization: Bearer npm_xxx" https://registry.npmjs.org/-/npm/v1/tokens`） |
- 发布脚本 `scripts/publish-npm.mjs` 已写（直接打 registry API，无需 npm CLI），随时可跑。

### DSH 插件市场
- 目标仓库：`awesome-dsh-plugin/awesome-dsh-plugin`
- 提交一个 YAML：`data/plugins/<owner>__AiBench.yml`
```yaml
url: https://github.com/<you>/AiBench
name: <you>/AiBench
category: ui
description:
  en: Local-first video studio panel that renders deterministic motion graphics without AI image or video generation.
  zh: 本地渲染的参数化视频创作面板，不生图不生视频，可自己造 Agent 技能包。
icon: https://cdn.jsdelivr.net/gh/<you>/AiBench@main/packages/aibench/icon.svg
```
- 注意：`raw.githubusercontent.com` 在本机被墙 → icon 用 **jsdelivr** 的 URL（实测可达）
- README 由脚本生成，**不要手改**

---

## 8. 六个待确认项（全部已定）

| # | 问题 | 结论 |
|---|---|---|
| Q1 | npm 包名（`aibench` 已被占） | **`dsh-aibench`**（用户拍板）。后因 token 限制决定不发 npm，但包名保留 |
| Q2 | 仓库 owner | **`kakassq`**（用户给了 GitHub token，`scripts/publish-github.mjs` 走 API 推） |
| Q3 | 首批赛道数量 | **3 个**（科普解说 / 品牌片头 / 数据可视化），9 个模板 |
| Q4 | 要不要旁白配音 | **不做**（本地无 Kokoro/Whisper），只做硬字幕；`features.voice: false` |
| Q5 | 面板形态 | **近全屏 overlay + 可收起左侧导航栏**（用户后来追加：5 栏 + 子栏目扩展接口） |
| Q6 | 发布节奏 | GitHub 已上线；npm 不发；市场 PR 待仓库满 1 天 |

**用户中途追加的三条要求（均已实现）：**

- `m00243`：「同时在 github 和 deepseek harness 两个插件市场都能发布」→ `dsh.bundle.patch` 齐全、topic `dsh-plugin`、`docs/marketplace-entry.yml` 草案就位。
- `m01936`：「主面板内可隐藏左侧导航栏」→ `.abx-nav[data-collapsed]` 收成 46px 图标条。
- `m01938`：「预留子栏目扩展接口」→ `registerSection()` / `listSections()` 导出 + `check-sections.mjs` 守着。

---

## 9. 风险与对策（回填实测结果）

| 风险 | 概率 | 实际发生了什么 |
|---|---|---|
| Remotion 首装慢（810MB 依赖） | 高 | 复用 pnpm store，装得下（D 盘剩 230 GB）。渲染引擎进插件包内部，随包发布 |
| 模型输出 JSON 不稳 | 高 | 真发生了：四条路由全部额度耗尽过。`localDirectorPlan()` / `localScript()` 兜底顶住了，面板全程可用 |
| 面板里进度不可见（BN面板 的老毛病） | 中 | ProgressHub + 2 秒轮询，Task 页有进度条。**PR 里要提这一条** |
| 中文 props 命令行崩溃 | 中 | `--props` 一律写文件，从未传字符串 |
| 重装插件 duplicate route | 中 | `ctx.effect(() => server.register(...))` 包住，反复 reload 无异常 |
| 无 git 导致发布困难 | 高 | `publish-github.mjs` 走 Git Data API，实测可推（98 文件 / 7.3 MB） |
| 与已有 `AIBench` 跑分项目混淆 | 中 | README 首行定调「本地渲染的参数化视频创作面板」，npm 包名 `dsh-aibench` 避开 |

**原表里没有、实际撞上的两个风险：**

| 风险 | 后果 | 对策 |
|---|---|---|
| **`pnpm` 的依赖布局和本地符号链接不一样** | 装得好好的环境里渲染引擎「找不到」，`503 render_unavailable`。本地开发**永远发现不了** | `resolveRenderCli()` 试四个候选路径；`check-installed-layout.mjs` 用真实 tgz 安装布局验证 |
| **画面稀疏但所有测试都绿** | 出片成功、时长正确、字幕正确，但评审判为「75% 空白、不可发布」 | 三个测量脚本 + `check-layout.mjs` 进闸门（见 4.8） |

---

## 10. 现在完成了什么 / 下一步

**已完成（S0–S4 除 npm 发布外全部）：**

- 15 道闸门全绿（`pnpm check`）
- 内含 3 个内置 Agent / 9 个模板 / 5 栏导航 / Forge 造 Agent / SkillBridge / 脚本层 / 版式系统
- 故宫 30 秒片：900 帧 / 1920×1080 / 30.000s / 3.76 MB，评审「balanced, finished, professional」
- GitHub `kakassq/AiBench` 已上线（commit `a162b6d9`）

**待办：**

1. 向 `awesome-dsh-plugin` 提 PR（`docs/marketplace-entry.yml` 已就绪，需仓库创建满 1 天）
2. 旁白配音（v0.3，需本地 TTS 或 DSH 语音能力）
3. 更多赛道模板（当前 3 个 Agent × 3 模板，扩展点已留）
