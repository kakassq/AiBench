/**
 * Compile `src/storyboard.ts` into a plain ES module the Host can `import()`.
 *
 * Why this exists: the Host bridges to the storyboard planner at runtime so the
 * panel's shot table can never disagree with the frames Remotion produces. In a
 * source checkout that means importing the `.ts` file directly and letting Node
 * strip the types. That works right up until the plugin is installed from npm,
 * where the file lives under `node_modules` and Node refuses:
 *
 *   ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
 *
 * So the published package ships this compiled artifact instead. The source of
 * truth is still `src/storyboard.ts`; this file is generated and verified equal
 * to it by `scripts/check-storyboard-build.mjs`.
 *
 * `storyboard.ts` deliberately has zero imports, which is what makes a
 * single-file transpile sufficient — no bundler, no path rewriting.
 */
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RENDER_DIR = resolve(HERE, '..')
const SOURCE = join(RENDER_DIR, 'src', 'storyboard.ts')
export const OUTPUT = join(RENDER_DIR, 'dist', 'storyboard.mjs')

const require = createRequire(pathToFileURL(join(RENDER_DIR, 'package.json')))
const ts = require('typescript')

export function compileStoryboard() {
  const source = readFileSync(SOURCE, 'utf8')
  const out = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      verbatimModuleSyntax: false,
      removeComments: false,
    },
    fileName: SOURCE,
  })
  return out.outputText
}

export function writeStoryboardModule() {
  const code = compileStoryboard()
  mkdirSync(dirname(OUTPUT), { recursive: true })
  writeFileSync(OUTPUT, code, 'utf8')
  return OUTPUT
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const path = writeStoryboardModule()
  const bytes = readFileSync(path).length
  console.log(`storyboard module built: ${path} (${bytes} bytes)`)
}
