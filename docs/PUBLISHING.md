# 发布手册：GitHub + DSH 插件市场

这份文档记录 AiBench 双通道发布的**确切步骤与门槛**。所有事实都在本机实测过，不是抄来的。

## 为什么不能用 git 命令

这台机器**没有 `git`，也没有 `gh`**（`Get-Command` 全部 MISS，常见安装路径均不存在）。所以：

- 仓库通过 **GitHub REST API** 创建和推送（`scripts/publish-github.mjs`，走 Git Data API：blob → tree → commit → ref）
- npm 通过 **registry API** 发布（`scripts/publish-npm.mjs`，一个 PUT 带 base64 tarball）

两个脚本都不需要 git/npm CLI，只用 Node 内置的 `fetch`。

## 只有一个包

早期设计里渲染引擎是独立的 npm 包 `aibench-render`，插件通过 `dependencies` 依赖它。这个设计被放弃了，原因很实际：

**npm 的 granular token 不能创建新包。** 实测 `package: write` + `bypass_2fa: true` 的 granular token 发布会得到：

```
403 E_STAGE_REQUIRED: this token can only publish to a staging area,
and "aibench-render" does not exist yet.
Create it first with a direct-capable token, then use `npm stage publish`.
```

首创新包必须用 classic token。两包方案意味着任何只有 granular token 的人（包括我们）都装不上插件。

所以渲染引擎现在**在插件包内部**：`packages/aibench/render/`。Remotion 本身是普通依赖，由用户的包管理器安装。

| 目录 | 作用 |
|---|---|
| `packages/aibench/` | 插件包 `dsh-aibench`，含 Host（`index.js`）、Client（`client.js`）、内置 Agent、以及 `render/` |
| `packages/aibench/render/` | Remotion 渲染工程（`src/`、`dist/`、`public/`），跟着插件一起发布 |

`render/package.json` 保留了 `private: true` 和它自己的依赖声明——它是**工作区内的工程**，不是可独立安装的包。

## 通道一：npm

### 名称占用（实测）

| 包名 | 状态 |
|---|---|
| `aibench` | **已被占用**（作者 elnino0009_1，AI 跑分基准） |
| `dsh-aibench` | 可用 ✅ |

### 需要什么

一个 npm access token，从 <https://www.npmjs.com/settings/~/tokens> 创建。

**必须是 Classic 类型的 Automation token。** 这条不是偏好，是 npm 的硬规则，实测连续撞了三次：

| token 类型 | 结果 |
|---|---|
| Granular，只读 | `403 You may not perform that action with these credentials.` |
| Granular，`package: write` + `bypass_2fa: true` | `403 E_STAGE_REQUIRED`：只能推 staging 暂存区，首创新包必须用 direct-capable token |
| Classic，Automation | 正常发布 |

Automation 类型同时自动满足 2FA 要求（`bypass_2fa = true`）。如果账户开了两步验证而用了 Publish 类型，每次发布都要现场输 6 位动态码，30 秒过期，脚本没法处理。

**怎么确认手里的 token 对不对**（不用等发布失败）：

```bash
curl -H "Authorization: Bearer npm_xxx" https://registry.npmjs.org/-/npm/v1/tokens
```

看返回里的 `bypass_2fa` 和 `permissions[].action`。注意这个接口对 Classic token 返回的是全部 token 列表，对 Granular token 只返回自己那一个。

```bash
# 先确认打包内容正确
node scripts/publish-npm.mjs --dry-run

# 真发
node scripts/publish-npm.mjs --token npm_xxxxxxxx
```

开了两步验证的账号要加 `--otp 123456`（仅 Publish 类型需要）。

### 发布前必做

```bash
node packages/aibench/render/scripts/build-storyboard.mjs   # 重编分镜规划器
cd packages/aibench && pnpm pack --pack-destination ../../dist-packages
```

## 通道二：GitHub

### 需要什么

一个 Personal Access Token：

- classic：勾 `repo`（要建仓库 + 推代码）
- 或 fine-grained：`Administration: write`（建仓库）+ `Contents: write`（推代码）

```bash
node scripts/publish-github.mjs --dry-run              # 看会推哪些文件
node scripts/publish-github.mjs --token ghp_xxxxxxxx   # 真推
```

脚本会自动：建仓库（已存在则复用）→ 上传二进制为 blob → 建 tree → 建 commit → 更新 `main` → 设 topics（含 `dsh-plugin`）。

**SSH keys 和 GPG keys 都不需要。** SSH 是给 `git` 协议用的，本机没有 git；GPG 只影响 commit 的「Verified」徽章，不影响能否推送。

## 通道三：DSH 插件市场

市场 UI 本体是 npm 包 `dshmarket`，但**插件目录在另一个仓库**：`awesome-dsh-plugin/awesome-dsh-plugin`。

收录方式 = 提 PR，**只新增一个文件**，不动别的：

```
data/plugins/<owner>__<repo>.yml
```

monorepo 的子包要用后缀形式，因为可安装的包是 `packages/aibench` 而不是仓库根：

```
data/plugins/<owner>__AiBench--packages-aibench.yml
```

