# AiBench

> 本地渲染的参数化视频创作面板 · 一个 DeepSeek Harness 插件
> A local-first parametric video studio panel for DeepSeek Harness.

**不生图、不生视频。** 画面全部由 Remotion 用代码逐帧绘制：矢量排版、图表推演、ASCII/CRT、动态字体、一笔画。
不依赖 GPU，不调用任何图像/视频生成 API，整条片子在本机渲染，**可复现、可参数化、0 渲染成本**。

---

## 它解决什么

把「一句话」变成一条能交付的短视频，中间的每一步都**看得见、改得动、存得下**：

| 步骤 | 传统做法 | AiBench |
|---|---|---|
| 写脚本 | 丢给大模型自由发挥 | 模型只写词，**版式由本地纯函数决定**；每行硬上限，越界就换行不缩字 |
| 分镜 | 模型输出不可控 | 本地纯函数 `planScriptedStoryboard()` 算，同输入必同输出 |
| 预览 | 整条渲完才知道好不好 | 改一个参数，**单帧 PNG 立刻重出** |
| 渲染 | 云端排队、按条付费 | 本机 Remotion，0 元 |
| 进度 | 去别处看日志 | **面板内进度条 + 分镜表 + 产物归档** |

## 形态：主控面板 + 子 Agent

面板不是一个大表单，而是**主控面板内一个可收起的左侧导航栏 + 一张 Agent 卡片墙**：

| 导航 | 内容 |
|---|---|
| **Agent 智能体** | Agent 卡片墙（见下表）+ 最近项目；头部「＋ 安装智能体」与「✨ 一键成片」，每张卡可配置环境 / 打开创作台 / 卸载 |
| **Studio 工作室** | 按 Agent 挑模板开工，或继续最近的项目 |
| **Forge 造 Agent** | 一句话造一个自己的智能体：选赛道 → 填目标 → 预览三个包文件 → 校验 → 安装 |
| **Task 任务** | 渲染任务队列：单帧 / 成片、进度条、产物链接，2 秒自动刷新 |
| **Setting 设置** | 数据与项目目录、渲染引擎与 CLI 路径、版本与平台、界面语言（中文 / English，立即生效） |

导航栏可收起成 46px 的图标条。**它是数据驱动的**——`SECTIONS` 是唯一真源，client 模块对外导出 `registerSection()` / `listSections()`，新子栏目注册即出现在导航栏（详见 `packages/aibench/README.md`）。

每个 Agent 是一套独立的动效语言，带自己的模板、技能和默认参数：

| Agent | 赛道 | 语言 |
|---|---|---|
| **AiBench Explainer** | 0 / 1.6 | 硬核概念科普：瑞士动态排版、蓝图推演、终端 CRT。横版 16:9，双语硬字幕 |
| **AiBench Reel** | 1.1 / 1.4 / 1.5 | 字标起手、几何推进、卡点切镜。竖版 9:16 / 方版 1:1，每格 2 秒 |
| **AiBench Data** | 1.3 | 三个数字、一句结论：图表推演与信息图叙事。横版 16:9 |

点「打开创作台」进入该 Agent 的 **Studio** 三栏工作台（此时导航栏让位给三栏，面包屑可退回）：

- **左** — 模板列表 + 七槽位参数（风格 look / 配色 / 时长画幅 / BPM / 字幕 / 分镜顺序）
- **中** — 大预览（真实 Remotion 帧）+ 播放头 + 分镜表（每镜起点卡在拍上）
- **右** — AI 助手：说一句话，挑模板定风格，**直接排队出片**（进度条与成片预览在输入框下方）

Agent 页下方还有**最近项目**列表，点一条直接回到那个项目的 Studio，不用重选模板。

## 一键成片

「✨ 一键成片」把一句话变成一条 mp4：Host 调模型（4 条通道依次兜底）挑 Agent 与模板，把结果收敛到真实存在的模板上，生成分镜后**自动排队渲染**。

模型通道全部不可用时也不会失败——本地用正则从你的句子里抠出时长、画幅、BPM、风格、字幕，按字面要求挑片。返回里的 `director.source` 标明这次是 `llm` 还是 `local`，面板上显示「AI 选片」或「本地兜底」。

### 两次模型调用，而不是一次

选片和写词是**两个独立请求**。合成一次的话，模型要在一个回复里既挑模板又写完六个镜头的文案，实测会被 `maxTokens` 截断在第 3–4 镜，然后整条片子回落到模板套话。

