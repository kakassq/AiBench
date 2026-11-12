# AiBench 总方案（v1 · 待用户确认）

> 目标：做一个对标 BN面板（npm `bnpanel`）的 DSH 插件平台，但**开源、免费、参数化、可自己造 Agent**。
> 交付形态：一个 GitHub 仓库 `AiBench` + 一个可装进 DSH 的 bundle 插件 + 可发布到 DSH 插件市场。
> 本文件是执行前的唯一蓝图。确认后才动工。

---

## 0. 先说三个事实（纠正三个前提）

1. **GitHub 上没有 bnpanel。** 搜 `bnpanel` 全是 2015 年 PHP 主机计费系统的无关项目。它是闭源商业产品（npm 包 `bnpanel`，author `Biunow`，license `UNLICENSED`，2026-10-29 首发，当前 0.6.3）。
   → 逆向只能靠拆 npm tarball。已拆：`D:\AI\Vibe\.tmp\bnpanel\package\`（index.js 10596 行 esbuild bundle + client.js 1877 行）。
2. **本机没有 git、没有 gh、没有 npm 命令。** 有 node v24.21.0 / pnpm 11.28.5（bundled 运行时）。
   → 发布 GitHub 只能走 `api.github.com`（实测通，1.9s），或你在网页上手动建仓；npm 发布用 pnpm + token。
3. **`aibench` 这个 npm 包名已被占用**（elnino0009_1，AI 跑分基准工具）。GitHub 上 `steipete/aibench`、`RedisAI/aibench`、`ali-vilab/AIBench` 也都存在，社区里 `AIBench` 多指「AI 跑分」。
   → 仓库名可以仍叫 `AiBench`，但 npm 包名、README 标题必须做区分（见 §8 待确认项 Q1）。

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

### 3.2 目录结构（monorepo）

```
D:\AI\Vibe\AiBench\
├─ package.json                    # workspace 根，private
├─ README.md / LICENSE (MIT) / .gitignore / .gitattributes
├─ docs\
│  ├─ 00-product.md                # 产品定位与对标分析
│  ├─ 01-architecture.md           # 本文件的技术细节版
│  ├─ 02-api-contract.md           # /aibench-api 全量接口
│  ├─ 03-agent-package-spec.md     # Agent 包规范（manifest schema）
│  └─ 04-roadmap.md
├─ packages\
│  ├─ aibench\                     # ★ 可分发的 DSH bundle
│  │   ├─ package.json             # 带 dsh.bundle + dsh.client
│  │   ├─ cordis.patch.yml
│  │   ├─ index.js                 # Host 半部（预计 2000~2500 行）
│  │   ├─ client.js                # Client 半部（预计 1500~2000 行）
│  │   ├─ client.css
│  │   ├─ locale\{zh.json,en.json}
│  │   ├─ icon.svg
│  │   └─ README.md
│  ├─ render\                      # Remotion 渲染工程（随插件发布）
│  │   ├─ src\{index.ts,Root.tsx,BnClip.tsx,storyboard.ts,theme.ts}
│  │   ├─ compositions\            # 每个风格一个组件
│  │   ├─ public\audio\{bgm,sfx}
│  │   └─ package.json
│  └─ agents\                      # 内置 Agent 包（3 个）
│      ├─ aibench-explainer\       ├─ aibench-reel\       └─ aibench-motionlab\
└─ scripts\
   ├─ build-panel.mjs              # 可选：打包成单文件（发布用）
   └─ publish.mjs                  # 发布体检（无 git 环境用 API）
```

> **为什么 `packages/aibench` 单独可分发**：DSH 插件市场要求被收录仓库的 `package.json` 声明 `dsh.bundle`。monorepo 可以收录子包（`name: owner/repo#aibench`），但更稳的做法是把 `packages/aibench` 作为主入口，根 `package.json` 也带一份 `dsh` 字段指向它（双保险）。

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

无构建步骤：`window.__ModuleLoader__.load({ id: '@aibench/dsh', factory(require) { ... } })`，只用 `require('react')`，全 `React.createElement`（`h(...)`）。
- 侧栏入口：往 `@deepseek-ai/dsh-client-ui-workspace` 的 sidebar 插槽注册一个图标 + 文案（走 locale 服务，`zh.json`/`en.json`）。
- 主面板：`shell.overlay` 近全屏容器，可关闭。
- 所有请求走相对路径 `/aibench-api/*`，**每次 fetch 独立 try/catch**，失败变顶部 notice，绝不让一个接口 500 把整个面板打白。

