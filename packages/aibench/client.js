/**
 * AiBench — Client half.
 *
 * Loaded through the DSH module loader; no build step, no JSX, no TS.
 * React comes from the browser module table, so we only require('react').
 *
 * Two views, one shell:
 *   wall    -> the control panel: a card per installed agent
 *   studio  -> one agent's workbench: templates + params, live still, shot table
 *
 * Registers two slots, both under the same panel key:
 *   sidebar.panellist -> id: 'aibench'  (a plain glyph; the sidebar owns the button)
 *   main              -> key: 'aibench' (the panel the sidebar entry selects)
 *
 * The two ids must match: clicking a sidebar entry dispatches
 * layout.selectPanel(<id>), which throws if that `main` key is not registered.
 *
 * Every fetch is individually guarded: one failing endpoint degrades to a
 * notice line instead of blanking the panel.
 */
window.__ModuleLoader__.load({
  id: 'dsh-aibench',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const BASE = '/aibench-api'
    const BRAND = 'AiBench'

    // ---- copy: read the Client locale service, fall back to Chinese ----
    const I18N = {
      zh: {
        launcher: 'AiBench 创作台',
        title: 'AiBench 创作台',
        subtitle: '本地渲染 · 参数化 · 不生图不生视频',
        close: '关闭',
        refresh: '刷新',
        loading: '读取中…',
        offline: '连不上 Host（/aibench-api 无响应）',
        wallTitle: '创作台',
        wallHint: '选一个智能体开始 · 每个智能体是一套独立的动效语言',
        back: '创作台',
        library: '项目库',
        forge: '造 Agent',
        forgeSoon: '造 Agent 将在 S3 开放：用对话生成你自己的技能包。',
        installed: '已安装',
        builtin: '内置',
        templates: '模板',
        skills: '技能',
        track: '赛道',
        openStudio: '打开创作台',
        // ---- agent lifecycle ----
        installAgent: '安装智能体',
        installTitle: '安装智能体',
        installHint: '内置包一键装上；也可以填一个本地目录，里面有 manifest.json 就能装。',
        installBuiltin: '内置包',
        installAllInstalled: '内置包都已安装。',
        installFromDir: '从本地目录安装',
        installPath: '智能体包目录（含 manifest.json）',
        installPathPh: 'D:\\my-agents\\my-agent',
        install: '安装',
        installing: '安装中…',
        installOk: '已安装',
        installFailed: '安装失败',
        reinstall: '重装',
        uninstall: '卸载',
        uninstallTitle: '卸载智能体',
        uninstallConfirm: '确定卸载这个智能体？它的模板会一起删除，已建的项目会保留。',
        uninstalled: '已卸载',
        uninstallFailed: '卸载失败',
        configure: '配置环境',
        configTitle: '配置环境',
        configHint: '环境变量会注入这个智能体的渲染子进程，用于字体缓存、时区等。',
        configProvider: '默认模型通道',
        configModel: '默认模型',
        configModelHint: '一键成片优先用这个通道；留空则用面板默认的兜底链。',
        configEnv: '环境变量',
        configEnvEmpty: '还没有环境变量。',
        configEnvKey: '变量名',
        configEnvValue: '值',
        configAddEnv: '＋ 加一条',
        configRemoveEnv: '删除',
        save: '保存',
        saving: '保存中…',
        saveFailed: '保存失败',
        configSaved: '已保存',
        // ---- one-click director ----
        director: '一键成片',
        directorTitle: '一键成片',
        directorHint: '用一句话说清你要什么，AI 助手指挥挑模板、定风格、直接出片。',
        directorPromptPh: '例：给新上线的命令行工具做个 15 秒竖版开场，卡点、终端绿',
        directorMode: '选片方式',
        directorTemplate: '参考模板',
        directorRandom: '随机',
        directorRun: '生成并出片',
        directorRunning: 'AI 正在挑片…',
        directorSourceLlm: 'AI 选片',
        directorSourceLocal: '本地兜底',
        directorOffline: '模型通道暂时不可用，这次按你的字面要求本地挑片。',
        directorRejected: '已修正',
        directorNoModel: '这个 Host 没有可用模型，会用本地兜底挑片。',
        directorNeedPrompt: '先写一句你要什么。',
        directorFailed: '成片失败',
        oneClick: '一键成片',
        skillsTitle: '技能',
        skillsHint: '点一下插入到输入框，用 @ 让模型调用',
        skillsDefault: '默认技能',
        skillsAuto: '自动',
        skillsDefaultHint: '出片时自动带上这条流水线，不用手点。',
        skillsEmpty: '这个智能体没有技能包',
        skillsInserted: '已插入技能',
        skillSynced: '已同步到 DSH 技能库',
        skillNotSynced: 'DSH 技能库不可用，技能只在面板内可见',
        configSkill: '默认技能',
        configSkillHint: '不选时，只有一个技能的智能体会自动用它。再点一次可取消。',
        configSkillNone: '这个智能体没有技能包',
        directorSkill: '自动技能',
        agents: '智能体',
        projects: '项目',
        renderEngine: '渲染引擎',
        renderReady: '就绪',
        renderMissing: '未装依赖',
        dataDir: '数据目录',
        templatesTitle: '模板',
        noTemplate: '这个智能体还没有模板。',
        paramsTitle: '七槽位参数',
        look: '风格 look',
        palette: '配色',
        duration: '时长 / 画幅',
        bpm: '节奏 BPM',
        subtitleLabel: '字幕',
        flow: '分镜顺序',
        seconds: '秒',
        frame: '画幅',
        preview: '预览一帧',
        prevFrame: '← 上一帧',
        nextFrame: '下一帧 →',
        replan: '重生成分镜',
        rendering: '渲染中…',
        renderingHint: 'Remotion 正在出帧，通常 3–6 秒。',
        shotTable: '分镜表',
        shotTotal: '帧',
        beatNote: '每镜起点都卡在 1/拍 的整数倍上',
        beatUnit: '拍长',
        frames: '帧',
        assistant: 'AI 助手',
        assistantHint: '说一句话，助手挑模板、定风格，直接出片。',
        askPlaceholder: '说说你要拍什么…',
        jobRunning: '渲染中',
        jobDone: '完成',
        jobFailed: '失败',
        cancel: '取消',
        retry: '重试',
        emptyProjects: '这个智能体还没有项目。',
        recent: '最近项目',
        status_draft: '草稿',
        status_storyboard: '分镜就绪',
        status_rendering: '出片中',
        status_done: '已出片',
        status_failed: '失败',
        draft: '草稿',
        done: '已出片',
        failedState: '上次失败',
        openProject: '继续',
        shotKindHook: '钩子',
        shotKindProcess: '展开',
        shotKindCta: '收尾',
        navAgents: 'Agent 智能体',
        navStudio: 'Studio 工作室',
        navTasks: 'Task 任务',
        navSettings: 'Setting 设置',
        navCollapse: '收起导航栏',
        navExpand: '展开导航栏',
        studioTitle: 'Studio 工作室',
        studioHint: '按智能体挑选模板开工，或继续最近的项目',
        taskTitle: 'Task 任务',
        taskHint: '渲染任务队列 · 单帧预览与成片导出都记在这里',
        taskEmpty: '还没有渲染任务。打开一个 Studio，点「预览一帧」就会出现。',
        taskCol: '任务',
        taskKindStill: '单帧',
        taskKindRender: '成片',
        taskRunning: '进行中',
        taskNoJob: '没有任务在跑',
        settingTitle: 'Setting 设置',
        settingHint: '只读信息来自 /panel/info，偏好项保存在 settings.json',
        settingData: '数据目录',
        settingRender: '渲染引擎',
        settingRenderCli: 'CLI 路径',
        settingEngine: '引擎',
        settingNode: 'Node',
        settingPlatform: '平台',
        settingVersion: '版本',
        settingLocale: '界面语言',
        settingLocaleHint: '跟随 DSH 语言设置，改了要刷新面板',
        settingSaved: '已保存',
        settingAgentsDir: '智能体目录',
        settingProjectsDir: '项目目录',
        copy: '复制',
        copied: '已复制到剪贴板',
        copyFailed: '复制失败，请手动选中复制',
        open: '打开',
        // ---- forge ----
        navForge: '造 Agent',
        forgeTitle: '造 Agent',
        forgeHint: '一句话描述你要做的片子，AiBench 生成一个能直接安装的智能体包。不依赖模型：模型不可用时生成的东西一样完整。',
        forgeGoal: '一句话目标',
        forgeGoalPh: '给新上线的命令行工具做个 15 秒开场',
        forgeTrack: '赛道',
        forgeAdvanced: '细节（可留默认）',
        forgeCreate: '生成草稿',
        forgeCreating: '生成中…',
        forgeDrafts: '草稿',
        forgeEmpty: '还没有草稿。在上面写一句话就能造一个。',
        forgeFiles: '文件',
        forgeValidate: '重新校验',
        forgeValid: '校验通过',
        forgeInvalid: '校验未通过',
        forgeInstall: '安装为智能体',
        forgeInstalling: '安装中…',
        forgeInstalled: '已安装为智能体',
        forgeDelete: '删除草稿',
        forgeRefine: '让模型润色',
        forgeRefining: '润色中…',
        forgeRefined: '已润色',
        forgeRefineOffline: '模型通道不可用，草稿本身已经是完整的。',
        forgeWarnings: '提示',
        forgeErrors: '错误',
        forgeCreated: '草稿已生成',
        forgeDeleted: '草稿已删除',
        forgeFailed: '造 Agent 失败',
      },
      en: {
        launcher: 'AiBench studio',
        title: 'AiBench studio',
        subtitle: 'Local render · parametric · no AI media generation',
        close: 'Close',
        refresh: 'Refresh',
        loading: 'Loading…',
        offline: 'Cannot reach the Host (/aibench-api did not respond)',
        wallTitle: 'Studio',
        wallHint: 'Pick an agent to start · each agent is its own motion language',
        back: 'Studio',
        library: 'Projects',
        forge: 'Forge agent',
        forgeSoon: 'Forge arrives in S3: build your own skill package by chatting.',
        installed: 'Installed',
        builtin: 'Built-in',
        templates: 'Templates',
        skills: 'Skills',
        track: 'Track',
        openStudio: 'Open studio',
        // ---- agent lifecycle ----
        installAgent: 'Install agent',
        installTitle: 'Install agent',
        installHint: 'Install a built-in package in one click, or point at a local folder that holds a manifest.json.',
        installBuiltin: 'Built-in packages',
        installAllInstalled: 'Every built-in package is already installed.',
        installFromDir: 'Install from a local folder',
        installPath: 'Agent package folder (contains manifest.json)',
        installPathPh: 'D:\\my-agents\\my-agent',
        install: 'Install',
        installing: 'Installing…',
        installOk: 'Installed',
        installFailed: 'Install failed',
        reinstall: 'Reinstall',
        uninstall: 'Uninstall',
        uninstallTitle: 'Uninstall agent',
        uninstallConfirm: 'Uninstall this agent? Its templates go with it; projects you already made are kept.',
        uninstalled: 'Uninstalled',
        uninstallFailed: 'Uninstall failed',
        configure: 'Environment',
        configTitle: 'Environment',
        configHint: 'These variables are injected into this agent\'s render subprocess — font caches, time zones, and the like.',
        configProvider: 'Preferred provider route',
        configModel: 'Preferred model',
        configModelHint: 'One-click uses this route first; leave it blank to use the panel\'s fallback chain.',
        configEnv: 'Environment variables',
        configEnvEmpty: 'No environment variables yet.',
        configEnvKey: 'Name',
        configEnvValue: 'Value',
        configAddEnv: '+ Add a row',
        configRemoveEnv: 'Remove',
        save: 'Save',
        saving: 'Saving…',
        saveFailed: 'Save failed',
        configSaved: 'Saved',
        // ---- one-click director ----
        director: 'One-click video',
        directorTitle: 'One-click video',
        directorHint: 'Say what you want in one sentence. The assistant picks a template, sets the style, and renders.',
        directorPromptPh: 'e.g. a 15s vertical opener for our new CLI tool — beat-synced, terminal green',
        directorMode: 'Picking',
        directorTemplate: 'By template',
        directorRandom: 'Random',
        directorRun: 'Generate and render',
        directorRunning: 'The director is choosing…',
        directorSourceLlm: 'AI picked',
        directorSourceLocal: 'Local fallback',
        directorOffline: 'No model route is reachable right now, so this pick came from your words alone.',
        directorRejected: 'corrected',
        directorNoModel: 'This Host exposes no model, so the local planner picks the template.',
        directorNeedPrompt: 'Write one sentence first.',
        directorFailed: 'Render failed',
        oneClick: 'One-click video',
        skillsTitle: 'Skills',
        skillsHint: 'Click to insert; the model then calls it via @',
        skillsDefault: 'Default skill',
        skillsAuto: 'auto',
        skillsDefaultHint: 'This pipeline runs on its own — no click needed.',
        skillsEmpty: 'This agent ships no skills',
        skillsInserted: 'Skill inserted',
        skillSynced: 'Synced into the DSH skill catalog',
        skillNotSynced: 'DSH skill catalog unavailable; skills are panel-local',
        configSkill: 'Default skill',
        configSkillHint: 'Left empty, an agent with a single skill uses it automatically. Click again to clear.',
        configSkillNone: 'This agent ships no skills',
        directorSkill: 'Auto skill',
        agents: 'Agents',
        projects: 'Projects',
        renderEngine: 'Render engine',
        renderReady: 'ready',
        renderMissing: 'deps missing',
        dataDir: 'Data dir',
        templatesTitle: 'Templates',
        noTemplate: 'This agent has no templates yet.',
        paramsTitle: 'Seven slots',
        look: 'Look',
        palette: 'Palette',
        duration: 'Duration / aspect',
        bpm: 'Tempo',
        subtitleLabel: 'Subtitles',
        flow: 'Shot order',
        seconds: 's',
        frame: 'aspect',
        preview: 'Preview frame',
        prevFrame: '← Prev',
        nextFrame: 'Next →',
        replan: 'Re-plan',
        rendering: 'Rendering…',
        renderingHint: 'Remotion is drawing frames, usually 3–6s.',
        shotTable: 'Shot table',
        shotTotal: 'frames',
        beatNote: 'Every shot starts on a whole beat',
        beatUnit: 'beat',
        frames: 'frames',
        assistant: 'Assistant',
        assistantHint: 'One sentence in: it picks a template, sets the style, and renders.',
        askPlaceholder: 'Say what you want to make…',
        jobRunning: 'Rendering',
        jobDone: 'Done',
        jobFailed: 'Failed',
        cancel: 'Cancel',
        retry: 'Retry',
        emptyProjects: 'No projects for this agent yet.',
        recent: 'Recent projects',
        status_draft: 'Draft',
        status_storyboard: 'Storyboard',
        status_rendering: 'Rendering',
        status_done: 'Rendered',
        status_failed: 'Failed',
        draft: 'Draft',
        done: 'Rendered',
        failedState: 'Last run failed',
        openProject: 'Resume',
        shotKindHook: 'Hook',
        shotKindProcess: 'Body',
        shotKindCta: 'Close',
        navAgents: 'Agents',
        navStudio: 'Studio',
        navTasks: 'Tasks',
        navSettings: 'Settings',
        navCollapse: 'Collapse navigation',
        navExpand: 'Expand navigation',
        studioTitle: 'Studio',
        studioHint: 'Pick a template to start, or resume a recent project',
        taskTitle: 'Tasks',
        taskHint: 'Render queue · both still previews and video exports land here',
        taskEmpty: 'No render tasks yet. Open a Studio and hit "Preview frame".',
        taskCol: 'Task',
        taskKindStill: 'Still',
        taskKindRender: 'Video',
        taskRunning: 'Running',
        taskNoJob: 'No task running',
        settingTitle: 'Settings',
        settingHint: 'Read-only facts come from /panel/info; preferences live in settings.json',
        settingData: 'Data directory',
        settingRender: 'Render engine',
        settingRenderCli: 'CLI path',
        settingEngine: 'Engine',
        settingNode: 'Node',
        settingPlatform: 'Platform',
        settingVersion: 'Version',
        settingLocale: 'Panel language',
        settingLocaleHint: 'Follows the DSH locale; refresh the panel after changing it',
        settingSaved: 'Saved',
        settingAgentsDir: 'Agents directory',
        settingProjectsDir: 'Projects directory',
        copy: 'Copy',
        copied: 'Copied to clipboard',
        copyFailed: 'Copy failed — select the text manually',
        open: 'Open',
        // ---- forge ----
        navForge: 'Forge agent',
        forgeTitle: 'Forge agent',
        forgeHint: 'Describe the video in one sentence; AiBench generates an agent package you can install right away. No model required — what it builds is complete even when every model route is down.',
        forgeGoal: 'One-sentence goal',
        forgeGoalPh: 'A 15-second opener for the CLI tool we just shipped',
        forgeTrack: 'Track',
        forgeAdvanced: 'Details (defaults are fine)',
        forgeCreate: 'Generate draft',
        forgeCreating: 'Generating…',
        forgeDrafts: 'Drafts',
        forgeEmpty: 'No drafts yet. Write one sentence above to build one.',
        forgeFiles: 'Files',
        forgeValidate: 'Revalidate',
        forgeValid: 'Validation passed',
        forgeInvalid: 'Validation failed',
        forgeInstall: 'Install as agent',
        forgeInstalling: 'Installing…',
        forgeInstalled: 'Installed as agent',
        forgeDelete: 'Delete draft',
        forgeRefine: 'Let a model polish it',
        forgeRefining: 'Polishing…',
        forgeRefined: 'Polished',
        forgeRefineOffline: 'No model route is reachable; the draft is already complete.',
        forgeWarnings: 'Notes',
        forgeErrors: 'Errors',
        forgeCreated: 'Draft generated',
        forgeDeleted: 'Draft deleted',
        forgeFailed: 'Forge failed',
      },
    }

    // ---- option tables mirroring aibench-render/src/storyboard.ts ----
    const LOOKS = [
      { value: 0, zh: '瑞士排版', en: 'Swiss' },
      { value: 1, zh: '蓝图', en: 'Blueprint' },
      { value: 2, zh: '终端 CRT', en: 'Terminal CRT' },
      { value: 3, zh: '半调案卷', en: 'Halftone' },
      { value: 4, zh: '一笔画', en: 'One line' },
    ]
    const PALETTES = [
      { value: 0, zh: '科技暗色', en: 'Tech dark' },
      { value: 1, zh: '终端绿', en: 'Terminal green' },
      { value: 2, zh: '霓虹紫', en: 'Neon violet' },
      { value: 3, zh: '极简白', en: 'Paper white' },
    ]
    const SUBTITLES = [
      { value: 'none', zh: '关', en: 'Off' },
      { value: 'zh', zh: '中文', en: 'Chinese' },
      { value: 'en', zh: '英文', en: 'English' },
      { value: 'bilingual', zh: '双语', en: 'Both' },
    ]
    const FLOWS = [
      { value: 0, zh: '钩子优先', en: 'Hook first' },
      { value: 1, zh: '过程优先', en: 'Body first' },
      { value: 2, zh: '结果前置', en: 'Result first' },
    ]
    const ASPECTS = [
      { value: '16:9', zh: '16:9 横版', en: '16:9' },
      { value: '9:16', zh: '9:16 竖版', en: '9:16' },
      { value: '1:1', zh: '1:1 方版', en: '1:1' },
    ]
    const DURATIONS = [10, 15, 20, 25, 30, 45, 60]
    const BPM_CHOICES = [90, 100, 110, 120, 128, 140]

    // ---- shared state between the two slots ----
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get() {
          return state
        },
        set(patch) {
          state = Object.assign({}, state, typeof patch === 'function' ? patch(state) : patch)
          listeners.forEach((fn) => fn())
        },
        subscribe(fn) {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
      }
    }

    function useStore(store) {
      const [, force] = React.useState(0)
      React.useEffect(() => store.subscribe(() => force((n) => n + 1)), [store])
      return store.get()
    }

    // ---- HTTP helpers: never throw upward ----
    async function api(path, init) {
      try {
        const response = await fetch(BASE + path, {
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          ...init,
        })
        const text = await response.text()
        let payload = null
        try {
          payload = text ? JSON.parse(text) : null
        } catch {
          return { ok: false, error: `bad JSON from ${path}` }
        }
        if (!response.ok || (payload && payload.ok === false)) {
          const message = (payload && payload.error && payload.error.message) || `HTTP ${response.status}`
          return { ok: false, error: message, payload }
        }
        return { ok: true, payload }
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error) }
      }
    }

    const getJson = (path) => api(path)
    const postJson = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) })
    const patchJson = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body || {}) })

    // ---- styles: theme tokens only, so light/dark both work ----
    const CSS = [
      // The host does not ship a global border-box reset, so a padded element
      // would render wider than its declared width (the collapsed rail measured
      // 59px instead of 46px). Scope the reset to our own tree.
      '.abx-shell,.abx-shell *,.abx-shell *::before,.abx-shell *::after,.abx-icon,.abx-icon *{box-sizing:border-box;}',
      '.abx-icon{display:flex;align-items:center;justify-content:center;color:currentColor;}',
      '.abx-icon[data-active="true"]{color:var(--dsw-alias-brand-primary);}',
      '.abx-shell{position:relative;display:flex;flex-direction:column;min-height:0;height:100%;background:var(--dsw-alias-bg-layer-1);overflow:hidden;color:var(--dsw-alias-label-primary);font-family:inherit;}',
      '.abx-head{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);}',
      '.abx-brand{font-size:13px;font-weight:700;color:var(--dsw-alias-brand-primary);letter-spacing:.2px;}',
      '.abx-sub{font-size:11px;color:var(--dsw-alias-label-secondary);}',
      '.abx-spacer{flex:1;}',
      '.abx-badge{font-size:10px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap;}',
      '.abx-badge[data-tone="ok"]{border-color:var(--dsw-alias-state-success-primary,#2ea043);color:var(--dsw-alias-state-success-primary,#2ea043);}',
      '.abx-badge[data-tone="warn"]{border-color:var(--dsw-alias-state-warning-primary,#b58900);color:var(--dsw-alias-state-warning-primary,#b58900);}',
      '.abx-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;padding:5px 11px;border-radius:7px;cursor:pointer;white-space:nowrap;}',
      '.abx-btn:hover{border-color:var(--dsw-alias-brand-primary);}',
      '.abx-btn:disabled{opacity:.5;cursor:default;border-color:var(--dsw-alias-border-l1);}',
      '.abx-btn[data-primary="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;font-weight:600;}',
      '.abx-btn[data-primary="true"]:hover{opacity:.92;}',
      '.abx-x{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:18px;line-height:1;padding:4px 9px;border-radius:6px;}',
      '.abx-x:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.abx-notice{font-size:11px;color:var(--dsw-alias-state-danger-primary,#d9534f);max-width:46ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.abx-body{flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:14px;min-height:0;}',
      '.abx-toolrow{display:flex;align-items:flex-end;gap:12px;flex:0 0 auto;}',
      '.abx-h1{font-size:17px;font-weight:700;margin:0;}',
      '.abx-hint{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:3px;}',
      '.abx-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;}',
      '.abx-agentcard{display:flex;flex-direction:column;gap:9px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px;background:var(--dsw-alias-bg-layer-1);position:relative;}',
      '.abx-agentcard[data-open="true"]{border-color:var(--dsw-alias-brand-primary);}',
      '.abx-agentcard-top{display:flex;align-items:flex-start;gap:10px;}',
      '.abx-glyph{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#fff;flex:0 0 auto;}',
      '.abx-agentcard-t{font-size:13px;font-weight:700;line-height:1.3;}',
      '.abx-agentcard-v{font-size:10px;color:var(--dsw-alias-label-secondary);margin-top:2px;}',
      '.abx-agentcard-d{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.6;min-height:3.2em;}',
      '.abx-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:10px;color:var(--dsw-alias-label-secondary);}',
      '.abx-agentcard-acts{display:flex;gap:7px;margin-top:2px;}',
      '.abx-agentcard-acts .abx-btn{flex:1;text-align:center;}',
      '.abx-foot{flex:0 0 auto;margin-top:auto;display:flex;align-items:center;gap:14px;padding:9px 16px;border-top:1px solid var(--dsw-alias-border-l1);font-size:10px;color:var(--dsw-alias-label-secondary);}',
      '.abx-foot b{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;}',
      '.abx-foot-path{margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:52%;}',
      '.abx-crumb{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary);}',
      '.abx-crumb-btn{border:none;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:11px;cursor:pointer;padding:2px 4px;border-radius:5px;}',
      '.abx-crumb-btn:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.abx-crumb-sep{opacity:.45;}',
      '.abx-crumb-cur{color:var(--dsw-alias-label-primary);font-weight:600;}',
      '.abx-studio{flex:1;display:grid;grid-template-columns:286px 1fr 300px;gap:0;min-height:0;overflow:hidden;}',
      '.abx-col{display:flex;flex-direction:column;gap:12px;padding:13px;overflow:auto;min-height:0;}',
      '.abx-col-left{border-right:1px solid var(--dsw-alias-border-l1);}',
      '.abx-col-right{border-left:1px solid var(--dsw-alias-border-l1);}',
      '.abx-sec-h{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px;}',
      '.abx-tpl{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 10px;cursor:pointer;background:var(--dsw-alias-bg-layer-1);}',
      '.abx-tpl:hover{border-color:var(--dsw-alias-border-l2);}',
      '.abx-tpl[data-on="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary) inset;}',
      '.abx-tpl-t{font-size:11.5px;font-weight:600;line-height:1.4;}',
      '.abx-tpl-m{font-size:10px;color:var(--dsw-alias-label-secondary);margin-top:3px;}',
      '.abx-field{display:flex;flex-direction:column;gap:4px;}',
      '.abx-field-l{font-size:10px;color:var(--dsw-alias-label-secondary);}',
      '.abx-seg{display:flex;gap:4px;flex-wrap:wrap;}',
      '.abx-seg-btn{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;padding:4px 8px;border-radius:6px;cursor:pointer;}',
      '.abx-seg-btn:hover{border-color:var(--dsw-alias-border-l2);}',
      '.abx-seg-btn[data-on="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:600;}',
      '.abx-center{display:flex;flex-direction:column;gap:10px;padding:13px;overflow:auto;min-height:0;}',
      '.abx-stage{position:relative;width:100%;aspect-ratio:16/9;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:#0b1020;overflow:hidden;display:flex;align-items:center;justify-content:center;}',
      '.abx-stage[data-aspect="9:16"]{aspect-ratio:9/16;max-height:52vh;margin:0 auto;}',
      '.abx-stage[data-aspect="1:1"]{aspect-ratio:1/1;max-height:52vh;margin:0 auto;}',
      '.abx-stage img{width:100%;height:100%;object-fit:contain;display:block;}',
      '.abx-stage-empty{color:#6b7280;font-size:11px;text-align:center;padding:20px;line-height:1.7;}',
      '.abx-spinner{width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,.2);border-top-color:#fff;animation:abxspin .8s linear infinite;}',
      '@keyframes abxspin{to{transform:rotate(360deg);}}',
      '.abx-playbar{display:flex;align-items:center;gap:9px;font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;}',
      '.abx-track{position:relative;flex:1;height:4px;border-radius:2px;background:var(--dsw-alias-border-l1);}',
      '.abx-track-fill{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:var(--dsw-alias-brand-primary);}',
      '.abx-track-head{position:absolute;top:-3px;width:2px;height:10px;background:var(--dsw-alias-brand-primary);}',
      '.abx-actrow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}',
      '.abx-shots{display:flex;flex-direction:column;gap:1px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;overflow:hidden;}',
      '.abx-shot{display:grid;grid-template-columns:22px 58px 1fr auto;align-items:center;gap:9px;padding:7px 10px;font-size:10.5px;background:var(--dsw-alias-bg-layer-1);}',
      '.abx-shot[data-on="true"]{background:var(--dsw-alias-bg-layer-2);}',
      '.abx-shot-n{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);}',
      '.abx-shot-k{font-size:10px;color:var(--dsw-alias-brand-primary);font-weight:600;}',
      '.abx-shot-c{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);}',
      '.abx-shot-r{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);}',
      '.abx-note{font-size:10px;color:var(--dsw-alias-label-secondary);line-height:1.6;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;padding:7px 9px;}',
      '.abx-chat{display:flex;flex-direction:column;gap:7px;flex:1;min-height:0;overflow:auto;}',
      '.abx-bubble{font-size:11px;line-height:1.6;padding:7px 9px;border-radius:9px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);}',
      '.abx-bubble[data-me="true"]{background:var(--dsw-alias-bg-layer-2);}',
      '.abx-inputrow{display:flex;gap:6px;align-items:center;}',
      '.abx-input{flex:1;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:6px 9px;font:inherit;font-size:11px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);min-width:0;}',
      '.abx-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary);}',
      '.abx-job{font-size:10px;color:var(--dsw-alias-label-secondary);line-height:1.6;}',
      '.abx-progress{height:3px;border-radius:2px;background:var(--dsw-alias-border-l1);overflow:hidden;}',
      '.abx-progress-fill{height:100%;background:var(--dsw-alias-brand-primary);transition:width .3s;}',
      '.abx-video{width:100%;border-radius:8px;display:block;margin-top:4px;}',
      // ---- modal (install / uninstall / configure / one-click) ----
      '.abx-mask{position:absolute;inset:0;background:rgba(6,8,18,.55);display:flex;align-items:center;justify-content:center;padding:24px;z-index:5;}',
      '.abx-modal{width:100%;max-width:560px;max-height:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden;box-shadow:0 18px 48px rgba(0,0,0,.35);}',
      '.abx-modal-h{display:flex;align-items:center;gap:9px;padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto;}',
      '.abx-modal-t{font-size:12.5px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.abx-modal-b{padding:14px;display:flex;flex-direction:column;gap:11px;overflow:auto;min-height:0;}',
      '.abx-modal-f{display:flex;justify-content:flex-end;gap:7px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1);flex:0 0 auto;}',
      '.abx-pick{display:flex;flex-direction:column;gap:6px;}',
      '.abx-pick-row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);}',
      '.abx-pick-t{font-size:11.5px;font-weight:600;}',
      '.abx-pick-m{font-size:10px;color:var(--dsw-alias-label-secondary);margin-top:2px;}',
      '.abx-env{display:flex;flex-direction:column;gap:6px;}',
      '.abx-env-row{display:grid;grid-template-columns:150px 1fr auto;gap:6px;align-items:center;}',
      '.abx-env-row .abx-input{font-size:10.5px;}',
      '.abx-textarea{width:100%;min-height:64px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:7px 9px;font:inherit;font-size:11px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-sizing:border-box;}',
      '.abx-skills{display:flex;flex-direction:column;gap:4px;}',
      '.abx-skill{display:flex;align-items:baseline;gap:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:7px;padding:5px 8px;font:inherit;font-size:10.5px;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left;width:100%;overflow:hidden;}',
      '.abx-skill:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);}',
      '.abx-skill-at{flex:0 0 auto;font-family:var(--dsw-alias-font-mono,ui-monospace,monospace);color:var(--dsw-alias-brand-primary);}',
      '.abx-skill-d{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.abx-skill[data-on="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);}',
      '.abx-skill-bound{display:flex;align-items:baseline;gap:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:7px;padding:5px 8px;font-size:10.5px;color:var(--dsw-alias-label-primary);overflow:hidden;}',
      '.abx-skill-tag{flex:0 0 auto;margin-left:auto;font-size:9px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-state-success-primary,#2ea043);}',
      '.abx-textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary);}',
      '.abx-warn{font-size:10px;color:var(--dsw-alias-state-danger-primary,#d9534f);line-height:1.6;}',
      '.abx-ok{font-size:10px;color:var(--dsw-alias-state-success-primary,#2ea043);line-height:1.6;}',
      '.abx-empty{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.7;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:16px;}',
      '.abx-recent{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;overflow:hidden;max-width:760px;}',
      '.abx-recent-row{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:12px;padding:8px 11px;background:var(--dsw-alias-bg-layer-1);border:none;border-bottom:1px solid var(--dsw-alias-border-l1);font:inherit;font-size:11px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;}',
      '.abx-recent-row:last-child{border-bottom:none;}',
      '.abx-recent-row:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.abx-recent-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}',
      '.abx-recent-m{font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;}',
      '.abx-recent-s{font-size:10px;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);}',
      '.abx-recent-s[data-status="done"]{border-color:var(--dsw-alias-state-success-primary,#2ea043);color:var(--dsw-alias-state-success-primary,#2ea043);}',
      '.abx-recent-s[data-status="rendering"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}',
      '.abx-recent-s[data-status="failed"]{border-color:var(--dsw-alias-state-danger-primary,#d9534f);color:var(--dsw-alias-state-danger-primary,#d9534f);}',
      '.abx-chip{font-size:10px;padding:2px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap;}',
      // ---- left nav rail (collapsible) ----
      '.abx-main{flex:1;display:flex;min-height:0;overflow:hidden;}',
      '.abx-nav{flex:0 0 auto;width:166px;display:flex;flex-direction:column;gap:2px;padding:8px;border-right:1px solid var(--dsw-alias-border-l1);overflow:hidden;transition:width .12s ease;}',
      '.abx-nav[data-collapsed="true"]{width:46px;padding:8px 6px;}',
      '.abx-nav-btn{display:flex;align-items:center;gap:9px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;padding:7px 9px;border-radius:7px;cursor:pointer;text-align:left;white-space:nowrap;width:100%;}',
      '.abx-nav-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.abx-nav-btn[data-on="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);font-weight:600;}',
      '.abx-nav-btn svg{flex:0 0 auto;}',
      '.abx-nav-l{overflow:hidden;text-overflow:ellipsis;}',
      '.abx-nav-sep{height:1px;background:var(--dsw-alias-border-l1);margin:6px 4px;}',
      '.abx-nav-foot{margin-top:auto;display:flex;flex-direction:column;gap:2px;}',
      '.abx-content{flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;}',
      // ---- standalone pages (studio library / task / setting) ----
      '.abx-page{flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:14px;min-height:0;}',
      '.abx-table{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;overflow:hidden;max-width:900px;}',
      '.abx-row{display:grid;align-items:center;gap:10px;padding:8px 11px;font-size:11px;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l1);}',
      '.abx-row:last-child{border-bottom:none;}',
      '.abx-row[data-clickable="true"]{cursor:pointer;}',
      '.abx-row[data-clickable="true"]:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.abx-row-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}',
      '.abx-row-m{font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.abx-kv{display:grid;grid-template-columns:170px 1fr;gap:9px 14px;font-size:11px;max-width:900px;}',
      '.abx-kv-k{color:var(--dsw-alias-label-secondary);}',
      '.abx-kv-v{word-break:break-all;font-variant-numeric:tabular-nums;min-width:0;}',
      '.abx-kv-copy{border:none;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:10px;cursor:pointer;padding:0 0 0 6px;}',
      '.abx-bar{height:3px;border-radius:2px;background:var(--dsw-alias-border-l1);overflow:hidden;}',
      '.abx-bar-fill{height:100%;background:var(--dsw-alias-brand-primary);transition:width .3s;}',
      // ---- forge ----
      '.abx-forge{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;align-items:start;max-width:1200px;}',
      '.abx-forge-main{display:flex;flex-direction:column;gap:12px;min-width:0;}',
      '.abx-forge-side{display:flex;flex-direction:column;gap:6px;min-width:0;}',
      '.abx-forge-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;}',
      '.abx-file{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);}',
      '.abx-file-h{display:flex;align-items:center;gap:8px;padding:6px 9px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:10.5px;font-family:var(--dsw-alias-font-mono,ui-monospace,monospace);color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);}',
      '.abx-file-b{margin:0;padding:8px 10px;max-height:230px;overflow:auto;font-family:var(--dsw-alias-font-mono,ui-monospace,monospace);font-size:10px;line-height:1.55;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary);}',
      '.abx-draft{display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:7px 9px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;font:inherit;text-align:left;width:100%;color:var(--dsw-alias-label-primary);}',
      '.abx-draft:hover{border-color:var(--dsw-alias-brand-primary);}',
      '.abx-draft[data-on="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);}',
      '.abx-draft-t{font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.abx-draft-m{font-size:9.5px;color:var(--dsw-alias-label-secondary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.abx-forge-list{display:flex;flex-direction:column;gap:5px;max-height:260px;overflow:auto;}',
      '.abx-tag{font-size:9px;letter-spacing:.04em;text-transform:uppercase;padding:1px 6px;border-radius:999px;border:1px solid currentColor;}',
    ].join('\n')

    // ---------------------------------------------------------------
    // Small pieces
    // ---------------------------------------------------------------
    function Btn(props) {
      return h(
        'button',
        {
          className: 'abx-btn',
          'data-primary': props.primary ? 'true' : 'false',
          disabled: props.disabled,
          onClick: props.onClick,
          title: props.title,
        },
        props.children,
      )
    }

    function Seg(props) {
      return h(
        'div',
        { className: 'abx-seg' },
        props.options.map((option) =>
          h(
            'button',
            {
              key: String(option.value),
              className: 'abx-seg-btn',
              'data-on': String(props.value) === String(option.value) ? 'true' : 'false',
              onClick: () => props.onChange(option.value),
            },
            props.zh ? option.zh : option.en,
          ),
        ),
      )
    }

    const GLYPHS = {
      'aibench-explainer': { char: '解', bg: 'linear-gradient(135deg,#6D5EFC,#38D9A9)' },
      'aibench-reel': { char: '片', bg: 'linear-gradient(135deg,#FF4D00,#C56BFF)' },
      'aibench-data': { char: '数', bg: 'linear-gradient(135deg,#2F6BFF,#38D9A9)' },
    }

    function glyphFor(agentId) {
      return GLYPHS[agentId] || { char: String(agentId || '?').slice(0, 1).toUpperCase(), bg: 'linear-gradient(135deg,#555,#888)' }
    }

    function formatDuration(seconds) {
      const total = Math.max(0, Math.round(Number(seconds) || 0))
      const m = Math.floor(total / 60)
      const s = total % 60
      return `${m}:${String(s).padStart(2, '0')}`
    }

    function shotKindLabel(kind, zh) {
      if (kind === 'hook') return zh ? I18N.zh.shotKindHook : I18N.en.shotKindHook
      if (kind === 'process') return zh ? I18N.zh.shotKindProcess : I18N.en.shotKindProcess
      return zh ? I18N.zh.shotKindCta : I18N.en.shotKindCta
    }

    // ---------------------------------------------------------------
    // Sidebar icon (sidebar.panellist) — the sidebar owns the button and
    // dispatches layout.selectPanel(<id>), so this must be a plain glyph
    // sized by the owner props, and its id must equal the `main` key.
    // ---------------------------------------------------------------
    function makeIcon() {
      return function AiBenchIcon(props) {
        const size = (props && props.size) || 18
        return h(
          'span',
          { className: 'abx-icon', 'data-active': props && props.active ? 'true' : 'false' },
          h(
            'svg',
            { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': true },
            h('rect', { x: 8, y: 10, width: 30, height: 8, rx: 4, fill: 'currentColor' }),
            h('rect', { x: 8, y: 25, width: 44, height: 8, rx: 4, fill: 'currentColor', opacity: 0.62 }),
            h('rect', { x: 8, y: 40, width: 20, height: 8, rx: 4, fill: 'currentColor', opacity: 0.38 }),
            h('path', { d: 'M46 39l10 5.5-10 10.5z', fill: 'currentColor' }),
          ),
        )
      }
    }

    // ---------------------------------------------------------------
    // Card wall — the control panel
    // ---------------------------------------------------------------
    function makeWall(store, t, zh) {
      function AgentCard(props) {
        const { agent } = props
        const glyph = glyphFor(agent.id)
        return h(
          'div',
          { className: 'abx-agentcard' },
          h(
            'div',
            { className: 'abx-agentcard-top' },
            h('div', { className: 'abx-glyph', style: { background: glyph.bg } }, glyph.char),
            h(
              'div',
              { style: { minWidth: 0, flex: 1 } },
              h('div', { className: 'abx-agentcard-t' }, agent.name),
              h('div', { className: 'abx-agentcard-v' }, `v${agent.version}${agent.tracks && agent.tracks.length ? ` · ${t('track')} ${agent.tracks.join(' / ')}` : ''}`),
            ),
            h('span', { className: 'abx-badge', 'data-tone': 'ok' }, t('installed')),
          ),
          h('div', { className: 'abx-agentcard-d' }, agent.description || agent.id),
          h(
            'div',
            { className: 'abx-meta' },
            h('span', {}, `${t('templates')} ${agent.templates}`),
            h('span', {}, `${t('skills')} ${agent.skills ? agent.skills.length : 0}`),
            agent.tracks && agent.tracks.length ? h('span', {}, `${t('track')} ${agent.tracks.join(' / ')}`) : null,
          ),
          h(
            'div',
            { className: 'abx-agentcard-acts' },
            h(Btn, { onClick: () => props.onConfigure(agent) }, t('configure')),
            h(Btn, { primary: true, onClick: () => props.onOpen(agent) }, `▶ ${t('openStudio')}`),
            h(Btn, { onClick: () => props.onUninstall(agent) }, t('uninstall')),
          ),
        )
      }

      return function Wall(props) {
        const { agents, panel, openAgentId } = props
        const counts = (panel && panel.counts) || {}
        const renderOk = panel && panel.render && panel.render.available === true

        const header = h(
          'div',
          { className: 'abx-toolrow' },
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h('h1', { className: 'abx-h1' }, t('wallTitle')),
            h('div', { className: 'abx-hint' }, t('wallHint')),
          ),
          h(Btn, { onClick: () => props.onInstall() }, `＋ ${t('installAgent')}`),
          h(Btn, { primary: true, onClick: () => props.onDirector() }, `✨ ${t('oneClick')}`),
        )

        const grid =
          agents && agents.length > 0
            ? h(
                'div',
                { className: 'abx-cards' },
                agents.map((agent) =>
                  h(AgentCard, {
                    key: agent.id,
                    agent,
                    onOpen: () => props.onOpen(agent),
                    onConfigure: () => props.onConfigure(agent),
                    onUninstall: () => props.onUninstall(agent),
                  }),
                ),
              )
            : h(
                'div',
                { className: 'abx-empty' },
                h('div', {}, t('offline')),
                h('div', { style: { marginTop: 8 } }, h(Btn, { onClick: () => props.onInstall() }, `＋ ${t('installAgent')}`)),
              )

        const projects = props.projects || []
        const statusLabel = (status) => t(`status_${status}`) || status

        const recent =
          projects.length > 0
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h('div', { className: 'abx-sec-h' }, t('recent')),
                h(
                  'div',
                  { className: 'abx-recent' },
                  projects.slice(0, 8).map((project) =>
                    h(
                      'button',
                      {
                        key: project.id,
                        className: 'abx-recent-row',
                        onClick: () => props.onOpenProject(project),
                        title: project.brief || project.title,
                      },
                      h('span', { className: 'abx-recent-t' }, project.title || project.id),
                      h('span', { className: 'abx-recent-m' }, project.templateId || ''),
                      h('span', { className: 'abx-recent-s', 'data-status': project.status || 'draft' }, statusLabel(project.status || 'draft')),
                    ),
                  ),
                ),
              )
            : null

        const foot = h(
          'div',
          { className: 'abx-foot' },
          h('span', {}, `${t('agents')} `, h('b', null, String(agents ? agents.length : 0))),
          h('span', {}, `${t('templates')} `, h('b', null, String(counts.templates || 0))),
          h('span', {}, `${t('projects')} `, h('b', null, String(counts.projects || 0))),
          h('span', {}, `${t('renderEngine')} `, h('b', null, renderOk ? t('renderReady') : t('renderMissing'))),
          panel && panel.dataDir ? h('span', { className: 'abx-foot-path', title: panel.dataDir }, panel.dataDir) : null,
        )

        return h(React.Fragment, null, header, grid, recent, foot)
      }
    }

    // ---------------------------------------------------------------
    // Studio — one agent's workbench
    // ---------------------------------------------------------------
    function makeStudio(store, t) {
      const pick = (options, value) => {
        for (const option of options) if (String(option.value) === String(value)) return option
        return options[0]
      }

      return function Studio(props) {
        // Language comes from props, not the closure: the Setting page can change
        // it while the panel is open.
        const zh = props.zh !== false
        const label = (option) => (zh ? option.zh : option.en)
        const view = props.view
        const agent = view.agent
        const templates = view.templates || []
        const project = view.project
        const storyboard = view.storyboard
        const params = (project && project.params) || (templates[0] && templates[0].defaults) || {}
        const still = view.still
        const job = view.job

        const setParam = (patch) => props.onParams(patch)

        // ---- left: templates + seven slots ----
        const templateList =
          templates.length > 0
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                templates.map((tpl) =>
                  h(
                    'div',
                    {
                      key: tpl.id,
                      className: 'abx-tpl',
                      'data-on': project && project.templateId === tpl.id ? 'true' : 'false',
                      onClick: () => props.onPickTemplate(tpl),
                    },
                    h('div', { className: 'abx-tpl-t' }, tpl.title),
                    h(
                      'div',
                      { className: 'abx-tpl-m' },
                      `${t('track')} ${tpl.track} · ${tpl.durationSec}${t('seconds')} · ${(tpl.style && tpl.style.look) || ''}`,
                    ),
                  ),
                ),
              )
            : h('div', { className: 'abx-empty' }, t('noTemplate'))

        const left = h(
          'div',
          { className: 'abx-col abx-col-left' },
          h('div', { className: 'abx-sec-h' }, `${t('templatesTitle')} · ${templates.length}`),
          templateList,
          h('div', { className: 'abx-sec-h', style: { marginTop: 2 } }, t('paramsTitle')),
          h(
            'div',
            { className: 'abx-field' },
            h('div', { className: 'abx-field-l' }, t('look')),
            h(Seg, { options: LOOKS, value: params.style, zh, onChange: (value) => setParam({ style: value }) }),
          ),
          h(
            'div',
            { className: 'abx-field' },
            h('div', { className: 'abx-field-l' }, t('palette')),
            h(Seg, { options: PALETTES, value: params.palette, zh, onChange: (value) => setParam({ palette: value }) }),
          ),
          h(
            'div',
            { className: 'abx-field' },
            h('div', { className: 'abx-field-l' }, t('duration')),
            h(
              'div',
              { className: 'abx-seg' },
              DURATIONS.map((seconds) =>
                h(
                  'button',
                  {
                    key: seconds,
                    className: 'abx-seg-btn',
                    'data-on': Number(params.durationSec) === seconds ? 'true' : 'false',
                    onClick: () => setParam({ durationSec: seconds }),
                  },
                  `${seconds}${t('seconds')}`,
                ),
              ),
            ),
            h(Seg, { options: ASPECTS, value: params.aspect || '16:9', zh, onChange: (value) => setParam({ aspect: value }) }),
          ),
          h(
            'div',
            { className: 'abx-field' },
            h('div', { className: 'abx-field-l' }, t('bpm')),
            h(
              'div',
              { className: 'abx-seg' },
              BPM_CHOICES.map((bpm) =>
                h(
                  'button',
                  {
                    key: bpm,
                    className: 'abx-seg-btn',
                    'data-on': Number(params.beatBpm) === bpm ? 'true' : 'false',
                    onClick: () => setParam({ beatBpm: bpm }),
                  },
                  String(bpm),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'abx-field' },
            h('div', { className: 'abx-field-l' }, t('subtitleLabel')),
            h(Seg, { options: SUBTITLES, value: params.subtitle || 'bilingual', zh, onChange: (value) => setParam({ subtitle: value }) }),
          ),
          h(
            'div',
            { className: 'abx-field' },
            h('div', { className: 'abx-field-l' }, t('flow')),
            h(Seg, { options: FLOWS, value: params.flow, zh, onChange: (value) => setParam({ flow: value }) }),
          ),
        )

        // ---- center: stage + controls + shot table ----
        const aspect = (params && params.aspect) || '16:9'
        const stage =
          h(
            'div',
            { className: 'abx-stage', 'data-aspect': aspect },
            still && still.url
              ? h('img', { src: still.url, alt: 'still', key: still.url })
              : view.stillLoading
                ? h(
                    React.Fragment,
                    null,
                    h('div', { className: 'abx-spinner' }),
                    h('div', { className: 'abx-stage-empty', style: { marginTop: 10 } }, `${t('rendering')} ${t('renderingHint')}`),
                  )
                : h('div', { className: 'abx-stage-empty' }, `${t('preview')} → ${t('renderingHint')}`),
          )

        const totalFrames = storyboard ? storyboard.totalFrames : 0
        const fps = (storyboard && storyboard.fps) || 30
        const beatFrames = storyboard ? storyboard.beatFrames : 0
        const currentFrame = (still && Number.isFinite(still.frame) ? still.frame : 0) || 0
        const progressPct = totalFrames > 0 ? Math.min(100, (currentFrame / totalFrames) * 100) : 0

        const playbar = h(
          'div',
          { className: 'abx-playbar' },
          h('span', {}, `${formatDuration(currentFrame / fps)} / ${formatDuration(totalFrames / fps)}`),
          h(
            'div',
            { className: 'abx-track' },
            h('div', { className: 'abx-track-fill', style: { width: `${progressPct}%` } }),
            h('div', { className: 'abx-track-head', style: { left: `${progressPct}%` } }),
          ),
          h('span', {}, `${currentFrame} / ${totalFrames}`),
        )

        const acts = h(
          'div',
          { className: 'abx-actrow' },
          h(Btn, { primary: true, disabled: view.stillLoading || !project, onClick: () => props.onPreview(currentFrame) }, t('preview')),
          h(Btn, { disabled: view.stillLoading || !project, onClick: () => props.onPreview(Math.max(0, currentFrame - beatFrames)) }, t('prevFrame')),
          h(Btn, { disabled: view.stillLoading || !project, onClick: () => props.onPreview(Math.min(Math.max(0, totalFrames - 1), currentFrame + beatFrames)) }, t('nextFrame')),
          h('span', { style: { flex: 1 } }),
          h(Btn, { disabled: view.stillLoading || !project, onClick: () => props.onPreview(currentFrame, true) }, t('replan')),
        )

        const shotRows =
          storyboard && storyboard.shots && storyboard.shots.length > 0
            ? h(
                'div',
                { className: 'abx-shots' },
                storyboard.shots.map((shot) =>
                  h(
                    'div',
                    {
                      key: `${shot.index}-${shot.kind}`,
                      className: 'abx-shot',
                      'data-on':
                        currentFrame >= shot.from && currentFrame < shot.from + shot.durationFrames ? 'true' : 'false',
                    },
                    h('span', { className: 'abx-shot-n' }, String(shot.index).padStart(2, '0')),
                    h('span', { className: 'abx-shot-k' }, shotKindLabel(shot.kind, zh)),
                    h('span', { className: 'abx-shot-c' }, shot.copy || ''),
                    h('span', { className: 'abx-shot-r' }, `${shot.from}–${shot.from + shot.durationFrames}`),
                  ),
                ),
              )
            : null

        const note =
          beatFrames > 0
            ? h(
                'div',
                { className: 'abx-note' },
                `${t('beatNote')}：${t('beatUnit')} ${beatFrames} ${t('frames')} @${storyboard ? storyboard.beatBpm : ''}BPM`,
              )
            : null

        const center = h(
          'div',
          { className: 'abx-center' },
          stage,
          playbar,
          acts,
          storyboard
            ? h(
                'div',
                { className: 'abx-sec-h' },
                `${t('shotTable')} · ${storyboard.shots.length} · ${totalFrames} ${t('shotTotal')}`,
              )
            : null,
          shotRows,
          note,
        )

        // ---- right: one-click director ----
        const lastVideo = project && project.outputs && project.outputs.video ? project.outputs.video : null
        const busy = !!props.directorBusy
        const result = props.directorResult
        const agentSkills = (props.skills || []).filter((skill) => !agent || skill.agentId === agent.id)
        const boundSkill = agentSkills.find((skill) => skill.default) || null
        // The bound skill runs on its own, so the block leads with it as a fact
        // rather than as a button. The other skills stay clickable because they
        // are the escape hatch when the sentence really wants a different pipeline.
        const skillsBlock = agentSkills.length > 0
          ? h(
              'div',
              { className: 'abx-field' },
              h(
                'div',
                { className: 'abx-field-l' },
                boundSkill
                  ? `${t('skillsDefault')} · ${boundSkill.at}`
                  : `${t('skillsTitle')} · ${agentSkills.length}`,
              ),
              boundSkill
                ? h(
                    'div',
                    { className: 'abx-skill abx-skill-bound', title: boundSkill.description || '' },
                    h('span', { className: 'abx-skill-at' }, boundSkill.at),
                    h('span', { className: 'abx-skill-d' }, boundSkill.description || ''),
                    h('span', { className: 'abx-skill-tag' }, t('skillsAuto')),
                  )
                : null,
              agentSkills.length > (boundSkill ? 1 : 0)
                ? h(
                    'div',
                    { className: 'abx-skills' },
                    agentSkills
                      .filter((skill) => !boundSkill || skill.id !== boundSkill.id)
                      .map((skill) =>
                        h(
                          'button',
                          {
                            key: skill.id,
                            className: 'abx-skill',
                            title: skill.description || '',
                            onClick: () => props.onInsertSkill(skill),
                          },
                          h('span', { className: 'abx-skill-at' }, skill.at),
                          h('span', { className: 'abx-skill-d' }, skill.description || ''),
                        ),
                      ),
                  )
                : null,
              h('div', { className: 'abx-hint' }, boundSkill ? t('skillsDefaultHint') : t('skillsHint')),
            )
          : h('div', { className: 'abx-hint' }, t('skillsEmpty'))

        const chat = h(
          'div',
          { className: 'abx-chat' },
          h('div', { className: 'abx-bubble' }, `${t('assistant')} · ${agent ? agent.name : ''}`),
          h('div', { className: 'abx-bubble' }, t('assistantHint')),
          props.directorNote ? h('div', { className: 'abx-bubble', 'data-me': 'true' }, props.directorNote) : null,
          result && result.project
            ? h(
                'div',
                { className: 'abx-bubble' },
                h('div', null, `🎬 ${result.project.title}`),
                h(
                  'div',
                  { className: 'abx-job', style: { marginTop: 4 } },
                  `${result.director && result.director.source === 'llm' ? t('directorSourceLlm') : t('directorSourceLocal')} · ${result.project.templateId}`,
                ),
                result.director && result.director.skill
                  ? h(
                      'div',
                      { className: 'abx-job', style: { marginTop: 2 }, title: result.director.skill.description || '' },
                      `${t('directorSkill')} · ${result.director.skill.at}`,
                    )
                  : null,
                result.director && result.director.rejected && result.director.rejected.length > 0
                  ? h(
                      'div',
                      { className: 'abx-warn', style: { marginTop: 4 } },
                      `${t('directorRejected')}: ${result.director.rejected.join(', ')}`,
                    )
                  : null,
                result.director && result.director.source === 'local'
                  ? h(
                      'div',
                      { className: 'abx-job', style: { marginTop: 4 }, title: result.director.error || '' },
                      t('directorOffline'),
                    )
                  : null,
              )
            : null,
          result && result.error ? h('div', { className: 'abx-warn' }, result.error) : null,
        )

        const composer = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h(
            'div',
            { className: 'abx-field' },
            h('div', { className: 'abx-field-l' }, t('directorMode')),
            h(
              'div',
              { className: 'abx-seg' },
              h(
                'button',
                {
                  className: 'abx-seg-btn',
                  'data-on': props.directorMode !== 'random' ? 'true' : 'false',
                  onClick: () => props.onDirectorMode('template'),
                },
                t('directorTemplate'),
              ),
              h(
                'button',
                {
                  className: 'abx-seg-btn',
                  'data-on': props.directorMode === 'random' ? 'true' : 'false',
                  onClick: () => props.onDirectorMode('random'),
                },
                t('directorRandom'),
              ),
            ),
          ),
          h('textarea', {
            className: 'abx-textarea',
            placeholder: t('directorPromptPh'),
            value: props.directorPrompt || '',
            disabled: busy,
            onChange: (event) => props.onDirectorPrompt(event.target.value),
          }),
          h(
            'div',
            { className: 'abx-inputrow' },
            h(Btn, {
              primary: true,
              disabled: busy || !String(props.directorPrompt || '').trim(),
              onClick: () => props.onDirector(String(props.directorPrompt || '').trim(), props.directorMode || 'template'),
            }, busy ? t('directorRunning') : `✨ ${t('directorRun')}`),
          ),
          props.directorNoModel ? h('div', { className: 'abx-job' }, t('directorNoModel')) : null,
        )

        const jobLine = job
          ? h(
              'div',
              { className: 'abx-job' },
              `${job.status === 'done' ? t('jobDone') : job.status === 'failed' ? t('jobFailed') : t('jobRunning')} · ${job.progress || 0}%`,
              job.error ? ` · ${String(job.error).slice(0, 120)}` : '',
            )
          : null

        const preview = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
          job && job.status === 'running'
            ? h('div', { className: 'abx-progress' }, h('div', { className: 'abx-progress-fill', style: { width: `${job.progress || 0}%` } }))
            : null,
          jobLine,
          lastVideo ? h('video', { className: 'abx-video', src: lastVideo.url, controls: true }) : null,
        )

        const right = h(
          'div',
          { className: 'abx-col abx-col-right' },
          h('div', { className: 'abx-sec-h' }, t('director')),
          chat,
          skillsBlock,
          composer,
          preview,
        )

        return h(React.Fragment, null, left, center, right)
      }
    }

    // ---------------------------------------------------------------
    // Left navigation rail
    // ---------------------------------------------------------------
    // Extension point: push a section here and it shows up in the rail. A
    // section is { id, labelKey, icon?, render?(ctx) } — when `render` is
    // omitted the shell falls back to its built-in page for that id.
    const SECTIONS = [
      { id: 'agents', labelKey: 'navAgents', icon: 'agents' },
      { id: 'studio', labelKey: 'navStudio', icon: 'studio' },
      { id: 'forge', labelKey: 'navForge', icon: 'forge' },
      { id: 'tasks', labelKey: 'navTasks', icon: 'tasks' },
      { id: 'settings', labelKey: 'navSettings', icon: 'settings' },
    ]

    function registerSection(section) {
      if (!section || typeof section.id !== 'string' || !section.id) return false
      if (SECTIONS.some((item) => item.id === section.id)) return false
      SECTIONS.push(section)
      // SECTIONS is mutated in place, so React needs a nudge to re-read it.
      store.set({ sectionsVersion: (store.get().sectionsVersion || 0) + 1 })
      return true
    }

    function listSections() {
      return SECTIONS.slice()
    }

    function navIcon(name) {
      const common = {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }
      if (name === 'agents') {
        return h('svg', common, h('rect', { key: 'a', x: 2, y: 2, width: 5, height: 5, rx: 1 }), h('rect', { key: 'b', x: 9, y: 2, width: 5, height: 5, rx: 1 }), h('rect', { key: 'c', x: 2, y: 9, width: 5, height: 5, rx: 1 }), h('rect', { key: 'd', x: 9, y: 9, width: 5, height: 5, rx: 1 }))
      }
      if (name === 'studio') return h('svg', common, h('path', { d: 'M4.5 3.2 12.5 8l-8 4.8z' }))
      if (name === 'tasks') return h('svg', common, h('path', { d: 'M3 4h10M3 8h10M3 12h6' }))
      if (name === 'forge') return h('svg', common, h('path', { d: 'M8 1.8 9.6 6l4.2 1.6L9.6 9.2 8 13.4 6.4 9.2 2.2 7.6 6.4 6z' }))
      if (name === 'settings') return h('svg', common, h('circle', { cx: 8, cy: 8, r: 2.6 }), h('path', { d: 'M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8' }))
      if (name === 'collapse') return h('svg', common, h('path', { d: 'M10 3.5 5.5 8l4.5 4.5' }))
      if (name === 'expand') return h('svg', common, h('path', { d: 'M6 3.5 10.5 8 6 12.5' }))
      return h('svg', common, h('circle', { cx: 8, cy: 8, r: 3 }))
    }

    function makeNav(store, t, zh) {
      return function Nav(props) {
        const { sections, active, collapsed, onSelect, onToggle } = props
        return h(
          'nav',
          { className: 'abx-nav', 'data-collapsed': collapsed ? 'true' : 'false', 'aria-label': t('title') },
          sections.map((section) =>
            h(
              'button',
              {
                key: section.id,
                className: 'abx-nav-btn',
                'data-on': section.id === active ? 'true' : 'false',
                title: t(section.labelKey) || section.id,
                onClick: () => onSelect(section.id),
              },
              navIcon(section.icon || section.id),
              collapsed ? null : h('span', { className: 'abx-nav-l' }, t(section.labelKey) || section.id),
            ),
          ),
          h('div', { className: 'abx-nav-sep' }),
          h(
            'div',
            { className: 'abx-nav-foot' },
            h(
              'button',
              {
                className: 'abx-nav-btn',
                title: collapsed ? t('navExpand') : t('navCollapse'),
                onClick: onToggle,
              },
              navIcon(collapsed ? 'expand' : 'collapse'),
              collapsed ? null : h('span', { className: 'abx-nav-l' }, t('navCollapse')),
            ),
          ),
        )
      }
    }

    // ---------------------------------------------------------------
    // Studio home — resume a project or start from an agent
    // ---------------------------------------------------------------
    function makeStudioHome(store, t, zh) {
      const statusLabel = (status) => t(`status_${status}`) || status
      return function StudioHome(props) {
        const { agents, projects } = props
        const recent = props.projects || []
        return h(
          'div',
          { className: 'abx-page' },
          h(
            'div',
            { className: 'abx-toolrow' },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('h1', { className: 'abx-h1' }, t('studioTitle')),
              h('div', { className: 'abx-hint' }, t('studioHint')),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('div', { className: 'abx-sec-h' }, t('recent')),
            recent.length === 0
              ? h('div', { className: 'abx-empty' }, t('emptyProjects'))
              : h(
                  'div',
                  { className: 'abx-table' },
                  recent.slice(0, 20).map((project) =>
                    h(
                      'button',
                      {
                        key: project.id,
                        className: 'abx-row',
                        'data-clickable': 'true',
                        style: { gridTemplateColumns: '1fr auto auto', border: 'none', font: 'inherit', textAlign: 'left', cursor: 'pointer', color: 'inherit', width: '100%' },
                        onClick: () => props.onOpenProject(project),
                        title: project.brief || project.title,
                      },
                      h('span', { className: 'abx-row-t' }, project.title || project.id),
                      h('span', { className: 'abx-row-m' }, project.agentId || ''),
                      h('span', { className: 'abx-recent-s', 'data-status': project.status || 'draft' }, statusLabel(project.status || 'draft')),
                    ),
                  ),
                ),
          ),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('div', { className: 'abx-sec-h' }, t('navAgents')),
            h(
              'div',
              { className: 'abx-cards' },
              (agents || []).map((agent) =>
                h(
                  'div',
                  { key: agent.id, className: 'abx-agentcard' },
                  h(
                    'div',
                    { className: 'abx-agentcard-top' },
                    h('div', { className: 'abx-glyph', style: { background: glyphFor(agent.id).bg } }, glyphFor(agent.id).char),
                    h(
                      'div',
                      { style: { minWidth: 0, flex: 1 } },
                      h('div', { className: 'abx-agentcard-t' }, agent.name),
                      h('div', { className: 'abx-agentcard-v' }, `${t('templates')} ${agent.templates}`),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'abx-agentcard-acts' },
                    h(Btn, { primary: true, onClick: () => props.onOpen(agent) }, `▶ ${t('openStudio')}`),
                  ),
                ),
              ),
            ),
          ),
        )
      }
    }

    // ---------------------------------------------------------------
    // Tasks — the render queue
    // ---------------------------------------------------------------
    function makeTasks(store, t, zh) {
      return function Tasks(props) {
        const { jobs, projects } = props
        const titleOf = (projectId) => {
          const found = (projects || []).find((item) => item.id === projectId)
          return found ? found.title : projectId
        }
        const statusLabel = (job) => {
          if (job.status === 'running') return t('taskRunning')
          if (job.status === 'done') return t('jobDone')
          return t('jobFailed')
        }
        return h(
          'div',
          { className: 'abx-page' },
          h(
            'div',
            { className: 'abx-toolrow' },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('h1', { className: 'abx-h1' }, t('taskTitle')),
              h('div', { className: 'abx-hint' }, t('taskHint')),
            ),
            h(Btn, { onClick: props.onRefresh }, t('refresh')),
          ),
          (jobs || []).length === 0
            ? h('div', { className: 'abx-empty' }, t('taskEmpty'))
            : h(
                'div',
                { className: 'abx-table' },
                jobs.map((job) =>
                  h(
                    'div',
                    {
                      key: job.id,
                      className: 'abx-row',
                      style: { gridTemplateColumns: '58px 1fr 96px 78px 150px' },
                    },
                    h('span', { className: 'abx-shot-k' }, job.kind === 'still' ? t('taskKindStill') : t('taskKindRender')),
                    h(
                      'span',
                      { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 } },
                      h('span', { className: 'abx-row-t' }, titleOf(job.projectId)),
                      job.status === 'running'
                        ? h('span', { className: 'abx-bar' }, h('span', { className: 'abx-bar-fill', style: { width: `${job.progress || 0}%`, display: 'block' } }))
                        : null,
                    ),
                    h('span', { className: 'abx-row-m' }, `${job.width}×${job.height}`),
                    h(
                      'span',
                      { className: 'abx-recent-s', 'data-status': job.status === 'done' ? 'done' : job.status === 'running' ? 'rendering' : 'failed' },
                      statusLabel(job),
                    ),
                    h(
                      'span',
                      { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
                      job.output
                        ? h(
                            'a',
                            {
                              className: 'abx-btn',
                              href: job.output,
                              target: '_blank',
                              rel: 'noopener',
                              style: { textDecoration: 'none', display: 'inline-block' },
                            },
                            t('open'),
                          )
                        : h('span', { className: 'abx-row-m' }, job.error ? job.error.slice(0, 40) : ''),
                    ),
                  ),
                ),
              ),
        )
      }
    }

    // ---------------------------------------------------------------
    // Settings — read-only facts + the few preferences we persist
    // ---------------------------------------------------------------
    function makeSettings(store, t, zh) {
      return function Settings(props) {
        const panel = props.panel || {}
        const render = panel.render || {}
        const settings = props.settings || {}
        const zhNow = props.zh !== undefined ? props.zh : zh
        // Long filesystem paths are unreadable when they wrap, so every path-ish
        // value gets a copy button instead of forcing the user to select text.
        // `navigator.clipboard` can hang forever when the document lacks the
        // clipboard-write permission, so race it and fall back to the legacy
        // selection trick rather than leaving the click silently dead.
        const copy = async (value) => {
          const text = String(value)
          const legacy = () => {
            try {
              const area = document.createElement('textarea')
              area.value = text
              area.setAttribute('readonly', '')
              area.style.position = 'fixed'
              area.style.opacity = '0'
              document.body.appendChild(area)
              area.select()
              const ok = document.execCommand('copy')
              document.body.removeChild(area)
              return ok
            } catch {
              return false
            }
          }
          let ok = false
          try {
            const clipboard = navigator.clipboard
            if (clipboard && typeof clipboard.writeText === 'function') {
              ok = await Promise.race([
                clipboard.writeText(text).then(() => true),
                new Promise((resolve) => setTimeout(() => resolve(false), 500)),
              ])
            }
          } catch {
            ok = false
          }
          if (!ok) ok = legacy()
          store.set({ notice: ok ? t('copied') : t('copyFailed') })
        }
        const row = (key, value, options) => {
          const text = value === undefined || value === null || value === '' ? '—' : String(value)
          const canCopy = options && options.copy === true && text !== '—'
          return h(
            React.Fragment,
            { key },
            h('div', { className: 'abx-kv-k' }, key),
            h(
              'div',
              { className: 'abx-kv-v' },
              text,
              canCopy
                ? h(
                    'button',
                    { className: 'abx-kv-copy', title: t('copy'), onClick: () => copy(text) },
                    t('copy'),
                  )
                : null,
            ),
          )
        }
        return h(
          'div',
          { className: 'abx-page' },
          h(
            'div',
            { className: 'abx-toolrow' },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('h1', { className: 'abx-h1' }, t('settingTitle')),
              h('div', { className: 'abx-hint' }, t('settingHint')),
            ),
            h(Btn, { onClick: props.onRefresh }, t('refresh')),
          ),
          h(
            'div',
            { className: 'abx-kv' },
            row(t('settingData'), panel.dataDir, { copy: true }),
            row(t('settingAgentsDir'), panel.agentsDir, { copy: true }),
            row(t('settingProjectsDir'), panel.projectsDir, { copy: true }),
            row(t('settingRender'), render.available ? `${t('renderReady')} ✓` : t('renderMissing')),
            row(t('settingEngine'), render.engine),
            row(t('settingRenderCli'), render.cli, { copy: true }),
            row(t('settingVersion'), `${panel.name || BRAND} ${panel.version || ''}`),
            row(t('settingNode'), panel.node),
            row(t('settingPlatform'), panel.platform),
          ),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 900 } },
            h('div', { className: 'abx-sec-h' }, t('settingLocale')),
            h(
              'div',
              { className: 'abx-seg' },
              [
                { value: 'zh', zh: '中文', en: '中文' },
                { value: 'en', zh: 'English', en: 'English' },
              ].map((option) =>
                h(
                  'button',
                  {
                    key: option.value,
                    className: 'abx-seg-btn',
                    'data-on': (settings.locale || 'zh') === option.value ? 'true' : 'false',
                    onClick: () => props.onLocale(option.value),
                  },
                  zhNow ? option.zh : option.en,
                ),
              ),
            ),
            h('div', { className: 'abx-hint' }, t('settingLocaleHint')),
          ),
        )
      }
    }

    // ---------------------------------------------------------------
    // Forge — build an agent package from one sentence
    // ---------------------------------------------------------------
    // The Host does the scaffolding; this page only collects the sentence and
    // shows what came out. Nothing here needs a model: `refine` is optional
    // polish, and the page says so instead of failing when no route is up.
    function makeForge(store, t, zh) {
      const zhNow = () => (store.get().settings && store.get().settings.locale ? String(store.get().settings.locale).toLowerCase().indexOf('en') !== 0 : zh)
      return function Forge(props) {
        // Every list the page iterates must exist here: the first paint happens
        // before `/forge/blueprint` resolves, and a missing key would throw
        // inside the render instead of showing an empty picker.
        const blueprint = props.blueprint || {
          tracks: [],
          looks: [],
          palettes: [],
          aspects: [],
          durations: [],
          bpms: [],
          subtitles: [],
          constraints: [],
        }
        const drafts = props.drafts || []
        const draft = props.draft
        const validation = props.validation
        const pick = (options, value) =>
          (options || []).map((option) =>
            h(
              'button',
              {
                key: String(option.value),
                className: 'abx-seg-btn',
                'data-on': String(option.value) === String(value) ? 'true' : 'false',
                onClick: () => props.onForm({ [option.field]: option.value }),
              },
              option.label,
            ),
          )

        return h(
          'div',
          { className: 'abx-page' },
          h(
            'div',
            { className: 'abx-toolrow' },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('h1', { className: 'abx-h1' }, t('forgeTitle')),
              h('div', { className: 'abx-hint' }, t('forgeHint')),
            ),
            h(Btn, { onClick: props.onRefresh, disabled: props.busy === 'load' }, props.busy === 'load' ? t('loading') : t('refresh')),
          ),
          h(
            'div',
            { className: 'abx-forge' },
            // ---- left: the sentence + the result ----
            h(
              'div',
              { className: 'abx-forge-main' },
              h(
                'div',
                { className: 'abx-field' },
                h('div', { className: 'abx-field-l' }, t('forgeGoal')),
                h('textarea', {
                  className: 'abx-textarea',
                  placeholder: t('forgeGoalPh'),
                  value: props.form.goal || '',
                  onChange: (event) => props.onForm({ goal: event.target.value }),
                }),
              ),
              h(
                'div',
                { className: 'abx-field' },
                h('div', { className: 'abx-field-l' }, t('forgeTrack')),
                h('div', { className: 'abx-seg', style: { flexWrap: 'wrap' } },
                  blueprint.tracks.map((track) =>
                    h(
                      'button',
                      {
                        key: track.id,
                        className: 'abx-seg-btn',
                        'data-on': props.form.track === track.id ? 'true' : 'false',
                        title: track.hint,
                        onClick: () => props.onForm({ track: track.id }),
                      },
                      `${track.id} ${zhNow() ? track.name : track.id}`,
                    ),
                  ),
                ),
              ),
              h(
                'div',
                { className: 'abx-field' },
                h('div', { className: 'abx-field-l' }, t('forgeAdvanced')),
                h(
                  'div',
                  { className: 'abx-forge-grid' },
                  h('div', { className: 'abx-field' },
                    h('div', { className: 'abx-field-l' }, t('look')),
                    h('div', { className: 'abx-seg', style: { flexWrap: 'wrap' } },
                      pick(blueprint.looks.map((id, index) => ({ value: id, field: 'look', label: LOOKS.find((l) => l.value === index) ? (zhNow() ? LOOKS.find((l) => l.value === index).zh : LOOKS.find((l) => l.value === index).en) : id })), props.form.look),
                    ),
                  ),
                  h('div', { className: 'abx-field' },
                    h('div', { className: 'abx-field-l' }, t('palette')),
                    h('div', { className: 'abx-seg', style: { flexWrap: 'wrap' } },
                      pick(blueprint.palettes.map((name) => ({ value: name, field: 'palette', label: name })), props.form.palette),
                    ),
                  ),
                  h('div', { className: 'abx-field' },
                    h('div', { className: 'abx-field-l' }, t('frame')),
                    h('div', { className: 'abx-seg' },
                      pick(blueprint.aspects.map((value) => ({ value, field: 'aspect', label: value })), props.form.aspect),
                    ),
                  ),
                  h('div', { className: 'abx-field' },
                    h('div', { className: 'abx-field-l' }, t('duration')),
                    h('div', { className: 'abx-seg', style: { flexWrap: 'wrap' } },
                      pick(blueprint.durations.map((value) => ({ value, field: 'durationSec', label: `${value}s` })), props.form.durationSec),
                    ),
                  ),
                  h('div', { className: 'abx-field' },
                    h('div', { className: 'abx-field-l' }, t('bpm')),
                    h('div', { className: 'abx-seg', style: { flexWrap: 'wrap' } },
                      pick(blueprint.bpms.map((value) => ({ value, field: 'beatBpm', label: String(value) })), props.form.beatBpm),
                    ),
                  ),
                  h('div', { className: 'abx-field' },
                    h('div', { className: 'abx-field-l' }, t('subtitleLabel')),
                    h('div', { className: 'abx-seg', style: { flexWrap: 'wrap' } },
                      pick(blueprint.subtitles.map((value) => ({ value, field: 'subtitle', label: value })), props.form.subtitle),
                    ),
                  ),
                ),
              ),
              h(
                'div',
                { className: 'abx-inputrow' },
                h(Btn, {
                  primary: true,
                  disabled: props.busy === 'create' || !String(props.form.goal || '').trim(),
                  onClick: props.onCreate,
                }, props.busy === 'create' ? t('forgeCreating') : `✨ ${t('forgeCreate')}`),
              ),
              draft
                ? h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
                    h(
                      'div',
                      { className: 'abx-toolrow' },
                      h(
                        'div',
                        { style: { flex: 1, minWidth: 0 } },
                        h('div', { className: 'abx-sec-h' }, `${t('forgeFiles')} · ${draft.id}`),
                        h('div', { className: 'abx-hint' }, `${draft.meta?.agentId || ''} · ${draft.meta?.track || ''} · ${draft.meta?.look || ''}`),
                      ),
                      h(Btn, { onClick: props.onValidate, disabled: props.busy === 'validate' }, t('forgeValidate')),
                      h(Btn, { onClick: props.onRefine, disabled: props.busy === 'refine' }, props.busy === 'refine' ? t('forgeRefining') : t('forgeRefine')),
                      h(Btn, {
                        primary: true,
                        disabled: props.busy === 'install' || !validation || !validation.ok,
                        onClick: props.onInstall,
                      }, props.busy === 'install' ? t('forgeInstalling') : t('forgeInstall')),
                      h(Btn, { onClick: props.onDelete, disabled: props.busy === 'delete' }, t('forgeDelete')),
                    ),
                    validation
                      ? h(
                          'div',
                          { className: validation.ok ? 'abx-ok' : 'abx-warn' },
                          validation.ok ? `✓ ${t('forgeValid')}` : `✗ ${t('forgeInvalid')}`,
                          (validation.errors || []).length > 0
                            ? h('div', null, `${t('forgeErrors')}：`, h('ul', { style: { margin: '3px 0 0 16px' } }, validation.errors.map((e, i) => h('li', { key: i }, e))))
                            : null,
                          (validation.warnings || []).length > 0
                            ? h('div', { style: { marginTop: 4 } }, `${t('forgeWarnings')}：`, h('ul', { style: { margin: '3px 0 0 16px' } }, validation.warnings.map((w, i) => h('li', { key: i }, w))))
                            : null,
                        )
                      : null,
                    (draft.files || []).map((file) =>
                      h(
                        'div',
                        { key: file.path, className: 'abx-file' },
                        h('div', { className: 'abx-file-h' }, file.path),
                        h('pre', { className: 'abx-file-b' }, file.content),
                      ),
                    ),
                  )
                : null,
            ),
            // ---- right: existing drafts ----
            h(
              'div',
              { className: 'abx-forge-side' },
              h('div', { className: 'abx-sec-h' }, `${t('forgeDrafts')} · ${drafts.length}`),
              drafts.length === 0
                ? h('div', { className: 'abx-empty' }, t('forgeEmpty'))
                : h(
                    'div',
                    { className: 'abx-forge-list' },
                    drafts.map((item) =>
                      h(
                        'button',
                        {
                          key: item.id,
                          className: 'abx-draft',
                          'data-on': draft && draft.id === item.id ? 'true' : 'false',
                          onClick: () => props.onPick(item.id),
                        },
                        h(
                          'div',
                          { style: { minWidth: 0 } },
                          h('div', { className: 'abx-draft-t' }, item.goal || item.agentId || item.id),
                          h('div', { className: 'abx-draft-m' }, `${item.agentId || ''} · ${item.track || ''}`),
                        ),
                        h('span', { className: 'abx-tag', style: { color: 'var(--dsw-alias-label-secondary)' } }, item.look || ''),
                      ),
                    ),
                  ),
            ),
          ),
        )
      }
    }

    // ---------------------------------------------------------------
    // Shell (main panel)
    // ---------------------------------------------------------------
    // ---------------------------------------------------------------
    // Overlays: install / uninstall / environment / one-click director
    // ---------------------------------------------------------------
    // One factory for all four so they share the mask, header and footer
    // rhythm; each returns null when its state says "closed".
    function makeModals(t) {
      function Mask(props) {
        return h(
          'div',
          {
            className: 'abx-mask',
            // Clicking the backdrop dismisses, but only the backdrop itself:
            // the modal stops propagation so a click inside never closes it.
            onClick: (event) => {
              if (event.target === event.currentTarget) props.onClose()
            },
          },
          h(
            'div',
            { className: 'abx-modal', onClick: (event) => event.stopPropagation() },
            h(
              'div',
              { className: 'abx-modal-h' },
              h('span', { className: 'abx-modal-t' }, props.title),
              h('button', { className: 'abx-x', onClick: props.onClose, 'aria-label': t('cancel') }, '×'),
            ),
            h('div', { className: 'abx-modal-b' }, props.children),
            props.footer ? h('div', { className: 'abx-modal-f' }, props.footer) : null,
          ),
        )
      }

      function InstallModal(props) {
        // The Host reports every built-in with an `installed` flag; the list
        // here is only the ones you can still add.
        const items = props.available === null ? null : (props.available || []).filter((item) => !item.installed)
        return h(
          Mask,
          { title: t('installTitle'), onClose: props.onClose },
          h('div', { className: 'abx-hint' }, t('installHint')),
          h('div', { className: 'abx-sec-h' }, t('installBuiltin')),
          items === null
            ? h('div', { className: 'abx-job' }, t('loading'))
            : items.length === 0
              ? h('div', { className: 'abx-job' }, t('installAllInstalled'))
              : h(
                  'div',
                  { className: 'abx-pick' },
                  items.map((item) =>
                    h(
                      'div',
                      { key: item.id, className: 'abx-pick-row' },
                      h(
                        'div',
                        { style: { minWidth: 0 } },
                        h('div', { className: 'abx-pick-t' }, item.name || item.id),
                        h('div', { className: 'abx-pick-m' }, `${item.id} · v${item.version || '0.1.0'}`),
                      ),
                      h(Btn, {
                        primary: true,
                        disabled: props.busy === item.id,
                        onClick: () => props.onInstall({ id: item.id }),
                      }, props.busy === item.id ? t('installing') : t('install')),
                    ),
                  ),
                ),
          h('div', { className: 'abx-sec-h' }, t('installFromDir')),
          h(
            'div',
            { className: 'abx-field' },
            h('div', { className: 'abx-field-l' }, t('installPath')),
            h('input', {
              className: 'abx-input',
              placeholder: t('installPathPh'),
              value: props.path,
              onChange: (event) => props.onPath(event.target.value),
            }),
          ),
          h(
            'div',
            { className: 'abx-inputrow' },
            h(Btn, {
              disabled: props.busy === 'path' || !String(props.path || '').trim(),
              onClick: () => props.onInstall({ path: String(props.path || '').trim() }),
            }, props.busy === 'path' ? t('installing') : t('install')),
          ),
        )
      }

      function ConfirmModal(props) {
        return h(
          Mask,
          { title: props.title, onClose: props.onClose, footer: props.footer },
          h('div', { className: 'abx-warn' }, props.message),
          props.detail ? h('div', { className: 'abx-job' }, props.detail) : null,
        )
      }

      function ConfigModal(props) {
        const draft = props.draft
        const setDraft = props.onDraft
        if (!draft) {
          return h(Mask, { title: t('configTitle'), onClose: props.onClose }, h('div', { className: 'abx-job' }, t('loading')))
        }
        const rows = draft.envRows || []
        return h(
          Mask,
          {
            title: `${t('configTitle')} · ${props.agent ? props.agent.name || props.agent.id : ''}`,
            onClose: props.onClose,
            footer: h(
              React.Fragment,
              null,
              h(Btn, { onClick: props.onClose }, t('cancel')),
              h(Btn, { primary: true, disabled: props.busy, onClick: props.onSave }, props.busy ? t('saving') : t('save')),
            ),
          },
          h('div', { className: 'abx-hint' }, t('configHint')),
          h(
            'div',
            { className: 'abx-field' },
            h('div', { className: 'abx-field-l' }, t('configProvider')),
            h('input', {
              className: 'abx-input',
              placeholder: 'workbuddy',
              value: draft.provider || '',
              onChange: (event) => setDraft({ ...draft, provider: event.target.value }),
            }),
          ),
          h(
            'div',
            { className: 'abx-field' },
            h('div', { className: 'abx-field-l' }, t('configModel')),
            h('input', {
              className: 'abx-input',
              placeholder: 'deepseek-v4.1-flash',
              value: draft.model || '',
              onChange: (event) => setDraft({ ...draft, model: event.target.value }),
            }),
            h('div', { className: 'abx-job' }, t('configModelHint')),
          ),
          h(
            'div',
            { className: 'abx-field' },
            h('div', { className: 'abx-field-l' }, t('configSkill')),
            (props.skills || []).length === 0
              ? h('div', { className: 'abx-job' }, t('configSkillNone'))
              : h(
                  'div',
                  { className: 'abx-skills' },
                  (props.skills || []).map((skill) => {
                    // An agent with a single skill runs it with no explicit pick.
                    // Showing that as unselected would read as "nothing is bound"
                    // when in fact it is — mark it active and tag it as implicit.
                    const explicit = (draft.skill || '') === skill.name
                    const implicit = !draft.skill && (props.skills || []).length === 1
                    const active = explicit || implicit
                    return h(
                      'button',
                      {
                        key: skill.id,
                        className: 'abx-skill',
                        'data-on': active ? 'true' : 'false',
                        title: skill.description || '',
                        onClick: () =>
                          // Clicking the already-bound skill clears it: that is the
                          // only way back to "no explicit pick" without a menu.
                          setDraft({ ...draft, skill: explicit ? '' : skill.name }),
                      },
                      h('span', { className: 'abx-skill-at' }, skill.at),
                      h('span', { className: 'abx-skill-d' }, skill.description || ''),
                      implicit ? h('span', { className: 'abx-skill-tag' }, t('skillsAuto')) : null,
                    )
                  }),
                ),
            h('div', { className: 'abx-job' }, t('configSkillHint')),
          ),
          h('div', { className: 'abx-sec-h' }, t('configEnv')),
          rows.length === 0 ? h('div', { className: 'abx-job' }, t('configEnvEmpty')) : null,
          h(
            'div',
            { className: 'abx-env' },
            rows.map((row, index) =>
              h(
                'div',
                { key: index, className: 'abx-env-row' },
                h('input', {
                  className: 'abx-input',
                  placeholder: t('configEnvKey'),
                  value: row.key,
                  onChange: (event) => {
                    const next = rows.slice()
                    next[index] = { ...row, key: event.target.value }
                    setDraft({ ...draft, envRows: next })
                  },
                }),
                h('input', {
                  className: 'abx-input',
                  placeholder: t('configEnvValue'),
                  value: row.value,
                  onChange: (event) => {
                    const next = rows.slice()
                    next[index] = { ...row, value: event.target.value }
                    setDraft({ ...draft, envRows: next })
                  },
                }),
                h(Btn, {
                  onClick: () => setDraft({ ...draft, envRows: rows.filter((_, i) => i !== index) }),
                }, t('configRemoveEnv')),
              ),
            ),
          ),
          h(Btn, {
            onClick: () => setDraft({ ...draft, envRows: [...rows, { key: '', value: '' }] }),
          }, t('configAddEnv')),
        )
      }

      function DirectorModal(props) {
        const busy = props.busy
        const noModel = props.models && props.models.available && props.models.available.length === 0
        return h(
          Mask,
          {
            title: t('directorTitle'),
            onClose: props.onClose,
            footer: h(
              React.Fragment,
              null,
              h(Btn, { onClick: props.onClose }, t('cancel')),
              h(Btn, {
                primary: true,
                disabled: busy || !String(props.prompt || '').trim(),
                onClick: () => props.onRun(String(props.prompt || '').trim(), props.mode || 'template'),
              }, busy ? t('directorRunning') : `✨ ${t('directorRun')}`),
            ),
          },
          h('div', { className: 'abx-hint' }, t('directorHint')),
          h(
            'div',
            { className: 'abx-field' },
            h('div', { className: 'abx-field-l' }, t('directorMode')),
            h(
              'div',
              { className: 'abx-seg' },
              h('button', {
                className: 'abx-seg-btn',
                'data-on': props.mode !== 'random' ? 'true' : 'false',
                onClick: () => props.onMode('template'),
              }, t('directorTemplate')),
              h('button', {
                className: 'abx-seg-btn',
                'data-on': props.mode === 'random' ? 'true' : 'false',
                onClick: () => props.onMode('random'),
              }, t('directorRandom')),
            ),
          ),
          h('textarea', {
            className: 'abx-textarea',
            placeholder: t('directorPromptPh'),
            value: props.prompt || '',
            disabled: busy,
            onChange: (event) => props.onPrompt(event.target.value),
          }),
          noModel ? h('div', { className: 'abx-job' }, t('directorNoModel')) : null,
          props.error ? h('div', { className: 'abx-warn' }, props.error) : null,
        )
      }

      return { Mask, InstallModal, ConfirmModal, ConfigModal, DirectorModal }
    }

    function makeShell(store, t, zh) {
      const Wall = makeWall(store, t, zh)
      const Studio = makeStudio(store, t)
      const Nav = makeNav(store, t, zh)
      const StudioHome = makeStudioHome(store, t, zh)
      const Tasks = makeTasks(store, t, zh)
      const Settings = makeSettings(store, t, zh)
      const Forge = makeForge(store, t, zh)
      const Modals = makeModals(t)

      // `zh` above is the language DSH started with; a preference saved by the
      // Setting page overrides it while the panel stays open.
      const isZh = () => {
        const pref = store.get().settings && store.get().settings.locale
        return pref ? String(pref).toLowerCase().indexOf('en') !== 0 : zh
      }

      return function AiBenchShell(props) {
        const state = useStore(store)
        const [viewState, setViewState] = React.useState({ mode: 'wall' })
        // `section` is the left-rail selection; `collapsed` is its fold state.
        // Both live here rather than in the module store because they are pure
        // view concerns and reset when the panel remounts.
        const [section, setSection] = React.useState('agents')
        const [collapsed, setCollapsed] = React.useState(false)
        const pollRef = React.useRef(null)

        // ---- overlays: install / uninstall / environment / one-click ----
        const [installOpen, setInstallOpen] = React.useState(false)
        const [installPath, setInstallPath] = React.useState('')
        const [installBusy, setInstallBusy] = React.useState('')
        const [available, setAvailable] = React.useState(null)
        const [uninstallTarget, setUninstallTarget] = React.useState(null)
        const [configTarget, setConfigTarget] = React.useState(null)
        const [configDraft, setConfigDraft] = React.useState(null)
        const [configSkills, setConfigSkills] = React.useState(null)
        const [configBusy, setConfigBusy] = React.useState(false)
        const [directorOpen, setDirectorOpen] = React.useState(false)
        const [directorPrompt, setDirectorPrompt] = React.useState('')
        const [directorMode, setDirectorMode] = React.useState('template')
        const [directorBusy, setDirectorBusy] = React.useState(false)
        const [directorResult, setDirectorResult] = React.useState(null)
        const [directorNote, setDirectorNote] = React.useState('')
        const [models, setModels] = React.useState(null)

        // ---- forge ----
        const [blueprint, setBlueprint] = React.useState(null)
        const [drafts, setDrafts] = React.useState([])
        const [draft, setDraft] = React.useState(null)
        const [validation, setValidation] = React.useState(null)
        const [forgeBusy, setForgeBusy] = React.useState('')
        const [forgeForm, setForgeForm] = React.useState({
          goal: '',
          track: '1.3',
          look: '',
          palette: '',
          aspect: '',
          durationSec: 20,
          beatBpm: 120,
          subtitle: 'zh',
        })

        const stopPoll = React.useCallback(() => {
          if (pollRef.current) {
            clearTimeout(pollRef.current)
            pollRef.current = null
          }
        }, [])

        // ---- data loads ----
        const refresh = React.useCallback(async () => {
          store.set({ loading: true, notice: '' })
          const info = await getJson('/panel/info')
          if (!info.ok) {
            store.set({ loading: false, notice: `${t('offline')} — ${info.error}`, panel: null })
            return
          }
          const [agents, projects, jobs, settings, skills] = await Promise.all([
            getJson('/agents'),
            getJson('/projects'),
            getJson('/jobs'),
            getJson('/panel/settings'),
            getJson('/skills'),
          ])
          store.set({
            loading: false,
            panel: info.payload,
            agents: agents.ok ? agents.payload.items || [] : [],
            projects: projects.ok ? projects.payload.items || [] : [],
            jobs: jobs.ok ? jobs.payload.items || [] : [],
            settings: settings.ok ? settings.payload.settings || {} : {},
            skills: skills.ok ? skills.payload.items || [] : [],
            notice: agents.ok && projects.ok ? '' : agents.error || projects.error,
          })
        }, [])

        const openAgent = React.useCallback(
          async (agent) => {
            stopPoll()
            // A skill handle from the previous agent would resolve to nothing here.
            setDirectorPrompt('')
            setDirectorResult(null)
            setDirectorNote('')
            setViewState({ mode: 'studio', agent, templates: [], project: null, storyboard: null, still: null, stillLoading: false, job: null })
            const tpl = await getJson(`/templates?agentId=${encodeURIComponent(agent.id)}`)
            const templates = tpl.ok ? tpl.payload.items || [] : []
            setViewState((prev) => (prev.mode === 'studio' && prev.agent.id === agent.id ? { ...prev, templates } : prev))
            if (templates.length > 0) await createProject(agent, templates[0])
          },
          [stopPoll],
        )

        // Resume a project listed on the wall: same studio, but skip creating a
        // new project and reuse the stored params so the picture matches the disk.
        const openProject = React.useCallback(
          async (project) => {
            stopPoll()
            // A skill handle from the previous agent would resolve to nothing here.
            setDirectorPrompt('')
            setDirectorResult(null)
            setDirectorNote('')
            const agent = (store.get().agents || []).find((item) => item.id === project.agentId) || { id: project.agentId, name: project.agentId }
            setViewState({ mode: 'studio', agent, templates: [], project, storyboard: null, still: null, stillLoading: false, job: null })
            const [tpl, sb] = await Promise.all([
              getJson(`/templates?agentId=${encodeURIComponent(project.agentId)}`),
              getJson(`/projects/${project.id}/storyboard`),
            ])
            const templates = tpl.ok ? tpl.payload.items || [] : []
            setViewState((prev) => (prev.project && prev.project.id === project.id ? { ...prev, templates } : prev))
            if (sb.ok) {
              setViewState((prev) => (prev.project && prev.project.id === project.id ? { ...prev, storyboard: sb.payload.storyboard } : prev))
              const hook = (sb.payload.storyboard.shots || []).find((shot) => shot.kind === 'hook') || sb.payload.storyboard.shots[0]
              if (hook) await renderStill(project.id, hook.from + Math.floor(hook.durationFrames / 2))
            }
          },
          [stopPoll],
        )

        const createProject = React.useCallback(
          async (agent, template) => {
            const created = await postJson('/projects', {
              templateId: template.id,
              title: template.title,
              brief: template.brief,
            })
            if (!created.ok) {
              store.set({ notice: created.error })
              return
            }
            const project = created.payload.project
            setViewState((prev) => ({
              ...prev,
              project,
              storyboard: null,
              still: null,
              job: null,
            }))
            const sb = await getJson(`/projects/${project.id}/storyboard`)
            if (sb.ok) {
              setViewState((prev) => (prev.project && prev.project.id === project.id ? { ...prev, storyboard: sb.payload.storyboard } : prev))
              // Auto-render the hook midpoint so the stage is never blank.
              const hook = (sb.payload.storyboard.shots || []).find((shot) => shot.kind === 'hook') || sb.payload.storyboard.shots[0]
              if (hook) {
                const frame = hook.from + Math.floor(hook.durationFrames / 2)
                renderStill(project.id, frame)
              }
            }
          },
          [],
        )

        const renderStill = React.useCallback(async (projectId, frame) => {
          setViewState((prev) => ({ ...prev, stillLoading: true }))
          const res = await postJson('/still', { projectId, frame })
          if (!res.ok) {
            setViewState((prev) => ({ ...prev, stillLoading: false }))
            store.set({ notice: res.error })
            return
          }
          setViewState((prev) => ({
            ...prev,
            stillLoading: false,
            still: { url: res.payload.image, frame: res.payload.frame, width: res.payload.width, height: res.payload.height },
            storyboard: res.payload.storyboard || prev.storyboard,
            project: prev.project ? { ...prev.project, params: { ...prev.project.params } } : prev.project,
          }))
        }, [])

        const onParams = React.useCallback(
          async (patch) => {
            const prev = viewState
            if (prev.mode !== 'studio' || !prev.project) return
            const nextProject = { ...prev.project, params: { ...prev.project.params, ...patch } }
            setViewState({ ...prev, project: nextProject })
            const saved = await patchJson(`/projects/${prev.project.id}`, { params: nextProject.params })
            if (!saved.ok) store.set({ notice: saved.error })
            const frame = prev.still && Number.isFinite(prev.still.frame) ? prev.still.frame : 0
            await renderStill(prev.project.id, frame)
          },
          [viewState, renderStill],
        )

        const onPickTemplate = React.useCallback(
          async (template) => {
            if (viewState.mode !== 'studio') return
            await createProject(viewState.agent, template)
          },
          [viewState, createProject],
        )

        const onPreview = React.useCallback(
          async (frame, replan) => {
            if (viewState.mode !== 'studio' || !viewState.project) return
            if (replan) {
              const sb = await getJson(`/projects/${viewState.project.id}/storyboard`)
              if (sb.ok) setViewState((prev) => ({ ...prev, storyboard: sb.payload.storyboard }))
            }
            await renderStill(viewState.project.id, frame)
          },
          [viewState, renderStill],
        )

        const pollJob = React.useCallback(
          async (jobId, projectId) => {
            const res = await getJson(`/jobs/${jobId}`)
            if (!res.ok) {
              store.set({ notice: res.error })
              return
            }
            const job = res.payload.job
            setViewState((prev) => (prev.mode === 'studio' ? { ...prev, job } : prev))
            if (job.status === 'running') {
              pollRef.current = setTimeout(() => pollJob(jobId, projectId), 1500)
              return
            }
            const fresh = await getJson(`/projects/${projectId}`)
            if (fresh.ok) {
              setViewState((prev) => (prev.mode === 'studio' ? { ...prev, project: fresh.payload.project } : prev))
            }
          },
          [],
        )

        const backToWall = React.useCallback(() => {
          stopPoll()
          setViewState({ mode: 'wall' })
          setSection('agents')
        }, [stopPoll])

        const onLocale = React.useCallback(
          async (locale) => {
            const saved = await api('/panel/settings', { method: 'PUT', body: JSON.stringify({ locale }) })
            if (!saved.ok) {
              store.set({ notice: saved.error })
              return
            }
            store.set({ settings: saved.payload.settings || {}, notice: t('settingSaved') })
          },
          [],
        )

        const refreshJobs = React.useCallback(async () => {
          const res = await getJson('/jobs')
          if (res.ok) store.set({ jobs: res.payload.items || [] })
        }, [])

        // Skills come from the Host's SKILL.md scan, so they follow install and
        // uninstall — but the DSH catalog is synced Host-side, not here.
        const refreshSkills = React.useCallback(async () => {
          const res = await getJson('/skills')
          if (res.ok) store.set({ skills: res.payload.items || [] })
        }, [])

        // ---- agent lifecycle ----
        const openInstall = React.useCallback(async () => {
          setInstallOpen(true)
          setInstallPath('')
          setInstallBusy('')
          setAvailable(null)
          const res = await getJson('/agents/available')
          setAvailable(res.ok ? res.payload.items || [] : [])
        }, [])

        // `ref` is either `{ id }` for a built-in package or `{ path }` for a
        // folder the user points at; the Host decides which one it got.
        const onInstall = React.useCallback(async (ref) => {
          setInstallBusy(ref.id || 'path')
          const res = await postJson('/agents/install', ref)
          setInstallBusy('')
          if (!res.ok) {
            store.set({ notice: `${t('installFailed')} — ${res.error}` })
            return
          }
          store.set({ agents: res.payload.agents || [], notice: t('installOk') })
          await refreshSkills()
          setInstallOpen(false)
          setInstallPath('')
        }, [])

        const onUninstall = React.useCallback(async (agent) => {
          setUninstallTarget(agent)
        }, [])

        const confirmUninstall = React.useCallback(async () => {
          const agent = uninstallTarget
          if (!agent) return
          const res = await postJson(`/agents/${encodeURIComponent(agent.id)}/uninstall`, {})
          setUninstallTarget(null)
          if (!res.ok) {
            store.set({ notice: `${t('uninstallFailed')} — ${res.error}` })
            return
          }
          store.set({ agents: res.payload.agents || [], notice: t('uninstalled') })
          await refreshSkills()
        }, [uninstallTarget])

        const onConfigure = React.useCallback(async (agent) => {
          setConfigTarget(agent)
          setConfigDraft(null)
          setConfigSkills(null)
          const res = await getJson(`/agents/${encodeURIComponent(agent.id)}/config`)
          const cfg = res.ok ? res.payload.config || {} : {}
          const envRows = Object.keys(cfg.env || {}).map((key) => ({ key, value: String(cfg.env[key]) }))
          // The skill list comes from the same response, so the modal never has
          // to guess which pipeline this agent owns.
          setConfigSkills(res.ok ? res.payload.skills || [] : [])
          setConfigDraft({
            provider: cfg.provider || '',
            model: cfg.model || '',
            skill: cfg.skill || '',
            envRows: envRows.length > 0 ? envRows : [],
          })
        }, [])

        const onSaveConfig = React.useCallback(async () => {
          if (!configTarget || !configDraft) return
          setConfigBusy(true)
          const env = {}
          for (const row of configDraft.envRows) {
            const key = String(row.key || '').trim()
            if (key) env[key] = String(row.value || '')
          }
          const res = await api(`/agents/${encodeURIComponent(configTarget.id)}/config`, {
            method: 'PUT',
            body: JSON.stringify({
              provider: configDraft.provider,
              model: configDraft.model,
              skill: configDraft.skill || '',
              env,
            }),
          })
          setConfigBusy(false)
          if (!res.ok) {
            store.set({ notice: `${t('saveFailed')} — ${res.error}` })
            return
          }
          store.set({ notice: t('configSaved') })
          setConfigTarget(null)
          setConfigDraft(null)
          setConfigSkills(null)
          // The binding decides which pipeline a bare sentence runs, so the
          // cached skill list must be re-read instead of patched in place.
          await refreshSkills()
        }, [configTarget, configDraft])

        // ---- one-click director ----
        // Inserting a skill is a composer convenience: the model still decides
        // whether to load it, but `@name` in the sentence is what makes it findable.
        const onInsertSkill = React.useCallback((skill) => {
          const token = skill && skill.at ? skill.at : ''
          if (!token) return
          setDirectorPrompt((prev) => {
            const text = String(prev || '')
            if (text.indexOf(token) >= 0) return text
            return text ? `${text} ${token}` : token
          })
          setDirectorNote('')
          store.set({ notice: t('skillsInserted') })
        }, [])

        const openDirector = React.useCallback(async () => {
          setDirectorOpen(true)
          setDirectorResult(null)
          setDirectorNote('')
          if (!models) {
            const res = await getJson('/director/models')
            setModels(res.ok ? res.payload : { available: [], error: '' })
          }
        }, [models])

        const onDirector = React.useCallback(async (prompt, mode) => {
          if (!prompt) {
            setDirectorNote(t('directorNeedPrompt'))
            return
          }
          setDirectorBusy(true)
          setDirectorResult(null)
          setDirectorNote('')
          const res = await postJson('/director', { prompt, mode })
          setDirectorBusy(false)
          if (!res.ok) {
            setDirectorResult({ error: `${t('directorFailed')} — ${res.error}` })
            return
          }
          setDirectorResult(res.payload)
          setDirectorNote(prompt)
          // Land the user in the studio on the freshly directed project, with
          // the storyboard already planned by the Host.
          const project = res.payload.project
          const agent = (store.get().agents || []).find((item) => item.id === project.agentId) || { id: project.agentId, name: project.agentId }
          stopPoll()
          setViewState({ mode: 'studio', agent, templates: [], project, storyboard: res.payload.storyboard || null, still: null, stillLoading: false, job: null })
          setSection('agents')
          setDirectorOpen(false)
          const tpl = await getJson(`/templates?agentId=${encodeURIComponent(project.agentId)}`)
          const templates = tpl.ok ? tpl.payload.items || [] : []
          setViewState((prev) => (prev.project && prev.project.id === project.id ? { ...prev, templates } : prev))
          const hook = ((res.payload.storyboard && res.payload.storyboard.shots) || []).find((shot) => shot.kind === 'hook')
          if (hook) renderStill(project.id, hook.from + Math.floor(hook.durationFrames / 2))
          // "One-click video" has to hand back a video, not a still: queue the
          // render right away and let the queue view track it.
          const queued = await postJson(`/projects/${project.id}/render`, { quality: 'preview' })
          if (queued.ok) {
            setViewState((prev) => (prev.project && prev.project.id === project.id ? { ...prev, job: queued.payload.job } : prev))
            pollJob(queued.payload.jobId, project.id)
          } else {
            store.set({ notice: `${t('directorFailed')} — ${queued.error}` })
          }
        }, [stopPoll, renderStill, pollJob])

        // ---- forge ----
        // The scaffold runs Host-side with no model, so "create" cannot fail for
        // lack of quota; only the optional `refine` step talks to a model.
        const loadForge = React.useCallback(async () => {
          setForgeBusy('load')
          const [bp, list] = await Promise.all([getJson('/forge/blueprint'), getJson('/forge/drafts')])
          if (bp.ok) {
            const next = bp.payload.blueprint
            setBlueprint(next)
            setForgeForm((prev) => ({
              ...prev,
              track: prev.track || (next.tracks[0] && next.tracks[0].id) || '1.3',
              look: prev.look || (next.looks[0] ?? ''),
              palette: prev.palette || (next.palettes[0] ?? ''),
              aspect: prev.aspect || (next.aspects[0] ?? ''),
            }))
          }
          if (list.ok) setDrafts(list.payload.items || [])
          setForgeBusy('')
        }, [])

        const pickDraft = React.useCallback(async (id) => {
          const res = await getJson(`/forge/drafts/${encodeURIComponent(id)}`)
          if (!res.ok) {
            store.set({ notice: res.error })
            return
          }
          setDraft(res.payload.draft)
          setValidation(res.payload.validation)
        }, [])

        const createDraft = React.useCallback(async () => {
          const goal = String(forgeForm.goal || '').trim()
          if (!goal) return
          setForgeBusy('create')
          const res = await postJson('/forge/drafts', {
            goal,
            track: forgeForm.track,
            look: forgeForm.look,
            palette: forgeForm.palette,
            aspect: forgeForm.aspect,
            durationSec: forgeForm.durationSec,
            beatBpm: forgeForm.beatBpm,
            subtitle: forgeForm.subtitle,
          })
          setForgeBusy('')
          if (!res.ok) {
            store.set({ notice: `${t('forgeFailed')} — ${res.error}` })
            return
          }
          setDraft(res.payload.draft)
          setValidation(res.payload.validation)
          const list = await getJson('/forge/drafts')
          if (list.ok) setDrafts(list.payload.items || [])
          store.set({ notice: t('forgeCreated') })
        }, [forgeForm])

        const validateDraftNow = React.useCallback(async () => {
          if (!draft) return
          setForgeBusy('validate')
          const res = await getJson(`/forge/drafts/${encodeURIComponent(draft.id)}`)
          setForgeBusy('')
          if (!res.ok) {
            store.set({ notice: res.error })
            return
          }
          setDraft(res.payload.draft)
          setValidation(res.payload.validation)
        }, [draft])

        const refineDraft = React.useCallback(async () => {
          if (!draft) return
          setForgeBusy('refine')
          const res = await postJson(`/forge/drafts/${encodeURIComponent(draft.id)}/refine`, {})
          setForgeBusy('')
          if (!res.ok) {
            store.set({ notice: `${t('forgeFailed')} — ${res.error}` })
            return
          }
          setDraft(res.payload.draft)
          setValidation(res.payload.validation)
          // `refined: false` is a normal outcome, not a failure: the scaffold is
          // already complete, so a dead model route only costs the polish.
          store.set({ notice: res.payload.refined ? t('forgeRefined') : res.payload.reason || t('forgeRefineOffline') })
        }, [draft])

        const installDraft = React.useCallback(async () => {
          if (!draft) return
          setForgeBusy('install')
          const res = await postJson(`/forge/drafts/${encodeURIComponent(draft.id)}/install`, {})
          setForgeBusy('')
          if (!res.ok) {
            const detail = res.payload && res.payload.error && res.payload.error.detail
            const first = detail && detail.errors && detail.errors[0]
            store.set({ notice: `${t('installFailed')} — ${first || res.error}` })
            return
          }
          store.set({ agents: res.payload.agents || [], notice: t('forgeInstalled') })
          await refreshSkills()
        }, [draft])

        const deleteDraft = React.useCallback(async () => {
          if (!draft) return
          setForgeBusy('delete')
          const res = await api(`/forge/drafts/${encodeURIComponent(draft.id)}`, { method: 'DELETE' })
          setForgeBusy('')
          if (!res.ok) {
            store.set({ notice: res.error })
            return
          }
          setDraft(null)
          setValidation(null)
          const list = await getJson('/forge/drafts')
          if (list.ok) setDrafts(list.payload.items || [])
          store.set({ notice: t('forgeDeleted') })
        }, [draft])

        React.useEffect(() => {
          if (state.panel || state.loading) return undefined
          refresh()
          return undefined
        }, [])

        // The Task page is a live view of the queue, so poll it while it is on
        // screen — nothing else needs a timer.
        React.useEffect(() => {
          if (section !== 'tasks') return undefined
          const id = setInterval(() => {
            refreshJobs()
          }, 2000)
          return () => clearInterval(id)
        }, [section, refreshJobs])

        // Forge needs its option tables once, the first time the page opens.
        React.useEffect(() => {
          if (section !== 'forge') return undefined
          if (!blueprint) loadForge()
          return undefined
        }, [section, blueprint, loadForge])

        React.useEffect(() => stopPoll, [stopPoll])

        const panel = state.panel
        const renderOk = panel && panel.render && panel.render.available === true
        const mode = viewState.mode

        const crumb =
          mode === 'studio'
            ? h(
                'div',
                { className: 'abx-crumb' },
                h('button', { className: 'abx-crumb-btn', onClick: backToWall }, `← ${t('back')}`),
                h('span', { className: 'abx-crumb-sep' }, '/'),
                h('span', {}, viewState.agent.name),
                viewState.project ? h('span', { className: 'abx-crumb-sep' }, '/') : null,
                viewState.project ? h('span', { className: 'abx-crumb-cur' }, viewState.project.title) : null,
                h('span', { style: { flex: 1 } }),
                viewState.storyboard
                  ? h(
                      'span',
                      {},
                      `${t('draft')} · ${viewState.storyboard.totalFrames} ${t('shotTotal')} · ${viewState.storyboard.durationSec}${t('seconds')}`,
                    )
                  : null,
              )
            : null

        // Whatever the rail selects ends up here. A section may carry its own
        // `render` (see SECTIONS) — that is the extension point for new pages.
        const sectionDef = SECTIONS.find((item) => item.id === section) || SECTIONS[0]
        let page = null
        if (sectionDef.render) {
          page = sectionDef.render({
            store,
            t,
            panel,
            agents: state.agents,
            projects: state.projects || [],
            jobs: state.jobs || [],
            settings: state.settings || {},
            openAgent,
            openProject,
            refresh,
          })
        } else if (section === 'agents') {
          page = h(
            'div',
            { className: 'abx-body' },
            h(Wall, {
              agents: state.agents,
              projects: state.projects || [],
              panel,
              openAgentId: null,
              onOpen: openAgent,
              onOpenProject: openProject,
              onInstall: openInstall,
              onConfigure: onConfigure,
              onUninstall: onUninstall,
              onDirector: openDirector,
            }),
          )
        } else if (section === 'studio') {
          page = h(StudioHome, {
            agents: state.agents,
            projects: state.projects || [],
            onOpen: openAgent,
            onOpenProject: openProject,
          })
        } else if (section === 'tasks') {
          page = h(Tasks, { jobs: state.jobs || [], projects: state.projects || [], onRefresh: refreshJobs })
        } else if (section === 'forge') {
          page = h(Forge, {
            blueprint,
            drafts,
            draft,
            validation,
            form: forgeForm,
            busy: forgeBusy,
            onForm: (patch) => setForgeForm((prev) => ({ ...prev, ...patch })),
            onCreate: createDraft,
            onPick: pickDraft,
            onValidate: validateDraftNow,
            onRefine: refineDraft,
            onInstall: installDraft,
            onDelete: deleteDraft,
            onRefresh: loadForge,
          })
        } else if (section === 'settings') {
          page = h(Settings, { panel, settings: state.settings || {}, zh: isZh(), onRefresh: refresh, onLocale })
        }

        return h(
          React.Fragment,
          null,
          h('style', { key: 'css' }, CSS),
          h(
            'div',
            { key: 'sh', className: 'abx-shell', 'aria-label': t('title') },
            h(
              'div',
              { className: 'abx-head' },
              h('span', { className: 'abx-brand' }, BRAND),
              h('span', { className: 'abx-sub' }, t('subtitle')),
              h('span', { className: 'abx-spacer' }),
              panel
                ? h(
                    'span',
                    { className: 'abx-badge', 'data-tone': renderOk ? 'ok' : 'warn' },
                    `${t('renderEngine')} ${renderOk ? `✓ ${t('renderReady')}` : t('renderMissing')} · ${panel.node}`,
                  )
                : null,
              state.notice ? h('span', { className: 'abx-notice', title: state.notice }, state.notice) : null,
              h(Btn, { onClick: refresh, disabled: state.loading }, state.loading ? t('loading') : t('refresh')),
              props.onClose
                ? h('button', { className: 'abx-x', onClick: props.onClose, 'aria-label': t('close') }, '×')
                : null,
            ),
            crumb,
            mode === 'studio'
              ? h('div', { className: 'abx-studio' }, [
                  h(Studio, {
                    key: 'studio',
                    view: viewState,
                    zh: isZh(),
                    onParams,
                    onPickTemplate,
                    onPreview,
                    directorPrompt,
                    directorMode,
                    directorBusy,
                    directorResult,
                    directorNote,
                    directorNoModel: !!(models && models.available && models.available.length === 0),
                    onDirectorPrompt: setDirectorPrompt,
                    onDirectorMode: setDirectorMode,
                    onDirector,
                    skills: state.skills || [],
                    onInsertSkill,
                  }),
                ])
              : h(
                  'div',
                  { className: 'abx-main' },
                  h(Nav, {
                    sections: SECTIONS,
                    active: section,
                    collapsed,
                    onSelect: (id) => {
                      setSection(id)
                      if (id !== 'studio') setViewState({ mode: 'wall' })
                    },
                    onToggle: () => setCollapsed((value) => !value),
                  }),
                  h('div', { className: 'abx-content' }, page),
                ),
            installOpen
              ? h(Modals.InstallModal, {
                  available,
                  path: installPath,
                  busy: installBusy,
                  onPath: setInstallPath,
                  onInstall,
                  onClose: () => setInstallOpen(false),
                })
              : null,
            uninstallTarget
              ? h(Modals.ConfirmModal, {
                  title: `${t('uninstallTitle')} · ${uninstallTarget.name || uninstallTarget.id}`,
                  message: t('uninstallConfirm'),
                  detail: uninstallTarget.id,
                  onClose: () => setUninstallTarget(null),
                  footer: h(
                    React.Fragment,
                    null,
                    h(Btn, { onClick: () => setUninstallTarget(null) }, t('cancel')),
                    h(Btn, { primary: true, onClick: confirmUninstall }, t('uninstall')),
                  ),
                })
              : null,
            configTarget
              ? h(Modals.ConfigModal, {
                  agent: configTarget,
                  draft: configDraft,
                  skills: configSkills || [],
                  busy: configBusy,
                  onDraft: setConfigDraft,
                  onSave: onSaveConfig,
                  onClose: () => {
                    setConfigTarget(null)
                    setConfigDraft(null)
                    setConfigSkills(null)
                  },
                })
              : null,
            directorOpen
              ? h(Modals.DirectorModal, {
                  prompt: directorPrompt,
                  mode: directorMode,
                  busy: directorBusy,
                  models,
                  onPrompt: setDirectorPrompt,
                  onMode: setDirectorMode,
                  onRun: onDirector,
                  onClose: () => setDirectorOpen(false),
                })
              : null,
          ),
        )
      }
    }

    // ---------------------------------------------------------------
    // Module entry
    // ---------------------------------------------------------------
    // Panel key: the sidebar list id and the keyed `main` occupant must be the
    // same string, because clicking a sidebar entry dispatches selectPanel(<id>).
    const PANEL_KEY = 'aibench'

    const store = createStore({
      loading: false,
      panel: null,
      agents: [],
      projects: [],
      jobs: [],
      settings: {},
      skills: [],
      sectionsVersion: 0,
      notice: '',
    })

    return {
      inject: ['slots'],
      // Public extension API for other bundles (and for future AiBench pages):
      // a section is { id, labelKey, icon?, render?(ctx) }. Returns false when
      // the id is already taken, so re-registering is harmless.
      registerSection,
      listSections,
      apply(ctx) {
        const localeSvc = ctx.get('locale')
        const snap = localeSvc && typeof localeSvc.getLocale === 'function' ? localeSvc.getLocale() : null
        const langId = String((snap && (snap.id || snap.locale || snap.current)) || '').toLowerCase()
        const useZh = langId.indexOf('en') !== 0

        // The Setting page writes `locale` to settings.json, so the copy must be
        // resolved per render, not once at activation: reading the store here is
        // what makes a language switch take effect without a reload.
        const t = (key) => {
          const pref = store.get().settings && store.get().settings.locale
          const zhNow = pref ? String(pref).toLowerCase().indexOf('en') !== 0 : useZh
          const dict = zhNow ? I18N.zh : I18N.en
          return dict[key] || I18N.zh[key] || key
        }

        const Shell = makeShell(store, t, useZh)

        // A panel that blanks out teaches nobody anything: catch a render fault,
        // show the message in place, and keep the rest of the app alive.
        class PanelBoundary extends React.Component {
          constructor(props) {
            super(props)
            this.state = { error: null }
          }

          static getDerivedStateFromError(error) {
            return { error }
          }

          componentDidCatch(error, info) {
            console.error('[aibench] panel render failed:', error, info)
          }

          render() {
            if (this.state.error) {
              const message = this.state.error && this.state.error.message ? this.state.error.message : String(this.state.error)
              return h(
                'div',
                { className: 'abx-shell' },
                h(
                  'div',
                  { className: 'abx-body' },
                  h('div', { className: 'abx-empty' }, `${t('title')} · ${message}`),
                ),
              )
            }
            return this.props.children
          }
        }

        function AiBenchPanel() {
          const close = React.useCallback(() => {
            const layout = ctx.get('layout')
            if (layout && typeof layout.selectPanel === 'function') {
              try {
                layout.selectPanel(null)
              } catch (error) {
                console.error('[aibench] selectPanel(null) failed:', error)
              }
            }
          }, [])
          return h(PanelBoundary, null, h(Shell, { onClose: close }))
        }

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_KEY, order: 60, label: () => t('launcher') },
            makeIcon(),
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_KEY }, AiBenchPanel),
        )
      },
    }
  },
})
