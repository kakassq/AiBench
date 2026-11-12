# dsh-aibench

AiBench 创作台 — 一个 DeepSeek Harness 面板插件。不生图、不生视频，画面全部由 Remotion 用代码逐帧绘制。

**本地渲染 · 参数化 · 可复现 · 0 渲染成本**

## 装什么

装上之后 DSH 侧栏出现 **AiBench 创作台** 图标，点开是主控面板。面板内左侧是可收起的导航栏，四栏：

| 导航 | 内容 |
|---|---|
| Agent 智能体 | Agent 卡片墙：三张内置卡（Explainer / Reel / Data），每卡显示版本、赛道、模板数、技能数，动作：配置环境 / ▶ 打开创作台 / 卸载；头部可「＋ 安装智能体」与「✨ 一键成片」；下方是最近项目 |
| Studio 工作室 | 按 Agent 挑模板开工，或点最近项目继续 |
| Task 任务 | 渲染任务队列（单帧与成片），运行中显示进度条，2 秒自动刷新 |
| Setting 设置 | 数据/智能体/项目目录、渲染引擎与 CLI 路径、版本与平台；界面语言切换（中文 / English，立即生效并写入 settings.json） |

底栏常驻：智能体数、模板数、项目数、渲染引擎状态、数据目录。

点「打开创作台」进入某个 Agent 的 **Studio** 三栏工作台（此时左侧导航栏让位给三栏布局，面包屑「← 创作台」可退回）：

| 栏 | 内容 |
|---|---|
| 左 | 模板列表 + 七槽位参数（look / 配色 / 时长画幅 / BPM / 字幕 / 分镜顺序） |
| 中 | 真实 Remotion 帧预览 + 播放头 + 分镜表（每镜起点卡在拍上） |
| 右 | AI 助手：说一句话，助手挑模板、定风格，直接排队出片（`POST /director`）。渲染进度与成片预览就在输入框下方 |

改任一参数会立刻用**同一帧**重渲 still，所见即所得。

## 一键成片

面板右上角「✨ 一键成片」或在 Studio 右栏输入一句话，两种选片方式：

- **参考模板** — 助手读你的字面要求（时长、画幅、节奏、风格、字幕）后挑最贴近的模板
- **随机** — 同一句话每次给你不同的模板（按 prompt 哈希取，可复现）

Host 侧的 `POST /director` 按顺序尝试 `LLM_ROUTES` 里的模型（`workbuddy/deepseek-v4.1-flash` → `deepseek-account/deepseek-flash` → `workbuddy/glm-5.3-flash` → `deepseek-account/deepseek-v4-pro`），要求模型只回 JSON，再用 `sanitizeDirectorPlan` 把结果收敛到真实存在的 agent / template 上。

**模型通道不可用时不会失败**：`localDirectorPlan` + `promptHints` 用正则从你的句子里直接抠出时长/画幅/BPM/风格/字幕，本地挑片。返回里的 `director.source` 告诉你这次是 `llm` 还是 `local`，UI 上显示「AI 选片」或「本地兜底」。

生成后立刻自动排队渲染 preview MP4，出片后右栏出现 `<video>`。

## 技能桥（SkillBridge）

每个 Agent 包里的 `skills/<dir>/SKILL.md` 会被 Host 扫描，并按 frontmatter 注册进 DSH 的 `skills` 服务：

```markdown
---
name: data-run
description: 数据故事的流水线：抛数 → 拆结构 → 找异常 → 给结论
---
```

- **模型侧名字**取 frontmatter 的 `name`（必须 kebab-case），所以对话里用 `@data-run` 就能调到。
- **面板侧 id** 是命名空间化的 `aibench:<agentId>:<name>`，永远不会遮蔽 DSH 自带技能或别的插件的技能。
- 安装 / 卸载 Agent 后自动 `syncSkills()`：新包带来的技能立刻出现在目录里，卸载掉的**立刻消失**（先 dispose 旧注册再重扫，否则目录会继续服务已删的技能）。
- `skills` 服务不存在时（旧 Host / 未挂载的 preset）整体降级为 no-op，面板自己的 `GET /skills` 仍可用。

### 默认技能：不用手点

每个 Agent 有一个**默认技能**，执行时自动生效：

