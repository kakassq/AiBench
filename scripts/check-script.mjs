#!/usr/bin/env node
/**
 * Script-layer regression.
 *
 * The archetype planner guarantees a video always renders. It does not
 * guarantee the video says anything about the user's topic — every explainer
 * says "一件事，拆成三步讲". The script layer is what makes a render
 * publishable, so the invariants worth guarding are the ones that would let a
 * bad script through silently:
 *
 *   · a scripted timeline obeys the same three invariants as a planned one
 *     (no overlap, no gap, sum === totalFrames)
 *   · a shot never becomes shorter than the minimum it can animate in
 *   · captions exist whenever the subtitle mode asks for them
 *   · validation rejects what would render as a blank or broken frame
 *   · the fallback script is deterministic and derived from the user's words
 */

import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const load = (rel) => import(pathToFileURL(join(root, rel)).href)

const storyboard = await load('packages/aibench/render/dist/storyboard.mjs')
const host = await load('packages/aibench/index.js')

const problems = []
const check = (label, ok, detail) => {
  if (ok) {
    console.log(`PASS  ${label}`)
  } else {
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    problems.push(label)
  }
}

/* ------------------------------------------------------------------ *
 * A realistic authored script
 * ------------------------------------------------------------------ */

const SCRIPT = {
  title: '故宫的秩序',
  shots: [
    { kind: 'hook', copy: '一条中轴线，撑起六百年', caption: '紫禁城的第一句话，写在地面上。', weight: 3 },
    {
      kind: 'process',
      copy: '三进院落，层层收拢',
      weight: 5,
      steps: [
        { zh: '前朝', en: 'Outer court' },
        { zh: '过渡', en: 'Threshold' },
        { zh: '后寝', en: 'Inner court' },
      ],
    },
    {
      kind: 'process',
      copy: '黄瓦之下，等级写在颜色里',
      weight: 4,
      steps: [
        { zh: '黄瓦', en: 'Yellow tile' },
        { zh: '红墙', en: 'Red wall' },
        { zh: '青绿', en: 'Green beam' },
      ],
    },
    { kind: 'cta', copy: '六百年后，它向所有人打开', weight: 2 },
  ],
}

const params = { durationSec: 30, beatBpm: 110, subtitle: 'bilingual', style: 1, palette: 0 }
const sb = storyboard.planScriptedStoryboard('故宫', params, SCRIPT)

/* --- timeline invariants ------------------------------------------- */

check('the script decides the length, not the archetype', sb.totalFrames === 900, `${sb.totalFrames}`)
check('the script title wins', sb.title === '故宫的秩序', sb.title)
check('every authored shot made it into the timeline', sb.shots.length === SCRIPT.shots.length, `${sb.shots.length}`)
check(
  'the first shot starts at zero',
  sb.shots[0].from === 0,
  `${sb.shots[0].from}`,
)

const sum = sb.shots.reduce((acc, shot) => acc + shot.durationFrames, 0)
check('the shots sum to the composition length', sum === sb.totalFrames, `${sum} vs ${sb.totalFrames}`)

let contiguous = true
for (let i = 1; i < sb.shots.length; i++) {
  if (sb.shots[i].from !== sb.shots[i - 1].from + sb.shots[i - 1].durationFrames) contiguous = false
}
check('no gap and no overlap between shots', contiguous)

const last = sb.shots[sb.shots.length - 1]
check('the last shot ends exactly at the composition end', last.from + last.durationFrames === sb.totalFrames)

const shortest = Math.min(...sb.shots.map((shot) => shot.durationFrames))
check(
  'no shot is shorter than the animation minimum',
  shortest >= storyboard.MIN_SCRIPT_SHOT_FRAMES,
  `shortest ${shortest} < ${storyboard.MIN_SCRIPT_SHOT_FRAMES}`,
)

/* --- copy survives verbatim --------------------------------------- */

check('the hook copy is the authored copy', sb.shots[0].copy === SCRIPT.shots[0].copy, sb.shots[0].copy)
check(
  'an authored caption overrides the copy',
  sb.shots[0].caption === SCRIPT.shots[0].caption,
  sb.shots[0].caption,
)
check(
  'a shot without a caption falls back to its copy',
  sb.shots[1].caption === SCRIPT.shots[1].copy,
  sb.shots[1].caption,
)
check('process steps survive', (sb.shots[1].steps || []).length === 3, `${(sb.shots[1].steps || []).length}`)
check(
  'process steps are ordered and inside the shot',
  (sb.shots[1].steps || []).every((step) => step.at >= 0 && step.at < sb.shots[1].durationFrames),
)

/* --- weights decide the share ------------------------------------- */

const byWeight = sb.shots.map((shot) => shot.durationFrames)
check(
  'a heavier shot holds longer than a lighter one',
  byWeight[1] > byWeight[0] && byWeight[1] > byWeight[3],
  byWeight.join(','),
)

/* --- subtitle mode none drops captions ---------------------------- */

const silent = storyboard.planScriptedStoryboard('故宫', { ...params, subtitle: 'none' }, SCRIPT)
check(
  'subtitle none leaves every caption empty',
  silent.shots.every((shot) => !shot.caption),
  JSON.stringify(silent.shots.map((shot) => shot.caption)),
)

/* --- a script too long for the timeline is truncated, not squeezed -- */

