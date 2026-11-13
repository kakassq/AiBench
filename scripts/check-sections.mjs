/**
 * Smoke test for the client bundle's extension point.
 *
 * The panel is an ESM module that registers itself through the DSH client
 * module loader, so there is no importable entry: this script fakes that
 * loader, loads client.js, and asserts the public section API behaves.
 *
 * Run: node scripts/check-sections.mjs
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'packages', 'aibench', 'client.js')

// Minimal React stand-in: the module only needs createElement/Component to
// define its components, and none of that runs until a panel is rendered.
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Component: class Component {
    constructor(props) {
      this.props = props
    }
  },
  Fragment: Symbol('Fragment'),
  useCallback: (fn) => fn,
  useEffect: () => undefined,
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => undefined],
}

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
globalThis.document = { querySelector: () => null }
globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => '' })

const source = await readFile(clientPath, 'utf8')
// The bundle is plain ESM without imports of its own except the loader global.
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

const failures = []
const check = (name, condition, detail) => {
  if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

check('module registered with the loader', captured !== null, 'load() was never called')
if (!captured) {
  console.log(failures.join('\n'))
  process.exit(1)
}

check('loader id equals the package name', captured.id === 'dsh-aibench', `got ${captured.id}`)

const mod = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require(${name})`)
})

check('exports registerSection', typeof mod.registerSection === 'function')
check('exports listSections', typeof mod.listSections === 'function')
check('exports apply', typeof mod.apply === 'function')

const builtin = mod.listSections()
check('ships the five built-in sections', builtin.length === 5, `got ${builtin.length}`)
check(
  'built-in ids are agents/studio/forge/tasks/settings',
  builtin.map((item) => item.id).join(',') === 'agents,studio,forge,tasks,settings',
  builtin.map((item) => item.id).join(','),
)

check('rejects a duplicate id', mod.registerSection({ id: 'agents' }) === false)
check('rejects an empty section', mod.registerSection({}) === false)
check('rejects a missing argument', mod.registerSection() === false)
check('accepts a new section', mod.registerSection({ id: 'store', labelKey: 'navStore' }) === true)
check('new section is listed', mod.listSections().length === 6, `got ${mod.listSections().length}`)
check('registering the same id twice is a no-op', mod.registerSection({ id: 'store' }) === false)

// listSections must hand out a copy, otherwise a caller could edit the rail.
const copy = mod.listSections()
copy.push({ id: 'hacked' })
check('listSections returns a copy', mod.listSections().length === 6, `got ${mod.listSections().length}`)

if (failures.length > 0) {
  console.log(`${failures.length} check(s) failed:`)
  for (const line of failures) console.log(`  - ${line}`)
  process.exit(1)
}

console.log(`section API ok: ${builtin.length} built-in, ${mod.listSections().length} after extension`)
