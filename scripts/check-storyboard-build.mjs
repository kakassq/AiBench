/**
 * Guard: `dist/storyboard.mjs` must stay byte-equivalent in behaviour to
 * `src/storyboard.ts`.
 *
 * The Host imports the compiled artifact when the plugin is installed from npm
 * (Node refuses to strip types under `node_modules`). If someone edits the
 * source and forgets to rebuild, the panel and the renderer would quietly
 * disagree about shot boundaries — the exact class of silent divergence this
 * project exists to avoid.
 *
 * So: rebuild in memory, compare against what is on disk, then run both through
 * the same storyboard inputs and assert identical output.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { compileStoryboard, OUTPUT } from '../packages/aibench-render/scripts/build-storyboard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SOURCE_TS = join(ROOT, 'packages', 'aibench-render', 'src', 'storyboard.ts')

const problems = []
const checked = []

function assert(name, condition, detail) {
  if (condition) checked.push(name)
  else problems.push(detail ? `${name}: ${detail}` : name)
}

// 1. The on-disk artifact matches a fresh compile of the source.
const fresh = compileStoryboard()
const onDisk = readFileSync(OUTPUT, 'utf8')
assert(
  'dist/storyboard.mjs is up to date',
  fresh === onDisk,
  'source changed without rebuilding — run `node packages/aibench-render/scripts/build-storyboard.mjs`',
)

// 2. Both modules expose the same surface.
const built = await import(pathToFileURL(OUTPUT).href)
const source = await import(pathToFileURL(SOURCE_TS).href)

const builtExports = Object.keys(built).sort()
const sourceExports = Object.keys(source).sort()
assert(
  'compiled module exports match source',
  builtExports.join(',') === sourceExports.join(','),
  `built=[${builtExports.join(',')}] source=[${sourceExports.join(',')}]`,
)

// 3. Same inputs → identical storyboards, across the whole parameter space the
//    panel can produce. Any drift here means shipped videos differ from preview.
const CASES = []
for (const brief of ['我的下一个 vibecoding 作品', '熵增定律为什么时间只朝一个方向', '']) {
  for (const durationSec of [10, 20, 45]) {
    for (const beatBpm of [90, 120, 140]) {
      for (const subtitle of ['none', 'zh', 'en', 'bilingual']) {
        CASES.push({ brief, params: { durationSec, beatBpm, subtitle } })
      }
    }
  }
}

let compared = 0
let drift = null
for (const testCase of CASES) {
  const a = source.planStoryboard(testCase.brief, testCase.params)
  const b = built.planStoryboard(testCase.brief, testCase.params)
  compared += 1
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    drift = `brief="${testCase.brief}" params=${JSON.stringify(testCase.params)}`
    break
  }
}
assert(
  `compiled planner produces identical storyboards (${compared} cases)`,
  drift === null,
  drift ? `storyboard drift for ${drift}` : '',
)

// 4. The constants the Host mirrors must agree with the compiled module too.
assert('FPS is 30', built.FPS === 30, `got ${built.FPS}`)
assert('LOOK_IDS has 5 entries', Array.isArray(built.LOOK_IDS) && built.LOOK_IDS.length === 5)
assert('PALETTES has 4 entries', Array.isArray(built.PALETTES) && built.PALETTES.length === 4)

if (problems.length > 0) {
  for (const problem of problems) console.error(`FAIL  ${problem}`)
  process.exit(1)
}

for (const name of checked) console.log(`PASS  ${name}`)
console.log(`\nstoryboard build checks ok (${checked.length} assertions, ${compared} storyboards compared)`)