### 3.5 数据模型

```ts
Agent { id, name, version, description, icon, tracks[], skills[], templates[],
        path, installedAt, versions[] }          // 版本快照存在 <pkg>/.versions/<v>/

Template { id, agentId, title, track,        // 赛道 id，如 'explainer'
           brief, durationSec, aspect,       // '16:9' | '9:16'
           style { look, palette{bg,fg,accent}, font, motion },
           audio { bgm{mood,bpm}, sfxSet, voice{mode}, subtitles{kind} },
           beatMap { rule, notes },
           params /* 表单 schema */ }

Project { id, title, templateId, agentId, params, status,
          status: 'draft'|'briefing'|'storyboard'|'rendering'|'done'|'failed',
          storyboard, outputs{ stills[], video, audio },
          jobId, brief, createdAt, updatedAt }

Job { id, kind:'still'|'render'|'forge', progress 0..100, logs[], ok?, error?, startedAt }

Storyboard { fps:30, totalFrames, shots: Shot[] }
Shot { id, kind:'hook'|'process'|'cta', startFrame, frames, steps[], caption{zh,en} }
```

持久化：纯 JSON 文件（`settings.json`、`agents.json`、`projects.json`、`projects/<id>/project.json`），不用数据库。

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

这一层**不调模型**。模型只在「把用户的一句话变成更好的一句话 / 把长文压成字幕行」时使用。

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

### 5.3 具体怎么调（代码路径）
```js
// SessionBridge 内部
async function runRole(role, { cwd, prompt }) {
  const spec = MODEL_ROUTES[role]                 // 见上表
  const { sessionId } = await sc.create({ cwd })  // sessionController.create
  try {
    await sc.selectModel({ sessionId, provider: spec.provider, model: spec.model },
                         AbortSignal.timeout(10_000))
  } catch { /* 模型不可用 → 用 profile 默认 */ }
  await sc.prompt({ sessionId, requestId: randomUUID(), mode: 'queue',
                    content: [{ type: 'text', text: prompt }] }, AbortSignal.timeout(60_000))
  const { reason, output } = await sc.wait({ sessionId, timeoutMs: ROLE_TIMEOUT[role] },
                                           AbortSignal.timeout(ROLE_TIMEOUT[role] + 5_000))
  const text = extractText(output.records)         // 取最后一个 assistant message
  return { text, reason }
}
```
三个必做的兜底：
1. **429 自动换模型**：`wait` 返回 idle 但零 token 输出，且 events 里 `finish.reason.failure.code === 'QUOTA'` → 从 FALLBACK 链取下一个 `selectModel` 重试（vibemotion-studio 已踩过这个坑，逻辑可照抄）。
2. **schema 校验优先于模型自检**：`shotPlanner` 的输出必须过本地 JSON Schema，不过就带上错误重问一次，还不过就用 `planStoryboard()` 的默认分镜（永不失败）。
3. **确定性兜底**：`visualQA` 不可用时，用「本地像素检查」（对比度 `contrastRatio`、文字溢出估算）替代，不阻塞渲染。

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
- [ ] 建仓 `D:\AI\Vibe\AiBench`（monorepo 结构、MIT LICENSE、README、.gitignore）
- [ ] `packages/aibench`：manifest + `cordis.patch.yml` + `icon.svg` + `locale/{zh,en}.json`
- [ ] `index.js`：`apply` + 一条 `/aibench-api/panel/info` 路由 + 静态数据目录
- [ ] `client.js`：侧栏图标 + 一个空面板（显示版本号）
- **验收**：`plugin_manager install_bundle` → DSH 侧栏出现 AiBench 图标 → 点开看到面板 → 杀掉重装不报 duplicate route

### S1 · 创作台闭环（2–3 天）★核心
- [ ] `packages/aibench/render`：装 4.0.542 依赖（复用 vibemotion-video 的 pnpm store），写 `Root.tsx` + `AiClip.tsx` + 2 个 composition
- [ ] 模板库：3 个手写模板（瑞士排版 / 蓝图 / CRT 终端）+ 参数表单
- [ ] Projects CRUD + `planStoryboard()` 分镜 + 分镜表 UI
- [ ] 单帧预览（still → PNG 回填）
- [ ] 导出 MP4（Job + 进度条 + 完成后播放）
- **验收**：选模板 → 填参数 → 生成分镜 → 拖播放头看帧 → 导出 mp4，**同一个模板连跑 3 次，帧数/时长/字幕行数完全一致**

