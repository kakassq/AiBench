// Regression gate for the one-click director's *local* fallback.
//
// The LLM route is optional and may be rate-limited at any moment, so the local
// planner is the path that always runs. It must still honour the literal words
// in the sentence: duration, aspect, rhythm, style, subtitles — and it must pick
// the topic's agent rather than whatever template happens to sit first.
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
// Must precede the Host import: it redirects DATA_DIR to a throwaway sandbox so
// this gate cannot write into the user's real project list.
import './sandbox-data.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const mod = await import(pathToFileURL(join(here, '..', 'packages', 'aibench', 'index.js')).href)

const agents = [
  { id: 'aibench-explainer', name: 'AiBench Explainer', track: '0' },
  { id: 'aibench-reel', name: 'AiBench Reel', track: '1.5' },
  { id: 'aibench-data', name: 'AiBench Data', track: '1.3' },
]

const templates = [
  { id: 'explainer.bayes', agentId: 'aibench-explainer', track: '0', title: '贝叶斯：用一个数字改写直觉', brief: '先验 + 新证据 = 后验', defaults: { type: 0, style: 0, palette: 0, durationSec: 30, beatBpm: 90, subtitle: 'zh', aspect: '16:9' } },
  { id: 'explainer.entropy', agentId: 'aibench-explainer', track: '0', title: '熵增：时间为什么只往前流', brief: '时间只朝一个方向流', defaults: { type: 0, style: 1, palette: 1, durationSec: 30, beatBpm: 90, subtitle: 'zh', aspect: '16:9' } },
  { id: 'reel.countdown', agentId: 'aibench-reel', track: '1.5', title: '卡点倒数：一秒一格', brief: '3 2 1 三个数字各占一拍，最后一拍砸出结论', defaults: { type: 1, style: 2, palette: 1, durationSec: 10, beatBpm: 128, subtitle: 'zh', aspect: '9:16' } },
  { id: 'reel.mark', agentId: 'aibench-reel', track: '1.4', title: '字标起手：三拍落版', brief: '字标在鼓点上落位', defaults: { type: 1, style: 3, palette: 2, durationSec: 10, beatBpm: 120, subtitle: 'zh', aspect: '9:16' } },
  { id: 'data.growth', agentId: 'aibench-data', track: '1.3', title: '增长曲线：那张图说了什么', brief: '一条曲线从平缓到陡峭', defaults: { type: 2, style: 0, palette: 3, durationSec: 30, beatBpm: 100, subtitle: 'zh', aspect: '16:9' } },
  { id: 'data.three-numbers', agentId: 'aibench-data', track: '1.3', title: '三个数字讲一件事', brief: '先抛一个反直觉的数，再给两个支撑数', defaults: { type: 2, style: 0, palette: 3, durationSec: 30, beatBpm: 100, subtitle: 'zh', aspect: '16:9' } },
]

const cases = [
  {
    prompt: '做个 20 秒横版的数据讲解，三个数字，节奏稳',
    expect: { agentId: 'aibench-data', templateId: 'data.three-numbers', durationSec: 20, aspect: '16:9' },
  },
  {
    prompt: '给新上线的命令行工具做个 15 秒竖版开场，卡点、终端绿',
    expect: { agentId: 'aibench-reel', durationSec: 15, aspect: '9:16', beatBpm: 128, style: 2 },
  },
  {
    prompt: '用 45 秒横版讲一下熵增，双语字幕',
    expect: { agentId: 'aibench-explainer', durationSec: 45, aspect: '16:9', subtitle: 'bilingual' },
  },
  {
    prompt: '增长曲线那种，30 秒，方版',
    expect: { agentId: 'aibench-data', durationSec: 30, aspect: '1:1' },
  },
  {
    prompt: '字标开场，10 秒，竖版，慢一点',
    expect: { agentId: 'aibench-reel', durationSec: 10, aspect: '9:16', beatBpm: 90 },
  },
]

