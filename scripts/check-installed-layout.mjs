/**
 * Prove the plugin works from a real npm-install layout.
 *
 * This is the check that catches the class of bug that makes a plugin "install
 * fine, then render nothing": the source checkout and the installed layout are
 * different filesystems (symlink vs node_modules), and several things that work
 * in the checkout break under node_modules — type stripping being the big one.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const ROOT = resolve(HERE, '..')
const INSTALLED = process.argv[2] || join(ROOT, '.tmp', 'installtest', 'node_modules', 'dsh-aibench')

const problems = []
const checked = []
const assert = (name, condition, detail) => {
  if (condition) checked.push(name)
  else problems.push(detail ? `${name}: ${detail}` : name)
}

assert('installed plugin dir exists', existsSync(INSTALLED), INSTALLED)
const mod = await import(pathToFileURL(join(INSTALLED, 'index.js')).href)

assert('exports apply()', typeof mod.apply === 'function')
assert('exports BRAND', mod.BRAND === 'AiBench', `got ${mod.BRAND}`)
assert('exports BASE_PATH', mod.BASE_PATH === '/aibench-api', `got ${mod.BASE_PATH}`)

// The render engine must be resolvable from the installed location, and the
// prebuilt planner must import successfully there — this is the exact call that
// throws ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING if the build is missing.
const render = mod.getRenderStatus()
assert('render engine resolved', render.projectDir.includes('aibench-render'), render.projectDir)
assert('render engine dir is under node_modules', /node_modules[\\/]aibench-render$/.test(render.projectDir), render.projectDir)
assert('built storyboard module present', existsSync(join(render.projectDir, 'dist', 'storyboard.mjs')))

// The Remotion CLI only exists after the user runs their package manager, so a
// tarball-only scratch layout legitimately has no dependencies. Report that
// state explicitly instead of calling it a failure — but never pass it silently.
const depsInstalled = existsSync(join(render.projectDir, 'node_modules'))
if (depsInstalled) {
  assert('render CLI resolvable', existsSync(render.cli), render.cli)
  assert('render engine reports available', render.available === true, `available=${render.available}`)
} else {
  console.log('SKIP  render CLI: aibench-render dependencies not installed in this layout')
}

const storyboard = await mod.planStoryboardForTest('安装后测试', { durationSec: 10, beatBpm: 120, subtitle: 'bilingual' })
assert('planner runs from installed layout', storyboard.totalFrames === 300, `got ${storyboard.totalFrames}`)
assert('planner produced captions', Boolean(storyboard.shots[0].caption), 'caption missing')

if (problems.length > 0) {
  for (const problem of problems) console.error(`FAIL  ${problem}`)
  process.exit(1)
}
for (const name of checked) console.log(`PASS  ${name}`)
console.log(`\ninstalled-layout checks ok (${checked.length} assertions)`)
