# 发布手册：GitHub + DSH 插件市场

这份文档记录 AiBench 双通道发布的**确切步骤与门槛**。所有事实都在本机实测过，不是抄来的。

## 为什么不能用 git 命令

这台机器**没有 `git`，也没有 `gh`**（`Get-Command` 全部 MISS，常见安装路径均不存在）。所以：

- 仓库通过 **GitHub REST API** 创建和推送（`scripts/publish-github.mjs`，走 Git Data API：blob → tree → commit → ref）
- npm 通过 **registry API** 发布（`scripts/publish-npm.mjs`，一个 PUT 带 base64 tarball）

两个脚本都不需要 git/npm CLI，只用 Node 内置的 `fetch`。

## 通道一：npm

### 名称占用（实测）

| 包名 | 状态 |
|---|---|
| `aibench` | **已被占用**（作者 elnino0009_1，AI 跑分基准） |
| `dsh-aibench` | 可用 ✅ |
| `aibench-render` | 可用 ✅ |

所以发布两个包：`aibench-render`（渲染引擎）+ `dsh-aibench`（面板）。

### 顺序要求

`dsh-aibench` 的 `dependencies` 里声明了 `aibench-render`。**npm 拒绝发布一个依赖还不存在的包**，所以必须先发渲染引擎。`publish-npm.mjs` 里的 `PACKAGES` 数组已经按这个顺序写好。

### 需要什么

一个 npm access token（Automation 或 Publish 类型），从 <https://www.npmjs.com/settings/~/tokens> 创建。

```bash
# 先确认打包内容正确
node scripts/publish-npm.mjs --dry-run

# 真发
node scripts/publish-npm.mjs --token npm_xxxxxxxx
```

开了两步验证的账号要加 `--otp 123456`。

### 发布前必做

```bash
node packages/aibench-render/scripts/build-storyboard.mjs   # 重编分镜规划器
cd packages/aibench-render && pnpm pack --pack-destination ../../dist-packages
cd ../aibench && pnpm pack --pack-destination ../../dist-packages
```

## 通道二：GitHub

### 需要什么

一个 Personal Access Token：

- classic：勾 `repo`（要建仓库）+ `write:discussion` 不需要
- 或 fine-grained：`Administration: write`（建仓库）+ `Contents: write`（推代码）

```bash
node scripts/publish-github.mjs --dry-run              # 看会推哪些文件
node scripts/publish-github.mjs --token ghp_xxxxxxxx   # 真推
```

脚本会自动：建仓库（已存在则复用）→ 上传二进制为 blob → 建 tree → 建 commit → 更新 `main` → 设 topics（含 `dsh-plugin`）。

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
| 有真实可运行代码 | ✅ 2158 行 Host + 2600 行 Client |
| 描述必须属实 | ✅ 没写数字指标 |
| 项目活跃维护 | ⏳ 靠后续提交维持 |

### 市场索引源

- `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`（推荐，快）
- `https://awesome-dsh-plugin.com/index.json` — 本机实测 **31.3s**，超过 DSH 的 15s 预算
- `https://dshmarket.com/index.json` — 同上

## 两个真实踩到的坑

### 坑 1：`node_modules` 下的 TypeScript 不能剥离类型

插件原本直接 `import('src/storyboard.ts')`，让 Node 剥离类型。在源码 checkout 里（符号链接）能跑，但**从 npm 安装后文件位于 `node_modules` 下，Node 直接拒绝**：

```
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is
currently unsupported for files under node_modules
```

症状会是「装得上，但每个分镜调用都崩」—— 和 bnpanel「装得上但 `render.available: false`」是同一类失败。

**修复**：预编译成 `dist/storyboard.mjs` 随包发布，`storyboardEntry()` 按目录判断用哪个。
**守护**：`scripts/check-storyboard-build.mjs` 断言产物与源码重新编译的结果一致，并逐一比对 108 组参数的分镜输出。

### 坑 2：`dist/` 不能进 `.gitignore`

dsh-market 从 **GitHub tarball**（codeload）安装插件，**不跑 npm 的 `prepack` 钩子**。如果 `dist/` 被 gitignore，从仓库安装就没有预编译产物，直接崩。

所以 `.gitignore` 里显式保留了 `packages/aibench-render/dist/`，并写了注释说明原因。这是那种「本地一切正常、用户装上就崩」的问题，靠 `check-installed-layout.mjs` 提前发现。

## 发布后验证

```bash
# npm 上有没有
curl https://registry.npmjs.org/dsh-aibench
curl https://registry.npmjs.org/aibench-render

# 从 npm 装一遍（真实验证，不是本地符号链接）
cd /tmp && mkdir abx && cd abx
echo '{"name":"abx","private":true}' > package.json
pnpm add dsh-aibench
```

然后 `plugin_manager action=install_bundle target=<装好的路径>` 装进 DSH，确认侧栏出图标、面板能开、能出片。

## 版本节奏

`docs/00-plan.md` 里的计划是每阶段结束打 tag：

- `v0.1.0-s1` — 面板骨架 + 真渲染
- `v0.1.0-s2` — Agent 包 + SkillBridge + 模板映射
- `v0.1.0-s3` — 造 Agent（Forge）
- `v0.1.0-s4` — 商店 / 更新 / 回滚

npm 版本号跟 tag 走，`dsh-aibench` 与 `aibench-render` 保持同版本，因为它们的契约是紧耦合的。