第二步写脚本时约束很硬（`scriptPrompt()` 原文）：3–8 个镜头、首 `hook` 尾 `cta`、`copy` ≤34 字、`process` 必须给 2–4 个 `steps`、`weight` 1–6、**不许编造事实/数字/日期/引文**、禁止「让我们开始 / 敬请期待 / 以上就是」这类填充句。

### 脚本决定时长和版式

`planScriptedStoryboard()` 先跑一遍 `planStoryboard()` 复用全部非镜头决策（配色、look、拍点网格、字幕模式），再用脚本的 `weight` **按比例分配帧数**（最大余数法，保证 `sum === totalFrames`），最后把边界吸附到拍上。三条不变量由 `check-timeline.mjs` 全量守着：首镜从 0 开始、相邻镜首尾相接、末镜正好结束在 `totalFrames`。

装不下的脚本会被**截断**而不是压缩：`shots × MIN_SCRIPT_SHOT_FRAMES(24)` 超过总帧数时砍掉尾部镜头。缩到 6 帧的镜头一闪而过，观众只会觉得是渲染故障。

`sanitizeScript()` 是模型输出的闸门：非对象 / 未知 kind / 空 copy 直接丢；`process` 少于 2 个 step 的整镜丢掉（一个标题底下孤零零一行，读起来像做错了）；首镜不是 `hook` 就补一个，末镜不是 `cta` 就补一个。全空了才回落 `localScript()`。

文案层可以单独重写而不动画面：`POST /projects/:id/script`。挑错模板是「片子形状错了」，写错词是「形状对了词错了」——后者不该逼用户重选模板。

## 画面密度：把「不好看」变成数字

第一版渲染出来的帧被评审判为 *"approximately 75% of the frame is empty background… unbalanced… sparse and unfinished as a published motion-graphics frame"*。这话对，也**无法复现**——所以它变成了三个测量脚本：

| 脚本 | 量什么 | 阈值 |
|---|---|---|
| `frame-density.mjs` | 每帧的 ink（与主色差 >24）与 **read ink**（>150，只算真正可读的字）、6 条横带的分布、内容包围盒 | 人工看数 |
| `safe-area.mjs` | 到四边最近的 strong-ink 距离 | `min(w,h) × 0.012`，低于即 BLEED |
| `check-layout.mjs` | 3 画幅 × 4 帧，真 Remotion CLI 渲出来逐帧断言 | read ≥ 0.9%、6 带中 ≥4 带有墨、四边 ≥ 1.2% |

`check-layout.mjs` 是第 15 道闸门：它跑真 CLI，所以「只在 16:9 好看、竖版塌掉」的版式改动会当场失败。

密度靠**常驻骨架**补齐，不靠把字号调大：四角定位括号、顶栏（`AIBENCH` / 渐隐横线 / `NN / NN`）、底部进度条（带镜头刻度），加上每种镜头一个右栏承载物——`hook` 给 `SpecPanel`（标题/时长/镜头数/画幅/节拍），有 `steps` 的 `process` 给 `EvidencePanel`（逐条淡入的中英对照），`cta` 给 `RecapPanel`（按顺序重述过程镜，最后一条加粗）。收尾画面如果只重复一句结论，观众什么也带不走。

`metricsFor(theme)` 是单一真源：`wide = !theme.vertical` 决定两栏（左陈述 46% + 右承载物）还是单列堆叠，`contentTop` / `contentBottom` 保证内容块永远让开顶栏和字幕带。

## 子智能体

卡片墙的安装 / 卸载 / 配置环境都走真实 Host 路由，不是占位按钮：

- **安装** — 内置包一键播种，或填一个本地目录路径整包安装（校验 `manifest.json`）
- **卸载** — 删包与模板，**已建项目保留**
- **配置环境** — 每个 Agent 一份 `config.json`，其中的 `env` 会注入渲染子进程，用来放 API key、字体路径等；`skill` 是这个 Agent 的默认技能；重装不丢配置

## 造 Agent（Forge）

导航栏第三项。一句话造一个自己的智能体：选赛道 → 填目标 → 预览三个包文件 → 校验 → 安装。

**脚手架先行，模型只改散文。** `POST /forge/drafts` 用纯函数 `scaffoldAgentPackage()` 生成 `manifest.json` + `templates/main.template.json` + `skills/<name>/SKILL.md`，同一份 spec 两次调用逐字节相同（无时钟、无随机、无模型）。`POST /forge/drafts/:id/refine` 才可选地让模型润色 SKILL.md，**模型挂了不算失败**（`refined:false` + 原因，草稿照旧可用）。`POST /forge/drafts/:id/install` 先 `validateDraft()`，不过就 `409 invalid_draft`。