- 解析顺序：`config.skill`（显式选择）→ 该 Agent 只带一个技能时自动绑定它 → 都没有则不绑定。
- **多技能且未显式选择时不猜** —— 静默跑错流水线比问一句更糟。
- `config.skill` 指向的技能被更新改名/删掉时，**不返回 null**，而是回落到单技能规则，避免一次包升级把 Agent 弄哑。
- Studio 右栏顶部把绑定的技能标成「默认技能 · @name」并打「自动」标签；其余技能仍可点，是"这句话确实想换条流水线"时的逃生口。
- `POST /director` 会把这个技能写进项目的 `origin.skill`，并在响应里返回 `director.skill`，所以事后能回答"这次为什么走了这条流水线"。
- 导演 prompt 里会注入**每个 Agent 的绑定流水线正文**（每个上限 1800 字符）——模型在自己那一轮才选 Agent，提前把配方给它，才能做到"说一句话就按该 Agent 的流水线出片"而不需要第二次往返。

## 模板 → 渲染参数

模板有两套描述同一支片的语言：给人/模型看的富描述符（`style.look`、`style.palette`、`style.rhythm`、`audio.subtitles.kind`、`audio.voice.mode`）和给渲染器看的数字 `defaults`。

`templateParams(template)` 把描述符翻译成索引（look 名 → `LOOK_IDS` 下标，palette 名 → `PALETTES` 下标，`rhythm` → `beatBpm`，`subtitles.kind` → `subtitle`，`voice.mode` → `voice`）；`templateDefaults(template)` 返回 `{ ...templateParams(tpl), ...tpl.defaults }`。

合并顺序是有意的：**描述符补齐，defaults 拍板**。模板里写了 `look: 'terminal-crt'` 却没写 `style: 2`，以前会静默退回 `normalizeParams` 的默认风格；现在描述符会把它补上。反过来，`defaults` 是人工校准过的，两者冲突时它赢。

`LOOK_IDS` / `PALETTE_NAMES` 必须与 `aibench/render/src/storyboard.ts` 的表保持同序 —— `scripts/check-templates.mjs` 会 import 两边做全等断言，顺序漂移直接失败。

## 字幕

`subtitle` 为 `zh` / `en` / `bilingual` 时，`planStoryboard` 给每个镜头写 `shot.caption`（以及 `bilingual` 用的 `shot.en`），`Captions` 把它画在底部字幕带。

- `Captions` **只认 `shot.caption`**，绝不回落到 `shot.copy`：大标题是版面元素（会截断），字幕是旁白句子，把标题复读一遍当字幕是错的。
- 所以旁白必须由 `planStoryboard` 自己产出。漏掉这一步时字幕会**静默消失** —— 不报错、不告警、视频照常出片。`scripts/check-timeline.mjs` 现在把「有字幕模式必须每镜有 caption、none 模式必须没有」当不变量守着。
- Host 供给的 storyboard（`props.storyboard`）里的 `caption` 优先，脚本层可以逐镜覆盖。

## 子智能体的安装 / 卸载 / 配置

卡片墙的动作都走真实 Host 路由：

| 动作 | 路由 | 说明 |
|---|---|---|
| 安装（内置） | `POST /agents/install` `{id}` | 从插件自带 `agents/` 重新播种 |
| 安装（本地目录） | `POST /agents/install` `{path}` | 校验源目录有合法 `manifest.json` 后整包复制 |
| 卸载 | `POST /agents/:id/uninstall` | 删目录、更新索引；**已建项目保留** |
| 配置环境 | `GET|PUT /agents/:id/config` | 见下 |

配置写在 `<AGENTS_DIR>/<id>/config.json`：

```json
{ "provider": "", "model": "", "skill": "reel-run", "env": { "MY_KEY": "value" }, "defaults": {} }
```

`env` 会合并进渲染子进程的环境变量（`runRemotion` 的第 4 个参数），所以 Agent 需要的 API key、字体路径、地区变量都可以在这里配。`skill` 是这个 Agent 的默认技能（写 `name`，留空表示按单技能规则自动绑定）。重装同一个 Agent 会**保留**这份 config。

`GET|PUT /agents/:id/config` 同时返回 `skills: agentSkillBindings(id)`，每项带 `default` 布尔，弹层据此渲染"哪个技能是自动的"，不用二次请求。

## 扩展新的子栏目

左侧导航栏是数据驱动的，`SECTIONS` 是唯一的真源。client 模块对外导出两个函数：

