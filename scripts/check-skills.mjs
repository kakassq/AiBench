// Regression gate for the SkillBridge: every installed agent's SKILL.md must be
// discoverable by the Host, with a kebab-case model-facing name taken from the
// frontmatter (not from the directory name), and the ids must stay namespaced so
// they cannot shadow bundled DSH skills.
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
// Must precede the Host import: it redirects DATA_DIR to a throwaway sandbox so
// the install/uninstall assertions cannot touch the user's real agent directory.
import './sandbox-data.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const mod = await import(pathToFileURL(join(here, '..', 'packages', 'aibench', 'index.js')).href)

// `listAgents()` / `listSkills()` read the installed index, which `apply()`
// normally populates by seeding. This gate runs without DSH, and its data dir is
// a fresh sandbox, so seed explicitly — otherwise every agent-derived assertion
// below would pass or fail against an empty list for the wrong reason.
mod.seedBuiltinAgents()

let failed = 0
function check(label, condition, detail) {
  if (condition) {
    console.log(`PASS  ${label}`)
  } else {
    failed += 1
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// 1. Frontmatter parsing: the built-in SKILL.md files are the real fixture.
const dataSkill = join(here, '..', 'packages', 'aibench', 'agents', 'aibench-data', 'skills', 'data.run', 'SKILL.md')
const { readFileSync } = await import('node:fs')
const raw = readFileSync(dataSkill, 'utf8')
const parsed = mod.parseSkillFrontmatter(raw)
check('frontmatter name is read', parsed.meta.name === 'data-run', `got ${JSON.stringify(parsed.meta.name)}`)
check('frontmatter description is read', typeof parsed.meta.description === 'string' && parsed.meta.description.length > 0)
check('frontmatter body excludes the fence', parsed.body.startsWith('# AiBench Data'))

// 2. Missing frontmatter must not throw — the whole file becomes the body.
const bare = mod.parseSkillFrontmatter('# just markdown\n\nno fence here')
check('missing frontmatter is tolerated', bare.meta.name === undefined && bare.body.includes('just markdown'))

// 3. The skills the panel exposes must be namespaced and kebab-case.
const skills = mod.listSkills()
check('listSkills returns the built-in skills', skills.length >= 3, `got ${skills.length}`)
const badId = skills.find((skill) => !/^aibench:[A-Za-z0-9._-]+:[a-z0-9-]+$/.test(skill.id))
check('skill ids are namespaced', !badId, badId ? badId.id : '')
const badName = skills.find((skill) => !/^[a-z0-9][a-z0-9-]*$/.test(skill.name))
check('skill names are kebab-case', !badName, badName ? badName.name : '')
const withAt = skills.every((skill) => skill.at === `@${skill.name}`)
check('each skill carries its @ handle', withAt)
const withAgent = skills.every((skill) => typeof skill.agentId === 'string' && skill.agentId)
check('each skill names its agent', withAgent)

// 4. Every collected skill must point at a readable SKILL.md on disk.
const collected = mod.collectAgentSkills()
let missing = null
for (const skill of collected) {
  try {
    const body = readFileSync(skill.path, 'utf8')
    if (!body.trim()) throw new Error('empty')
  } catch {
    missing = skill.path
    break
  }
}
check('every skill resolves to a readable file', !missing, missing || '')
check('collected skills carry their source path', collected.every((skill) => skill.path && skill.path.endsWith('SKILL.md')))

// 5. Without the Host skills service, syncSkills must degrade instead of throwing.
const dry = mod.syncSkills()
check('syncSkills degrades without the service', dry.available === false && dry.registered === 0, JSON.stringify(dry))

// 6. Every built-in agent ships exactly one skill, so the default binding must
// resolve without the user ever opening the config dialog.
const agents = mod.listAgents()
check('agents are installed for the binding check', agents.length >= 3, `got ${agents.length}`)
let unbound = null
for (const agent of agents) {
  const bound = mod.defaultSkillFor(agent.id)
  if (!bound || bound.agentId !== agent.id) {
    unbound = agent.id
    break
  }
}
check('every agent resolves a default skill', !unbound, unbound || '')

// 7. The binding must be visible to the Client: exactly one `default` per agent.
const bindings = mod.agentSkillBindings(agents[0].id)
const defaults = bindings.filter((skill) => skill.default)
check('agentSkillBindings marks one default', bindings.length > 0 && defaults.length === 1, `${defaults.length} of ${bindings.length}`)
check('agentSkillBindings carries the @ handle', bindings.every((skill) => skill.at === `@${skill.name}`))

// 8. listSkills flags the same skill the resolver returns, so the Studio panel
// and the render path can never disagree about which pipeline is automatic.
const allSkills = mod.listSkills()
const flagged = allSkills.filter((skill) => skill.default)
check('listSkills flags at least one default', flagged.length >= 1, `got ${flagged.length}`)
const disagree = allSkills.find((skill) => {
  const bound = mod.defaultSkillFor(skill.agentId)
  return skill.default !== (!!bound && bound.id === skill.id)
})
check('listSkills default flag matches the resolver', !disagree, disagree ? disagree.id : '')

// 9. An unknown agent id must resolve to null rather than throwing.
check('unknown agent has no default skill', mod.defaultSkillFor('no-such-agent') === null)

if (failed > 0) {
  console.log(`\n${failed} skill check(s) failed`)
  process.exit(1)
}
console.log(`\nskill checks ok (${skills.length} skills)`)