### S2 · Agent 包体系（2 天）
- [ ] manifest schema 校验器 + sha256 完整性 + 原子安装
- [ ] 3 个内置 Agent 包（解说 / 品牌片头 / 动效实验室），各 ≥3 模板
- [ ] Agent 页：列表/安装/卸载/更新/回滚
- [ ] SkillBridge：SKILL.md → `ctx.skills.register`
- **验收**：卸载再装不丢项目数据；回滚到旧版本能正常渲染；主会话里能用 `@` 调到 Agent 的技能

### S3 · Forge 造 Agent（2 天）
- [ ] Forge session + 4 步向导 UI
- [ ] 静态校验器（manifest/frontmatter/模板/试渲染一帧）
- [ ] 「从模板复制一份」快速起步
- **验收**：在面板里对话造出一个新 Agent 包，装上去，用它的模板渲出一条片

### S4 · 双通道发布（1 天）
- [ ] npm：改 `publishable` 字段、`pnpm publish --access public`（需要 npm token）
- [ ] GitHub：用 `api.github.com` 建仓 + 推文件（需要 GitHub token）或你手动建仓我推
- [ ] 市场：写 `data/plugins/<owner>__AiBench.yml`，向 `awesome-dsh-plugin` 提 PR
- [ ] README 中英双语、演示 GIF、安装命令
- **验收**：别人 `pnpm add` 能装、DSH 市场搜得到、GitHub 首页能看懂

---

## 7. 发布双通道的具体要求（已核实）

### GitHub
- 仓库名 `AiBench`（不同 owner 下可用，但与已有 AI 跑分项目重名，README 首行必须写清「DSH 视频创作面板」）
- 必须文件：`README.md`、`LICENSE`（MIT）、`package.json`（含 `dsh.bundle`）
- 必须加 topic：`dsh-plugin`（市场 CI 会查）
- 仓库创建满 **1 天**才能进市场（CI 自动校验）
- 本机无 git → 走 `api.github.com` 的 Contents API 逐文件推送，或你在网页建仓后我用 API 推

### npm
- 包名不能叫 `aibench`（已占用）。可选：`ai-bench` / `dsh-aibench` / `@aibench/dsh`（需确认）
- 必须 `dsh.bundle.patch` 存在（**只在 package.json 写 `dsh.client` 是不可安装的，市场会拒**）
- 发版：`pnpm publish --access public --registry https://registry.npmjs.org/`
- 需要：`NPM_TOKEN`（你现在没有 `.npmrc`）

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

## 8. 需要你拍板的 6 件事

| # | 问题 | 我的建议 |
|---|---|---|
| Q1 | npm 包名（`aibench` 已被占） | `ai-bench`（最短、最像正式名）；备选 `dsh-aibench` |
| Q2 | 仓库 owner | 你的 GitHub 用户名（需要你给 token 或手动建仓） |
| Q3 | 首批赛道数量 | 先做 **3 个**（科普解说 / 品牌片头 / 数据可视化），跑通再加 |
| Q4 | 要不要旁白配音 | 首批**不要**（本地无 Kokoro/Whisper），只做硬字幕；v0.3 再加 |
| Q5 | 面板形态 | 近全屏 overlay（跟 vibemotion-studio 一致），不用新窗口 |
| Q6 | 发布节奏 | S1 结束就先发一次 GitHub（拿到仓库 1 天冷却期），S2 后再发 npm |

---

## 9. 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| Remotion 首装慢（810MB 依赖） | 高 | 复用 `D:\AI\Vibe\vibemotion-video\node_modules` 的 pnpm store；或直接复制该 node_modules |
| 模型输出 JSON 不稳 | 高 | 本地 schema 校验 + 一次重问 + `planStoryboard()` 兜底 |
| 面板里进度不可见（BN面板 的老毛病） | 中 | ProgressHub + 轮询，进度写进 Job 并推给前端 |
| 中文 props 命令行崩溃 | 中 | `--props` 一律写文件，不传字符串 |
| 重装插件 duplicate route | 中 | `ctx.effect` 包住 `register` |
| 无 git 导致发布困难 | 高 | 走 GitHub API；S1 结束就建仓拿冷却期 |
| 与已有 `AIBench` 跑分项目混淆 | 中 | README 首行定调，npm 包名避开 `aibench` |