```js
const aibench = require('dsh-aibench')

aibench.registerSection({
  id: 'store',              // 唯一 id，重复注册返回 false（幂等）
  labelKey: 'navStore',     // i18n key；找不到时回落到 id
  icon: 'agents',           // 内置图标名：agents / studio / tasks / settings / 自定义
  render(ctx) {             // 省略则回落到内置页
    // ctx = { store, t, panel, agents, projects, jobs, settings,
    //         openAgent, openProject, refresh }
    return React.createElement('div', { className: 'abx-page' }, '…')
  },
})

aibench.listSections()      // 返回副本，改它不会影响导航栏
```

新栏目立刻出现在导航栏，收起态自动只显示图标。自建页面复用 `.abx-page` / `.abx-table` / `.abx-row` / `.abx-kv` 这些类即可与内置页视觉一致。

`scripts/check-sections.mjs` 是这个 API 的回归测试（假 module loader 加载 client.js 后断言行为）。

## Host 与 Client

Host 半部在 `/aibench-api` 上注册**一个前缀路由**，所有面板数据都从这里出：

```
GET  /panel/info | /panel/health | /panel/settings (GET|PUT)
GET  /agents | /templates?agentId=&track=&q=
GET  /agents/available                  → 内置包里还没装的
POST /agents/install                    → {id} 或 {path}
POST /agents/:id/uninstall
GET|PUT /agents/:id/config              → {provider, model, skill, env, defaults} + skills[]
GET  /director/models                   → 可用模型通道
POST /director                          → {prompt, mode:'template'|'random'} → project + storyboard
GET|POST /projects     GET|PATCH|DELETE /projects/:id
GET  /projects/:id/storyboard
POST /still              → 单帧 PNG（3–6 秒）
POST /projects/:id/render → 任务化，立即返回 jobId
GET  /jobs               → 任务队列，新到旧
GET  /jobs/:id
GET  /skills             → 已装 Agent 的 SKILL.md 清单（含 @ 句柄与 default 标记）
POST /skills/sync        → 手动重扫并重新注册到 DSH 技能库
GET  /media/:projectId/:fileName
```

Client 半部通过 DSH module loader 加载，注册两个 slot：

- `sidebar.panellist`，`id: 'aibench'` — 纯图标（侧栏自己包按钮，label 从 locale 取）
- `main`，`key: 'aibench'` — 主面板。**两个 id 必须一致**：点侧栏条目时 shell 会执行 `layout.selectPanel(<id>)`，key 不匹配会抛 `main panel "..." is not registered`。

## 安装

```bash
# 本仓库目录直接装进 DSH
plugin_manager action=install_bundle target=<绝对路径>/packages/aibench

# 发布后
pnpm add dsh-aibench
```

## 内置 Agent

三个包随插件分发（`agents/`），首次 `apply()` 时幂等播种到数据目录——已存在的目录不覆盖，所以你改过的不会被冲掉。

每个包 = `manifest.json` + `skills/<id>/SKILL.md` + `templates/*.template.json`：

| Agent | 赛道 | 默认画幅 | 模板 |
|---|---|---|---|
| aibench-explainer | 0 / 1.6 | 16:9 | 熵增 / 贝叶斯 / 阈值 |
| aibench-reel | 1.1 / 1.4 / 1.5 | 9:16 | 字标 / 卡点倒数 / 三点卖点 |
| aibench-data | 1.3 | 16:9 | 三个数字 / 增长曲线 / 结构拆分 |

## 数据放在哪

`<DSH profile>/aibench/`：

```
agents/          已安装的 Agent 包
agents.json      安装索引
projects/        项目（每个项目一个目录，含 project.json 与 outputs/）
forge/           造 Agent 会话的草稿
settings.json    面板设置
```

项目数据与插件代码分离，卸载插件不会删你的片子。

## 渲染引擎

`/panel/info` 会报告 `render.available`。它检查 `render/node_modules/@remotion/cli/remotion-cli.js` 是否存在：

- **true** — 本机已装 Remotion，可以预览帧、导出 MP4
- **false** — 面板照常可用（浏览模板、管项目、改参数），但预览与导出会提示先装依赖

在 monorepo 里跑 `pnpm install` 后该项即为 true。从 npm 单独安装本插件不会带上渲染引擎（它体积大、且与本机平台相关），这是有意为之：面板永远能打开，渲染是可选能力。

## 边界

- 不做 AI 生图 / 生视频，不调用任何图像或视频生成 API
- 不依赖 GPU，不依赖云服务
- 只接受本机同源请求（`isTrustedRequest` 校验 `sec-fetch-site`、`host`、`origin`）
- 没有付费闸门、没有账号体系、没有遥测

## 许可证

MIT
