// Render the panel for real, outside DSH.
//
// `check-sections.mjs` proves the section API; this goes further and renders the
// whole shell with actual React + react-dom/server. A page that throws while
// rendering (a bad hook order, an undefined variable, a missing i18n key used as
// a function) shows up here as an exception instead of a blank panel in the
// browser — which is how the dead-code bug in `makeWall` reached the user once.
//
// The default section is 'agents'; to reach the other pages this overrides
// `useState` so a request for the initial 'agents' yields the page under test.
// It is a test seam, not production behaviour.
//
// Run: node scripts/check-client-render.mjs
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const renderDir = join(here, '..', 'packages', 'aibench', 'render')
const require = createRequire(pathToFileURL(join(renderDir, 'package.json')).href)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

let failed = 0
function check(label, condition, detail) {
  if (condition) console.log(`PASS  ${label}`)
  else {
    failed += 1
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const source = await readFile(join(here, '..', 'packages', 'aibench', 'client.js'), 'utf8')

function loadClient(sectionOverride) {
  let captured = null
  globalThis.window = {
    __ModuleLoader__: {
      load: (definition) => {
        captured = definition
      },
    },
    open: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  globalThis.document = { querySelector: () => null, createElement: () => ({ style: {}, select() {}, remove() {} }), body: { appendChild() {}, removeChild() {} }, execCommand: () => false }
  // Node 24 exposes `navigator` as a getter-only global; define it rather than assign.
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: undefined }, configurable: true })
  globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => '' })

  // A React stand-in that delegates to the real thing, except for the one seam:
  // the initial section state.
  const patched = {
    ...React,
    useState: (initial) => {
      const value = typeof initial === 'function' ? initial() : initial
      return React.useState(sectionOverride && value === 'agents' ? sectionOverride : initial)
    },
  }

  // Each load must be a distinct module URL: the same data: URL resolves to the
  // cached instance and the loader would never run a second time. A trailing
  // comment changes the bytes without changing the code.
  const tagged = `${source}\n// variant: ${String(sectionOverride)}\n`
  return import(`data:text/javascript;base64,${Buffer.from(tagged).toString('base64')}`).then(() => {
    const mod = captured.factory((name) => {
      if (name === 'react') return patched
      throw new Error(`unexpected require(${name})`)
    })
    return mod
  })
}

function renderPanel(mod) {
  let panel = null
  const slots = {
    inject(_name, fn) {
      fn()
    },
    register(_meta, component) {
      panel = component
      return () => undefined
    },
  }
  const ctx = {
    slots,
    get(name) {
      if (name === 'locale') return { getLocale: () => ({ id: 'zh' }) }
      return null
    },
    effect(fn) {
      const disposer = typeof fn === 'function' ? fn() : undefined
      return typeof disposer === 'function' ? disposer : () => undefined
    },
  }
  mod.apply(ctx)
  if (!panel) throw new Error('the client registered no main panel')
  return renderToStaticMarkup(React.createElement(panel))
}

// ---- agents (the default page) ----
const agentsHtml = renderPanel(await loadClient(null))
check('agents page renders', agentsHtml.length > 500, `${agentsHtml.length} chars`)
// The class name appears once per button plus once per its `data-on` style rule,
// so count the rendered buttons by their label instead.
const NAV_LABELS = ['Agent 智能体', 'Studio 工作室', '造 Agent', 'Task 任务', 'Setting 设置']
check(
  'the navigation rail renders all five labels',
  NAV_LABELS.every((label) => agentsHtml.includes(label)),
  NAV_LABELS.filter((label) => !agentsHtml.includes(label)).join(',') || 'ok',
)
check('the forge entry is in the rail', agentsHtml.includes('造 Agent'), 'missing 造 Agent')
check('the agent wall renders cards', agentsHtml.includes('abx-agentcard'), 'missing abx-agentcard')
check('the install action is present', agentsHtml.includes('安装智能体'), 'missing 安装智能体')
check('the one-click video action is present', agentsHtml.includes('一键成片'), 'missing 一键成片')

// ---- forge ----
const forgeHtml = renderPanel(await loadClient('forge'))
check('forge page renders', forgeHtml.length > 500, `${forgeHtml.length} chars`)
check('forge asks for a goal', forgeHtml.includes('abx-textarea'), 'missing the goal textarea')
// The pickers are fed by `/forge/blueprint`, which this offline render never
// fetches, so the option buttons are legitimately absent — but the fields that
// host them must still render, which is what a first paint looks like.
check('forge shows the track field', forgeHtml.includes('赛道'), 'missing the track field')
check('forge shows the look and palette fields', forgeHtml.includes('风格 look') && forgeHtml.includes('配色'), 'missing look/palette')
check('forge shows the duration and bpm fields', forgeHtml.includes('时长') && forgeHtml.includes('BPM'), 'missing duration/bpm')
check('forge has the create action', forgeHtml.includes('生成草稿'), 'missing 生成草稿')
check('forge has a drafts column', forgeHtml.includes('abx-forge-side'), 'missing abx-forge-side')
check('forge shows its empty state', forgeHtml.includes('abx-empty') || forgeHtml.includes('还没有草稿'), 'missing empty state')

// ---- tasks ----
const tasksHtml = renderPanel(await loadClient('tasks'))
check('tasks page renders', tasksHtml.length > 300, `${tasksHtml.length} chars`)
check('tasks shows its empty state', tasksHtml.includes('abx-empty') || tasksHtml.includes('没有'), 'missing empty state')

// ---- settings ----
const settingsHtml = renderPanel(await loadClient('settings'))
check('settings page renders', settingsHtml.length > 300, `${settingsHtml.length} chars`)
check('settings lists the data directory', settingsHtml.includes('abx-kv'), 'missing the key/value block')
check('settings offers the language switch', settingsHtml.includes('abx-seg-btn'), 'missing the language switch')

if (failed > 0) {
  console.log(`\n${failed} client render check(s) failed`)
  process.exit(1)
}
console.log('\nclient render checks ok (agents, forge, tasks, settings)')
