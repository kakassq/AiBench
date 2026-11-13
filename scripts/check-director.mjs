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

if (failed > 0) {
  console.log(`\n${failed} director check(s) failed`)
  process.exit(1)
}
console.log('\ndirector checks ok')