理由：模型限流或答错时，用户绝不能得到一个「装得上但渲染不出东西」的 Agent。校验器抓的正是那类静默失败——未知 `style.look` 会安静地渲染成默认 look，没有 frontmatter 的技能注册不上。

`forge-e2e.mjs` 守着这条链路：造草稿 → 装 Agent → 用它的模板建项目 → **真渲一帧 PNG**。

## 技能桥

每个 Agent 包自带 `skills/<dir>/SKILL.md`。Host 启动时扫描并按 frontmatter 注册进 DSH 的 `skills` 服务，于是对话里能直接 `@data-run` / `@reel-run` / `@explainer-run` 调到对应流水线。

装 / 卸 Agent 会同步增删技能（卸载时先释放旧注册再重扫，否则目录会继续服务已删的技能）。

**默认技能：不用手点。** 每个 Agent 绑一个默认技能，执行时自动生效，不需要在输入框里插 `@name`：

- 显式配置 `config.skill` 优先；该 Agent 只带一个技能时自动绑定它；多技能又没显式选则不猜（静默跑错流水线比问一句更糟）。
- 配置里的技能被更新改名/删掉时回落到单技能规则，不会把 Agent 弄哑。
- Studio 右栏把绑定的那条标成「默认技能 · @name」+「自动」标签；其余技能仍可点，是换流水线的逃生口。
- 出片后结果卡显示「自动技能 · @name」，项目的 `origin.skill` 也记着，事后能查这次为什么走这条流水线。

## 模板 → 渲染参数

模板用两套语言描述同一支片：给人看的富描述符（`style.look`、`style.palette`、`style.rhythm`、`audio.subtitles.kind`）和给渲染器看的数字 `defaults`。

`templateParams()` 把描述符翻译成索引，`templateDefaults()` 再让 `defaults` 覆盖它 —— 描述符负责**补齐** `defaults` 没写的字段，`defaults` 负责**拍板**两者冲突时谁赢。这样模板里写了 `look: 'terminal-crt'` 就一定渲染成终端绿，不会因为漏写数字键而悄悄退回默认风格。

## 字幕

`subtitle` 为 `zh` / `en` / `bilingual` 时，每个镜头都会带上旁白行（`shot.caption`），由 `Captions` 画在底部字幕带里。

**关键点**：`Captions` 只认 `shot.caption`，绝不回落到 `shot.copy` —— 大标题和字幕是给两个不同的读者看的，把标题复读一遍当字幕是错的。所以 `planStoryboard` 必须自己产出旁白；少写这一行，字幕就会静默消失（不报错、不告警），`check-timeline.mjs` 现在把它当不变量守着。

## 安装

```bash
# 从本仓库目录直接装进 DSH（开发用）
plugin_manager action=install_bundle target=<绝对路径>/packages/aibench

# 从 npm（发布后）
pnpm add dsh-aibench
```

装上后 DSH 侧栏出现「AiBench 创作台」图标，与「对话」并列。

渲染引擎在插件包内部（`packages/aibench/render/`），跟着插件一起发布。单一包，没有跨包版本耦合。

### 发布前会跑什么

`pnpm check` 串跑全部**十五道**闸门（`scripts/check-all.mjs`），其中几道专门守着「装得上但跑不起来」和「跑得起来但不好看」这类问题：

- `check-storyboard-build.mjs` —— 预编译的 `dist/storyboard.mjs` 与 `src/storyboard.ts` 必须产出逐字节相同的分镜。Node 拒绝为 `node_modules` 下的文件剥离类型，所以发布包里带的是预编译产物；忘了重新编译会直接失败。
- `check-installed-layout.mjs` —— 把 tgz 解到 `node_modules/dsh-aibench/` 下（模拟 npm 安装后的真实布局），验证插件能 import、渲染引擎能解析到包内的 `render/`、分镜规划器能跑。源码 checkout 里用符号链接，跑通不代表装得上。
- `check-forge.mjs` —— 脚手架确定性（两次调用逐字节相同）、校验器能抓出坏 manifest / 未知 look / 无 frontmatter 的技能 / 缺失模板、安装后 `AGENTS_DIR` 里不带 `draft.json`。
- `check-routes.mjs` —— 用假 `webServer` 捕获 `apply()` 注册的前缀路由，再用真 `req` 驱动它，断言状态码与 JSON 信封。`node --check` 抓不到的路由级 bug（例如 Host 里少一个常量）只有它能抓。
- `forge-e2e.mjs` —— 把 Host 半部挂在真 http server 上，走完整用户旅程：造草稿 → 装成 Agent → 用它的模板建项目 → **真渲一帧 PNG**。Forge 造出来的 Agent 装得上却渲不出东西，是这条链路唯一值得防的失败。
- `check-client-render.mjs` —— 用真 React + `renderToStaticMarkup` 把面板渲染一遍（agents / forge / tasks / settings 四页）。React 在渲染期抛的错（hook 顺序、未定义变量、`blueprint.subtitles.map` 这类首屏空数据）在这里变成失败，而不是浏览器里的白屏。
- `check-script.mjs` —— 脚本层的时序不变量：脚本决定时长、权重分配后 `sum === totalFrames`、装不下的脚本被截断而非压缩成 6 帧、`sanitizeScript()` 的每条拒绝路径。
- `check-layout.mjs` —— **渲真帧量密度**。3 画幅 × 4 帧，断言四边安全区、6 条横带有墨、read ink ≥ 0.9%。把「75% 空白」这类主观评语变成会失败的测试。

