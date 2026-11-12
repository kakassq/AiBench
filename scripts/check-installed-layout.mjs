/**
 * Prove the plugin works from a real package-manager layout.
 *
 * This is the check that catches the class of bug that makes a plugin "install
 * fine, then render nothing". Two real failures have been found by it:
 *
 *   1. Node refuses to strip types for files under node_modules
 *      (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so the planner has to ship
 *      prebuilt as dist/storyboard.mjs.
 *   2. pnpm does not hoist a package's dependencies into the project's
 *      node_modules — it puts them as *siblings* inside the virtual store dir,
 *      so `@remotion/cli` lives at `<pkg_root>/@remotion/cli`, not at
 *      `<plugin>/node_modules/@remotion/cli`. Probing only the latter reported
 *      render.available=false on a perfectly good install.
 *
 * Point it at a real install to get the full set of assertions:
 *
 *   node scripts/check-installed-layout.mjs <path-to>/node_modules/dsh-aibench
 *
 * With no argument it uses `.tmp/installtest/...`, a hand-extracted tarball that
 * has no dependencies — the Remotion assertions are then reported as skipped.
 */
import { existsSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const ROOT = resolve(HERE, '..')
const INSTALLED_ARG = process.argv[2] || join(ROOT, '.tmp', 'installtest', 'node_modules', 'dsh-aibench')

// pnpm puts the real package in `.pnpm/<id>/node_modules/<name>` and symlinks it
// from the project. Import resolves through the symlink, so every path this
// script compares against must be a real path too.
const INSTALLED = existsSync(INSTALLED_ARG) ? realpathSync(INSTALLED_ARG) : INSTALLED_ARG

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
// The engine is in-tree (`<plugin>/render`), so it must resolve *inside* the
// installed package rather than to a sibling npm package.
const render = mod.getRenderStatus()
assert('render engine resolved', render.projectDir.includes('render'), render.projectDir)
assert('render engine is in-tree', render.projectDir === join(INSTALLED, 'render'), render.projectDir)
assert('built storyboard module present', existsSync(join(render.projectDir, 'dist', 'storyboard.mjs')))

// The Remotion CLI only exists after the user runs their package manager, so a
// tarball-only scratch layout legitimately has no dependencies. Report that
// state explicitly instead of calling it a failure — but never pass it silently.
const cliPresent = existsSync(render.cli)
const anyRemotion = [
  join(INSTALLED, 'render', 'node_modules', '@remotion'),
  join(INSTALLED, 'node_modules', '@remotion'),
  join(resolve(INSTALLED, '..'), '@remotion'),
  join(resolve(INSTALLED, '..'), 'node_modules', '@remotion'),
].some((dir) => existsSync(dir))

if (anyRemotion) {
  // A dependency is installed but the resolver missed it — that is the pnpm
  // sibling layout bug, and it must fail loudly rather than be skipped.
  assert('render CLI resolvable', cliPresent, `cli=${render.cli}`)
  assert('render engine reports available', render.available === true, `available=${render.available}`)
  assert('render CLI path points at an existing file', cliPresent && existsSync(render.cli), render.cli)
} else {
  console.log('SKIP  render CLI: Remotion dependencies not installed in this layout')
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