内容模板见 `docs/marketplace-entry.yml`（把 `<OWNER>` 换成实际 GitHub 用户名）。

### 硬性门槛（官方 contributing.md + CI）

| 门槛 | 我们的状态 |
|---|---|
| `package.json` 必须声明 `dsh.bundle` | ✅ 已声明（只声明 `dsh.client` 会被拒） |
| 仓库创建满 **1 天** | ⏳ 建仓后等一天 |
| 仓库有 `dsh-plugin` topic | ✅ 脚本自动设 |
| 有真实可运行代码 | ✅ Host + Client 均有完整实现 |
| 描述必须属实 | ✅ 没写数字指标 |
| 项目活跃维护 | ⏳ 靠后续提交维持 |

### 市场索引源

- `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`（推荐，快）
- `https://awesome-dsh-plugin.com/index.json` — 本机实测 **31.3s**，超过 DSH 的 15s 预算
- `https://dshmarket.com/index.json` — 同上

## 四个真实踩到的坑

### 坑 1：`node_modules` 下的 TypeScript 不能剥离类型

插件原本直接 `import('src/storyboard.ts')`，让 Node 剥离类型。在源码 checkout 里能跑，但**从 npm 安装后文件位于 `node_modules` 下，Node 直接拒绝**：

```
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is
currently unsupported for files under node_modules
```

症状会是「装得上，但每个分镜调用都崩」—— 和 bnpanel「装得上但 `render.available: false`」是同一类失败。

**修复**：预编译成 `render/dist/storyboard.mjs` 随包发布，`storyboardEntry()` 按目录判断用哪个。
**守护**：`scripts/check-storyboard-build.mjs` 断言产物与源码重新编译的结果一致，并逐一比对 108 组参数的分镜输出。

### 坑 2：`dist/` 不能进 `.gitignore`

dsh-market 从 **GitHub tarball**（codeload）安装插件，**不跑 npm 的 `prepack` 钩子**。如果 `dist/` 被 gitignore，从仓库安装就没有预编译产物，直接崩。

所以 `.gitignore` 里显式保留了 `packages/aibench/render/dist/`，并写了注释说明原因。这是那种「本地一切正常、用户装上就崩」的问题，靠 `check-installed-layout.mjs` 提前发现。

### 坑 3：pnpm 把依赖放在**兄弟目录**，不是嵌套 `node_modules`

这个坑只会在真实 `pnpm add` 之后暴露，本地符号链接开发永远看不到。

pnpm 不把依赖提升到项目的 `node_modules`，而是把每个包放在虚拟仓里，**它的依赖与它并列**：

```
node_modules/.pnpm/dsh-aibench@<hash>/node_modules/
├── dsh-aibench/          ← 插件本身
├── @remotion/            ← 它的依赖，兄弟位置
├── react
└── remotion
```

所以 `@remotion/cli` 在 `<pkg_root>/@remotion/cli`，**不是** `<plugin>/node_modules/@remotion/cli`。最初只探测后者，结果在**装得好好的**环境里报 `render.available: false`。

**修复**：`resolveRenderCli()` 按顺序探测四个位置，其中 `PKG_ROOT/@remotion/cli` 同时命中 pnpm 与扁平 npm 布局。
**守护**：`check-installed-layout.mjs` 现在会先找 `@remotion` 到底在哪 —— 如果依赖存在但解析不到，**直接失败**（而不是静默跳过），因为那正是这个 bug 的形状。用真实安装跑：

```bash
node scripts/check-installed-layout.mjs .tmp/installsim/node_modules/dsh-aibench
```

### 坑 4：PowerShell `Set-Content` 会破坏 UTF-8 中文

用 `Set-Content` 批量改脚本路径后，三个含中文的 `.mjs` 变成非 UTF-8，Node 报：

```
SyntaxError: Invalid or unexpected token
```

**改含中文的文件要用 `node -e` + `fs.writeFileSync(path, text, 'utf8')`，或者用编辑工具。** 事后可以用 `node --check <file>` 快速发现这类损坏。

同一个坑的另一种形状：用 `Set-Content` 写 `package.json` 会带上 BOM，Remotion 的打包器读它会报
`SyntaxError: Unexpected token '﻿', "﻿{"name":""... is not valid JSON`。

## 发布后验证

```bash
# npm 上有没有
curl https://registry.npmjs.org/dsh-aibench

# 从 npm 装一遍（真实验证，不是本地符号链接）
cd /tmp && mkdir abx && cd abx
echo '{"name":"abx","private":true}' > package.json
pnpm add dsh-aibench

# 装完立刻验证渲染链路，别只看能不能装
node <repo>/scripts/check-installed-layout.mjs ./node_modules/dsh-aibench
```

然后 `plugin_manager action=install_bundle target=<装好的路径>` 装进 DSH，确认侧栏出图标、面板能开、能出片。

## 版本节奏

`docs/00-plan.md` 里的计划是每阶段结束打 tag：

- `v0.1.0-s1` — 面板骨架 + 真渲染
- `v0.1.0-s2` — Agent 包 + SkillBridge + 模板映射
- `v0.1.0-s3` — 造 Agent（Forge）
- `v0.1.0-s4` — 商店 / 更新 / 回滚
