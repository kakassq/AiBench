// Gate for the template → render-params mapping layer.
//
// Two things can silently break here:
//  1. The Host's LOOK_IDS / PALETTE_NAMES tables drifting from the renderer's.
//     A drifted table maps a template's `style.look` to the wrong index, and the
//     film renders in a look the template never asked for — no error, no warning.
//  2. A built-in template whose rich descriptor disagrees with its own numeric
//     `defaults`, which means one of the two is a lie.
import { pathToFileURL } from 'node:url'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const host = await import(pathToFileURL(join(repo, 'packages', 'aibench', 'index.js')).href)
const render = await import(pathToFileURL(join(repo, 'packages', 'aibench-render', 'src', 'storyboard.ts')).href)

let failed = 0
function check(label, condition, detail) {
  if (condition) console.log(`PASS  ${label}`)
  else {
    failed += 1
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// 1. Host table == renderer table, in the same order (index is the wire format).
const hostLooks = host.LOOK_IDS
const renderLooks = render.LOOK_IDS
check('LOOK_IDS matches the renderer', JSON.stringify(hostLooks) === JSON.stringify(renderLooks), `host=${hostLooks} render=${renderLooks}`)

const hostPalettes = host.PALETTE_NAMES
const renderPalettes = render.PALETTES.map((p) => p.name)
check('PALETTE_NAMES matches the renderer', JSON.stringify(hostPalettes) === JSON.stringify(renderPalettes), `host=${hostPalettes} render=${renderPalettes}`)

// 2. Every built-in template maps onto a real index.
const agentsDir = join(repo, 'packages', 'aibench', 'agents')
const templates = []
for (const agent of readdirSync(agentsDir, { withFileTypes: true })) {
  if (!agent.isDirectory()) continue
  const tplDir = join(agentsDir, agent.name, 'templates')
  let names = []
  try {
    names = readdirSync(tplDir).filter((n) => n.endsWith('.template.json'))
  } catch {
    continue
  }
  for (const name of names) {
    templates.push({ agent: agent.name, file: join(tplDir, name), tpl: JSON.parse(readFileSync(join(tplDir, name), 'utf8')) })
  }
}
check('built-in templates exist', templates.length >= 9, `got ${templates.length}`)

const badLook = templates.filter(({ tpl }) => {
  const mapped = host.templateParams(tpl)
  return tpl.style && tpl.style.look && typeof mapped.style !== 'number'
})
check('every style.look maps to an index', badLook.length === 0, badLook.map((t) => t.tpl.id).join(', '))

const badPalette = templates.filter(({ tpl }) => {
  const mapped = host.templateParams(tpl)
  return tpl.style && tpl.style.palette && typeof mapped.palette !== 'number'
})
check('every style.palette maps to an index', badPalette.length === 0, badPalette.map((t) => t.tpl.id).join(', '))

// 3. Descriptor and defaults must agree where both speak.
const conflicts = []
for (const { tpl } of templates) {
  const derived = host.templateParams(tpl)
  const defaults = tpl.defaults || {}
  for (const key of ['style', 'palette', 'beatBpm', 'subtitle', 'durationSec', 'aspect']) {
    if (key in derived && key in defaults && String(derived[key]) !== String(defaults[key])) {
      conflicts.push(`${tpl.id}.${key}: descriptor=${derived[key]} defaults=${defaults[key]}`)
    }
  }
}
check('descriptor and defaults agree', conflicts.length === 0, conflicts.join(' | '))

// 4. The merged result must survive normalizeParams unchanged for those keys.
const normDrift = []
for (const { tpl } of templates) {
  const merged = host.templateDefaults(tpl)
  const norm = host.normalizeParams(merged, tpl.aspect)
  for (const key of ['style', 'palette', 'beatBpm', 'subtitle', 'aspect']) {
    if (key in merged && String(merged[key]) !== String(norm[key])) {
      normDrift.push(`${tpl.id}.${key}: merged=${merged[key]} normalized=${norm[key]}`)
    }
  }
}
check('merged params survive normalizeParams', normDrift.length === 0, normDrift.join(' | '))

// 5. defaults must beat the descriptor when they conflict (curated wins).
const synthetic = {
  style: { look: 'blueprint', palette: '终端绿', rhythm: 90, tokens: ['blueprint'] },
  audio: { subtitles: { kind: 'zh' } },
  defaults: { style: 4, beatBpm: 140 },
}
const mergedSynthetic = host.templateDefaults(synthetic)
check('defaults win over the descriptor', mergedSynthetic.style === 4 && mergedSynthetic.beatBpm === 140, JSON.stringify(mergedSynthetic))
check('descriptor fills what defaults omit', mergedSynthetic.palette === 1 && mergedSynthetic.subtitle === 'zh', JSON.stringify(mergedSynthetic))

if (failed > 0) {
  console.log(`\n${failed} template check(s) failed`)
  process.exit(1)
}
console.log(`\ntemplate checks ok (${templates.length} templates)`)