let failed = 0
for (const item of cases) {
  const plan = mod.localDirectorPlan(item.prompt, agents, templates, 'template')
  const bad = []
  for (const [key, want] of Object.entries(item.expect)) {
    const got = key === 'agentId' || key === 'templateId' ? plan[key] : plan.params[key]
    if (got !== want) bad.push(`${key}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
  }
  if (bad.length > 0) {
    failed += 1
    console.log(`FAIL  ${item.prompt}`)
    for (const line of bad) console.log(`        ${line}`)
  } else {
    console.log(`PASS  ${item.prompt} -> ${plan.templateId}`)
  }
}

// The random mode must stay deterministic for a given sentence, otherwise the
// "random" button would be unreproducible.
const a = mod.localDirectorPlan('随便来一条', agents, templates, 'random')
const b = mod.localDirectorPlan('随便来一条', agents, templates, 'random')
if (a.templateId !== b.templateId) {
  failed += 1
  console.log(`FAIL  random mode is not deterministic: ${a.templateId} vs ${b.templateId}`)
} else {
  console.log(`PASS  random mode is deterministic -> ${a.templateId}`)
}

// A pinned template is caller intent, so it must survive a model plan that
// names something else entirely. This is the "rerun this agent's template with
// fresh words" flow: a bad pick here renders a different film than the one the
// user asked to redo, which looks like the app ignoring the click.
const modelSaysOther = {
  agentId: 'aibench-explainer',
  templateId: 'explainer.bayes',
  title: '模型想选的',
  brief: '模型想写的',
  params: { durationSec: 30, aspect: '16:9' },
}
const pinnedRun = mod.sanitizeDirectorPlan(
  modelSaysOther,
  agents,
  templates,
  'template',
  '随便一句话',
  { templateId: 'reel.countdown' },
)
if (!pinnedRun) {
  failed += 1
  console.log('FAIL  pinned template produced no plan')
} else if (pinnedRun.template.id !== 'reel.countdown' || pinnedRun.plan.templateId !== 'reel.countdown') {
  failed += 1
  console.log(`FAIL  pinned template was overridden by the model: ${pinnedRun.plan.templateId}`)
} else if (pinnedRun.agent.id !== 'aibench-reel') {
  failed += 1
  console.log(`FAIL  pinned template did not pull its owning agent: ${pinnedRun.agent.id}`)
} else {
  console.log('PASS  pinned template wins over the model plan')
}

// An unknown pin must fail loudly instead of silently rendering the fallback.
const badPin = mod.sanitizeDirectorPlan(modelSaysOther, agents, templates, 'template', '随便一句话', {
  templateId: 'does.not.exist',
})
if (badPin !== null) {
  failed += 1
  console.log(`FAIL  unknown pin did not fail: rendered ${badPin.plan.templateId}`)
} else {
  console.log('PASS  unknown pin fails instead of falling back')
}

// An agent pin only narrows the catalogue — the model still picks within it.
const agentPin = mod.sanitizeDirectorPlan(
  { ...modelSaysOther, templateId: 'data.growth' },
  agents,
  templates,
  'template',
  '随便一句话',
  { agentId: 'aibench-data' },
)
if (!agentPin || agentPin.agent.id !== 'aibench-data') {
  failed += 1
  console.log(`FAIL  agent pin ignored: ${agentPin ? agentPin.agent.id : 'null'}`)
} else {
  console.log(`PASS  agent pin keeps the choice inside the agent -> ${agentPin.plan.templateId}`)
}

// No pin means no behaviour change.
const unpinned = mod.sanitizeDirectorPlan(modelSaysOther, agents, templates, 'template', '随便一句话', {})
if (!unpinned || unpinned.plan.templateId !== 'explainer.bayes') {
  failed += 1
  console.log(`FAIL  unpinned plan changed: ${unpinned ? unpinned.plan.templateId : 'null'}`)
} else {
  console.log('PASS  no pin leaves the model choice alone')
}

if (failed > 0) {
  console.log(`\n${failed} director check(s) failed`)
  process.exit(1)
}
console.log('\ndirector checks ok')