const crowded = {
  title: 'too many',
  shots: Array.from({ length: 20 }, (_, i) => ({
    kind: i === 0 ? 'hook' : i === 19 ? 'cta' : 'process',
    copy: `镜头 ${i + 1}`,
    steps: [
      { zh: '甲', en: 'a' },
      { zh: '乙', en: 'b' },
    ],
  })),
}
const squeezed = storyboard.planScriptedStoryboard('x', { durationSec: 10, beatBpm: 120 }, crowded)
const squeezedShortest = Math.min(...squeezed.shots.map((shot) => shot.durationFrames))
check(
  'an oversized script is truncated rather than rendered in 2-frame flashes',
  squeezedShortest >= storyboard.MIN_SCRIPT_SHOT_FRAMES,
  `shortest ${squeezedShortest}`,
)
check(
  'the truncated timeline still sums to the composition length',
  squeezed.shots.reduce((acc, shot) => acc + shot.durationFrames, 0) === squeezed.totalFrames,
)

/* --- no script means the archetype plan, unchanged ----------------- */

const planned = storyboard.planStoryboard('故宫', params)
const empty = storyboard.planScriptedStoryboard('故宫', params, { shots: [] })
check('an empty script falls back to the archetype plan', empty.totalFrames === planned.totalFrames && empty.shots.length === planned.shots.length)

/* --- host-side validation ----------------------------------------- */

const good = host.sanitizeScript(SCRIPT, '故宫')
check('a well-formed script survives validation', !!good.script && good.script.shots.length === 4, JSON.stringify(good.rejected))
check('validation keeps the authored title', good.script.title === '故宫的秩序')

const noHook = host.sanitizeScript({ shots: [{ kind: 'process', copy: '只有过程', steps: [{ zh: '甲' }, { zh: '乙' }] }, { kind: 'cta', copy: '结束' }] }, '故宫中轴线')
check('a script without a hook gets one', !!noHook.script && noHook.script.shots[0].kind === 'hook', JSON.stringify(noHook.rejected))
check(
  'the injected hook uses the user\'s brief rather than a placeholder',
  noHook.script.shots[0].copy.includes('故宫'),
  noHook.script.shots[0].copy,
)

const noCta = host.sanitizeScript({ shots: [{ kind: 'hook', copy: '开场' }, { kind: 'process', copy: '过程', steps: [{ zh: '甲' }, { zh: '乙' }] }] }, 'x')
check('a script without a cta gets one', noCta.script.shots[noCta.script.shots.length - 1].kind === 'cta', JSON.stringify(noCta.rejected))

check('an empty reply is rejected outright', host.sanitizeScript({}, 'x').script === null)
check('a reply with no shots is rejected outright', host.sanitizeScript({ shots: [] }, 'x').script === null)

const badKind = host.sanitizeScript({ shots: [{ kind: 'nope', copy: '无效' }, { kind: 'hook', copy: '开场' }, { kind: 'cta', copy: '结束' }] }, 'x')
check('an unknown shot kind is dropped', badKind.script.shots.length === 2, `${badKind.script.shots.length}`)
check('the drop is reported', badKind.rejected.includes('kind'))

const emptyCopy = host.sanitizeScript({ shots: [{ kind: 'hook', copy: '   ' }, { kind: 'cta', copy: '结束' }] }, 'x')
check('an empty headline is dropped and a hook is injected', emptyCopy.script.shots[0].kind === 'hook' && !!emptyCopy.script.shots[0].copy)

const oneStep = host.sanitizeScript(
  { shots: [{ kind: 'hook', copy: '开场' }, { kind: 'process', copy: '过程', steps: [{ zh: '只有一个' }] }, { kind: 'cta', copy: '结束' }] },
  'x',
)
check('a process shot with fewer than two steps is dropped', oneStep.script.shots.length === 2, `${oneStep.script.shots.length}`)
check('the drop is reported as steps', oneStep.rejected.includes('steps'))

const longCopy = host.sanitizeScript(
  { shots: [{ kind: 'hook', copy: '一'.repeat(120) }, { kind: 'cta', copy: '结束' }] },
  'x',
)
check('an over-long headline is truncated', longCopy.script.shots[0].copy.length <= 34, `${longCopy.script.shots[0].copy.length}`)

const quoted = host.sanitizeScript({ shots: [{ kind: 'hook', copy: '“引号里的标题”' }, { kind: 'cta', copy: '结束' }] }, 'x')
check('surrounding quotes are stripped', quoted.script.shots[0].copy === '引号里的标题', quoted.script.shots[0].copy)

/* --- the deterministic fallback ----------------------------------- */

const local = host.localScript('故宫：六百年的宫殿', '故宫：六百年的宫殿')
check('the fallback script has a hook, a process and a cta', local.shots.map((s) => s.kind).join(',') === 'hook,process,cta')
check('the fallback hook is the user\'s own words', local.shots[0].copy.includes('故宫'), local.shots[0].copy)
check('the fallback is deterministic', JSON.stringify(host.localScript('故宫', '故宫')) === JSON.stringify(host.localScript('故宫', '故宫')))

const localLayout = storyboard.planScriptedStoryboard('故宫', params, local)
check(
  'the fallback script also lays out cleanly',
  localLayout.shots.reduce((acc, shot) => acc + shot.durationFrames, 0) === localLayout.totalFrames,
)

/* --- report ------------------------------------------------------- */

if (problems.length > 0) {
  console.error(`\n${problems.length} script check(s) failed`)
  process.exit(1)
}
console.log('\nscript checks ok')