完整发布步骤见 [docs/PUBLISHING.md](docs/PUBLISHING.md)。

## 仓库结构

```
packages/aibench         可分发的 DSH 插件包（Host + Client 双半部）
  agents/                三个内置 Agent 包（manifest + SKILL.md + 模板），首次启动自动播种
  render/                Remotion 渲染工程，随插件一起发布
    dist/storyboard.mjs  预编译的分镜规划器 —— Host 从 npm 安装后 import 的是它
assets/                  icon-180.png / icon-512.png（从 icon.svg 栅格化而来）
docs/00-plan.md          产品定位、与 BN面板 的差异、子模型路由、阶段计划
docs/PUBLISHING.md       双通道发布手册（npm / GitHub / 插件市场，含实测门槛）
scripts/probe.mjs        8 项接口回归闸门（node scripts/probe.mjs [origin]）
scripts/check-timeline.mjs  分镜时间轴不变量（19k 组参数，0 容错）
scripts/check-sections.mjs  左侧导航栏扩展 API 的回归测试
scripts/check-director.mjs  一键成片本地兜底的选片与字面要求回归
scripts/check-script.mjs    脚本层时序与 sanitize 拒绝路径回归
scripts/check-skills.mjs    SKILL.md frontmatter、技能注册与默认技能绑定回归
scripts/check-templates.mjs 模板描述符 → 渲染参数映射层的回归
scripts/check-storyboard-build.mjs  预编译产物与源码不漂移（108 组分镜逐条比对）
scripts/check-layout.mjs    真渲 12 帧量画面密度 / 安全区 / 可读墨量
scripts/check-installed-layout.mjs  从 npm 安装后的目录布局是否真能跑
scripts/check-forge.mjs     Forge 脚手架 / 校验器 / 安装闸门回归
scripts/check-routes.mjs    路由级回归（假 webServer 驱动真 req）
scripts/forge-e2e.mjs       Forge 全链路端到端：造草稿 → 装 Agent → 建项目 → 真渲一帧
scripts/check-client-render.mjs  用真 React 把四页渲染一遍（抓渲染期异常）
scripts/check-all.mjs       串跑全部闸门（node scripts/check-all.mjs）
scripts/frame-density.mjs   单帧/整目录的 ink 与 read-ink 密度报告
scripts/safe-area.mjs       到四边最近 strong-ink 的距离（越界即 BLEED）
scripts/render-stills.mjs   批量 POST /still 到指定帧
scripts/render-final.mjs    排队出成片并轮询进度
scripts/pull-stills.mjs     下载项目最近的 stills
scripts/mp4-frame.mjs       从成片 mp4 里抽帧（验证最终产物而不是 still）
scripts/publish-npm.mjs      registry API 发布（无需 npm CLI）
scripts/publish-github.mjs   Git Data API 推仓库（无需 git）
```

## 开发

```bash
pnpm install
pnpm --dir packages/aibench/render studio   # 打开 Remotion Studio 调画面
node scripts/probe.mjs                # 接口回归
pnpm check                            # 十五道闸门全跑
```

改了 `packages/aibench/render/src/storyboard.ts` 之后**必须重新编译**，否则 Host 读到的还是旧规划器：

```bash
node packages/aibench/render/scripts/build-storyboard.mjs
```

改完 `packages/aibench/client.js` 或 `index.js` 后需要重载插件才生效：
`plugin_manager action=set_plugin target=include:aibench enabled=false` 再 `enabled=true`。

## 数据在哪

`<DSH profile>/aibench/`：`agents/`（已装 Agent 包）、`agents.json`、`projects/<id>/`（project.json + outputs/）、`settings.json`。
项目数据与插件代码分离，卸载插件不会删你的片子。

## 许可证

MIT。本仓库不复用任何闭源产品的代码；对标产品的行为差异见 `docs/00-plan.md`。
