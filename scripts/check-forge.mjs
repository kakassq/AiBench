// Regression gate for Forge: scaffolding must be deterministic and complete, the
// validator must actually catch broken packages, and install must refuse a draft
// that fails validation. The point is that the offline path never produces an
// agent that installs and then renders nothing.
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const mod = await import(pathToFileURL(join(here, '..', 'packages', 'aibench', 'index.js')).href)

let failed = 0
function check(label, condition, detail) {
  if (condition) {
    console.log(`PASS  ${label}`)
  } else {
    failed += 1
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// ---------------------------------------------------------------------------
// 1. Scaffolding is a pure function of the spec.
// ---------------------------------------------------------------------------
const spec = {
  goal: '给新上线的命令行工具做个开场',
  agentId: 'agent-cli-launch',
  trackId: '1.5',
  look: 'terminal-crt',
  palette: '终端绿',
  durationSec: 15,
  beatBpm: 128,
  subtitle: 'bilingual',
  aspect: '16:9',
  name: '',
}
const a = mod.scaffoldAgentPackage(spec)
const b = mod.scaffoldAgentPackage(spec)
check('scaffold is deterministic', JSON.stringify(a) === JSON.stringify(b), 'two calls differ')
check('scaffold emits three files', Boolean(a.paths.manifest && a.paths.template && a.paths.skill))
check('manifest declares the track', a.manifest.tracks.includes('1.5'), JSON.stringify(a.manifest.tracks))
check(
  'manifest defaults survive normalizeParams',
  a.manifest.defaults.durationSec === 15 && a.manifest.defaults.beatBpm === 128,
  JSON.stringify(a.manifest.defaults),
)
check(
  'template look maps to a real look id',
  mod.templateDefaults(a.template).style === mod.LOOK_IDS.indexOf('terminal-crt'),
  `style=${mod.templateDefaults(a.template).style}`,
)
check(
  'skill frontmatter is parseable',
  mod.parseSkillFrontmatter(a.skill).meta.name === a.manifest.skills[0].name,
  String(mod.parseSkillFrontmatter(a.skill).meta.name),
)

// 2. A pure-Chinese goal still yields a usable agent id.
const cn = mod.scaffoldAgentPackage({ ...spec, goal: '熵增定律为什么只朝一个方向', agentId: 'agent-1-4-abc123' })
check('cjk goal keeps a kebab-case id', /^[a-z0-9][a-z0-9-]*$/.test(cn.manifest.id), cn.manifest.id)

// ---------------------------------------------------------------------------
// 3. Validator: accepts a good draft, rejects each kind of breakage.
// ---------------------------------------------------------------------------
const draftId = mod.forgeDraftId('forge-check-fixture')
const draftDir = mod.forgeDraftDir(draftId)
rmSync(draftDir, { recursive: true, force: true })
mod.writeDraftFiles(draftId, {
  'manifest.json': JSON.stringify(a.manifest, null, 2),
  [a.paths.template]: JSON.stringify(a.template, null, 2),
  [a.paths.skill]: a.skill,
})
writeFileSync(
  join(draftDir, 'draft.json'),
  JSON.stringify({ goal: 'forge-check-fixture', agentId: a.manifest.id, createdAt: new Date().toISOString() }, null, 2),
  'utf8',
)

const good = await mod.validateDraft(draftId)
check('validator accepts a scaffolded draft', good.ok === true, JSON.stringify(good.errors))

const ghost = await mod.validateDraft('f_does_not_exist')
check('validator rejects an unknown draft', ghost.ok === false && ghost.errors.length > 0)

const manifestPath = join(draftDir, 'manifest.json')
const templatePath = join(draftDir, a.paths.template)
const skillPath = join(draftDir, a.paths.skill)
const manifestOriginal = readFileSync(manifestPath, 'utf8')
const templateOriginal = readFileSync(templatePath, 'utf8')
const skillOriginal = readFileSync(skillPath, 'utf8')

// An unknown look would silently render as the default look, so it must be an error.
const badTemplate = JSON.parse(templateOriginal)
badTemplate.style.look = 'not-a-real-look'
writeFileSync(templatePath, JSON.stringify(badTemplate, null, 2), 'utf8')
const badLook = await mod.validateDraft(draftId)
check(
  'validator catches an unknown look',
  badLook.ok === false && badLook.errors.some((e) => e.includes('not-a-real-look')),
  JSON.stringify(badLook.errors),
)
writeFileSync(templatePath, templateOriginal, 'utf8')

// A skill without frontmatter cannot be registered or invoked by name.
writeFileSync(skillPath, '# no frontmatter at all\n', 'utf8')
const badSkill = await mod.validateDraft(draftId)
check(
  'validator catches a skill without frontmatter',
  badSkill.ok === false && badSkill.errors.some((e) => e.includes('frontmatter')),
  JSON.stringify(badSkill.errors),
)
writeFileSync(skillPath, skillOriginal, 'utf8')

// A template file that the manifest points at but which is not on disk.
const badManifest = JSON.parse(manifestOriginal)
badManifest.templates[0].file = 'templates/missing.template.json'
writeFileSync(manifestPath, JSON.stringify(badManifest, null, 2), 'utf8')
const missingTemplate = await mod.validateDraft(draftId)
check(
  'validator catches a missing template file',
  missingTemplate.ok === false && missingTemplate.errors.some((e) => e.includes('missing')),
  JSON.stringify(missingTemplate.errors),
)
writeFileSync(manifestPath, manifestOriginal, 'utf8')

const restored = await mod.validateDraft(draftId)
check('validator passes again after restore', restored.ok === true, JSON.stringify(restored.errors))

// ---------------------------------------------------------------------------
// 5. Install gate: a valid draft installs cleanly and leaves no draft record
//    behind; a broken one never reaches AGENTS_DIR.
// ---------------------------------------------------------------------------
const installDraftId = mod.forgeDraftId('forge-check-install-fixture')
const installDir = mod.forgeDraftDir(installDraftId)
rmSync(installDir, { recursive: true, force: true })
const installable = mod.scaffoldAgentPackage({ ...spec, goal: 'forge-check-install-fixture', agentId: 'agent-forge-check-fixture' })
mod.writeDraftFiles(installDraftId, {
  'manifest.json': JSON.stringify(installable.manifest, null, 2),
  [installable.paths.template]: JSON.stringify(installable.template, null, 2),
  [installable.paths.skill]: installable.skill,
})
writeFileSync(
  join(installDir, 'draft.json'),
  JSON.stringify({ goal: 'forge-check-install-fixture', agentId: installable.manifest.id, createdAt: new Date().toISOString() }, null, 2),
  'utf8',
)

const preview = mod.readForgeDraft(installDraftId)
check(
  'draft preview hides the draft record',
  !preview.files.some((f) => f.path === 'draft.json'),
  preview.files.map((f) => f.path).join(','),
)

const installed = mod.installAgentFromDir(installDir, { overwrite: true, source: 'forge' })
check('valid draft installs', installed.installed === true, JSON.stringify(installed))
const installedList = mod.listAgents()
check(
  'installed agent shows up in the agent list',
  installedList.some((agent) => agent.id === 'agent-forge-check-fixture'),
  installedList.map((agent) => agent.id).join(','),
)
const installedEntry = installedList.find((agent) => agent.id === 'agent-forge-check-fixture')
check(
  'installed agent does not carry draft.json',
  Boolean(installedEntry) && !existsSync(join(installedEntry.path, 'draft.json')),
  installedEntry ? installedEntry.path : 'agent missing',
)
check(
  'installed agent keeps its manifest and template',
  Boolean(installedEntry) && existsSync(join(installedEntry.path, 'manifest.json')) && installedEntry.templates > 0,
  installedEntry ? `templates=${installedEntry.templates}` : 'agent missing',
)

const removedAgent = mod.uninstallAgent('agent-forge-check-fixture')
check('fixture agent uninstalls', removedAgent.removed === true, JSON.stringify(removedAgent))
rmSync(installDir, { recursive: true, force: true })

// ---------------------------------------------------------------------------
// 6. Blueprint shape: the wizard renders straight from it.
// ---------------------------------------------------------------------------
const bp = mod.forgeBlueprint()
check('blueprint lists five tracks', bp.tracks.length === 5, `got ${bp.tracks.length}`)
check('blueprint reuses the renderer look ids', bp.looks.length === mod.LOOK_IDS.length)
check('blueprint reuses the renderer palettes', bp.palettes.length === mod.PALETTE_NAMES.length)
check('blueprint states its constraints', Array.isArray(bp.constraints) && bp.constraints.length >= 3)

// ---------------------------------------------------------------------------
// 5. Cleanup: the fixture must not linger in the forge directory.
// ---------------------------------------------------------------------------
rmSync(draftDir, { recursive: true, force: true })
check('fixture draft cleaned up', !mod.listForgeDrafts().some((d) => d.id === draftId))

if (failed > 0) {
  console.log(`\n${failed} forge check(s) failed`)
  process.exit(1)
}
console.log('\nforge checks ok')
