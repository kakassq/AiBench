/**
 * AiBench — Host half.
 *
 * S0 scope: install, expose /aibench-api, report panel info, list data dirs.
 * Later stages add agents / templates / projects / render / forge on top of the
 * same single prefix route.
 *
 * Deliberate constraints:
 *  - one prefix route only (webServer throws on a duplicate kind+path)
 *  - the disposer is owned by this activation through ctx.effect
 *  - no network on import, no side effects until apply() runs
 */

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BRAND = 'AiBench'
export const VERSION = '0.1.0'
export const BASE_PATH = '/aibench-api'

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(PLUGIN_DIR, '..')

/**
 * Locate the render engine.
 *
 * The engine ships *inside* this package (`<plugin>/render`), so there is only
 * one layout to care about — the same directory exists in a source checkout and
 * in an installed package. Keeping it in-tree is deliberate: the alternative was
 * a second npm package, and npm's granular tokens cannot create a new package,
 * so a two-package split would make the plugin uninstallable from the repo.
 *
 * What differs between layouts is where Remotion itself lands:
 *
 *   source checkout   <plugin>/render/node_modules/@remotion/cli
 *   npm (flat)        <pkg_root>/@remotion/cli        pkg_root = node_modules/
 *   pnpm              <pkg_root>/@remotion/cli        pkg_root = .pnpm/<id>/node_modules/
 *   npm (nested)      <plugin>/node_modules/@remotion/cli
 *
 * The pnpm case is the one that bites: it does not hoist to the project's
 * node_modules, it puts each package's dependencies as *siblings* inside the
 * virtual store directory. So `PKG_ROOT/@remotion/cli` — not
 * `PKG_ROOT/node_modules/@remotion/cli` — is the path that works there, and it
 * happens to be the correct one for a flat npm install too.
 */
const RENDER_DIR = join(PLUGIN_DIR, 'render')

function resolveRenderCli() {
  const candidates = [
    join(RENDER_DIR, 'node_modules', '@remotion', 'cli', 'remotion-cli.js'),
    join(PLUGIN_DIR, 'node_modules', '@remotion', 'cli', 'remotion-cli.js'),
    join(PKG_ROOT, '@remotion', 'cli', 'remotion-cli.js'),
    join(PKG_ROOT, 'node_modules', '@remotion', 'cli', 'remotion-cli.js'),
  ]
  for (const file of candidates) {
    if (existsSync(file)) return file
  }
  return candidates[0]
}

const RENDER_CLI = resolveRenderCli()

const PLATFORM = process.platform === 'win32' ? 'win32' : process.platform

/**
 * Resolve the DSH profile directory the same way the Host does.
 *
 * The Host process does not always export DSH_PROFILE_DIR, so the env var alone
 * is not enough: on this machine the real profile lives at
 * `~/.dsh/profiles/desktop` while `%APPDATA%\.dsh` exists only as a partial
 * mirror. Prefer whichever candidate actually contains a profile package.json.
 */
function resolveProfileDir() {
  const candidates = []
  const fromEnv = process.env.DSH_PROFILE_DIR
  if (fromEnv && fromEnv.trim()) candidates.push(fromEnv.trim())
  const home = process.env.DSH_HOME
  if (home && home.trim()) candidates.push(join(home.trim(), 'profiles', 'desktop'))
  if (process.env.USERPROFILE) candidates.push(join(process.env.USERPROFILE, '.dsh', 'profiles', 'desktop'))
  if (process.env.HOME) candidates.push(join(process.env.HOME, '.dsh', 'profiles', 'desktop'))
  const appData = process.env.APPDATA
  if (appData) candidates.push(join(appData, '.dsh', 'profiles', 'desktop'))

  for (const dir of candidates) {
    if (existsSync(join(dir, 'package.json'))) return dir
  }
  if (candidates.length > 0) return candidates[0]
  return join(process.cwd(), '.dsh', 'profiles', 'desktop')
}

const PROFILE_DIR = resolveProfileDir()
const DATA_DIR = join(PROFILE_DIR, 'aibench')
const AGENTS_DIR = join(DATA_DIR, 'agents')
const PROJECTS_DIR = join(DATA_DIR, 'projects')
const FORGE_DIR = join(DATA_DIR, 'forge')
const SETTINGS_FILE = join(DATA_DIR, 'settings.json')
const AGENTS_INDEX = join(DATA_DIR, 'agents.json')

/** Built-in agent packages ship inside the bundle and get seeded on first run. */
const BUILTIN_AGENTS_DIR = join(PLUGIN_DIR, 'agents')

const STILL_TIMEOUT_MS = 5 * 60 * 1000
const RENDER_TIMEOUT_MS = 15 * 60 * 1000

/** Composition id per output aspect ratio. Mirrors aibench-render/src/Root.tsx. */
const COMPOSITIONS = {
  '16:9': { id: 'AiClip', width: 1920, height: 1080 },
  '9:16': { id: 'AiClipVertical', width: 1080, height: 1920 },
  '1:1': { id: 'AiClipSquare', width: 1080, height: 1080 },
}

/**
 * One-click video model routes, cheapest first.
 *
 * The panel never hard-codes a provider that may be missing from this Host:
 * every route is filtered against `llm.listProviders()` before use, and a route
 * that answers with `finish.reason.failure.code === 'QUOTA'` (HTTP 429) falls
 * through to the next one. When every route fails the caller degrades to the
 * deterministic local planner, so one-click never dead-ends.
 */
const LLM_ROUTES = [
  { provider: 'workbuddy', model: 'deepseek-v4.1-flash', label: 'deepseek-v4.1-flash' },
  { provider: 'deepseek-account', model: 'deepseek-flash', label: 'deepseek-flash' },
  { provider: 'workbuddy', model: 'glm-5.3-flash', label: 'glm-5.3-flash' },
  { provider: 'deepseek-account', model: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
]

const LLM_TIMEOUT_MS = 60 * 1000

/** Per-agent settings live next to the manifest so a reinstall can keep them. */
const AGENT_CONFIG_FILE = 'config.json'

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

/** Deterministic 32-bit hash — no Math.random anywhere in the planning path. */
export function hashText(text) {
  const input = String(text ?? '')
  let h = 2166136261 >>> 0
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

function nowIso() {
  return new Date().toISOString()
}

function errorMessage(error) {
  if (!error) return 'unknown error'
  return String(error.message ?? error)
}

function slugify(input, fallback = 'item') {
  const ascii = String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return ascii || fallback
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function readJsonFile(file, fallback) {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonFile(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function ensureDataDirs() {
  for (const dir of [DATA_DIR, AGENTS_DIR, PROJECTS_DIR, FORGE_DIR]) {
    mkdirSync(dir, { recursive: true })
  }
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function sendError(res, status, code, message, detail) {
  sendJson(res, status, { ok: false, error: { code, message, ...(detail ? { detail } : {}) } })
}

/** Only accept same-origin browser calls from the local host. */
export function isTrustedRequest(req) {
  const fetchSite = String(req.headers['sec-fetch-site'] ?? '')
  if (fetchSite === 'cross-site') return false
  const host = String(req.headers.host ?? '')
  if (!host) return false
  const hostname = host.replace(/:\d+$/, '')
  const local = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
  if (!local) return false
  const origin = String(req.headers.origin ?? '')
  if (!origin) return true
  try {
    const url = new URL(origin)
    return url.host === host
  } catch {
    return false
  }
}

function readJsonBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limitBytes) {
        rejectPromise(new Error(`request body exceeds ${limitBytes} bytes`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) {
        resolvePromise({})
        return
      }
      try {
        resolvePromise(JSON.parse(raw))
      } catch (error) {
        rejectPromise(new Error(`invalid JSON body: ${errorMessage(error)}`))
      }
    })
    req.on('error', (error) => rejectPromise(error))
  })
}

function sha256File(file) {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Repository-ish stores (JSON files under the profile data dir)
// ---------------------------------------------------------------------------

function readSettings() {
  const raw = readJsonFile(SETTINGS_FILE, {})
  return {
    locale: typeof raw.locale === 'string' ? raw.locale : 'zh',
    ...raw,
  }
}

function writeSettings(next) {
  writeJsonFile(SETTINGS_FILE, next)
  return next
}

function readAgentsIndex() {
  const raw = readJsonFile(AGENTS_INDEX, { items: [] })
  return Array.isArray(raw?.items) ? raw.items : []
}

function writeAgentsIndex(items) {
  writeJsonFile(AGENTS_INDEX, { items, updatedAt: nowIso() })
}

/** Installed agents = index entries whose directory still exists. */
export function listAgents() {
  const items = readAgentsIndex()
  const alive = []
  for (const item of items) {
    if (!item || typeof item.id !== 'string') continue
    const dir = join(AGENTS_DIR, item.id)
    if (!existsSync(dir)) continue
    const manifest = readJsonFile(join(dir, 'manifest.json'), null)
    if (!manifest) continue
    const config = readAgentConfig(item.id)
    alive.push({
      id: item.id,
      name: typeof manifest.name === 'string' ? manifest.name : item.id,
      description: typeof manifest.description === 'string' ? manifest.description : '',
      version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
      icon: typeof manifest.icon === 'string' ? manifest.icon : null,
      tracks: Array.isArray(manifest.tracks) ? manifest.tracks : [],
      skills: Array.isArray(manifest.skills) ? manifest.skills.map((s) => (typeof s === 'string' ? s : s?.id)).filter(Boolean) : [],
      templates: countTemplates(dir),
      path: dir,
      source: item.source ?? 'local',
      builtin: item.builtin === true,
      installedAt: item.installedAt ?? null,
      config: {
        provider: config.provider,
        model: config.model,
        skill: config.skill,
        env: config.env,
      },
    })
  }
  if (alive.length !== items.length) writeAgentsIndex(alive)
  return alive
}

function countTemplates(agentDir) {
  const dir = join(agentDir, 'templates')
  if (!existsSync(dir)) return 0
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.template.json')).length
  } catch {
    return 0
  }
}

function listTemplates(agents) {
  const out = []
  for (const agent of agents) {
    const dir = join(agent.path, 'templates')
    if (!existsSync(dir)) continue
    let names = []
    try {
      names = readdirSync(dir).filter((name) => name.endsWith('.template.json'))
    } catch {
      continue
    }
    for (const name of names) {
      const tpl = readJsonFile(join(dir, name), null)
      if (!tpl || typeof tpl.id !== 'string') continue
      out.push({ ...tpl, agentId: agent.id, agentName: agent.name })
    }
  }
  return out
}

function projectPaths(id) {
  const dir = join(PROJECTS_DIR, id)
  return {
    dir,
    project: join(dir, 'project.json'),
  }
}

function listProjects() {
  if (!existsSync(PROJECTS_DIR)) return []
  let names = []
  try {
    names = readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
  const items = []
  for (const id of names) {
    const { project } = projectPaths(id)
    const raw = readJsonFile(project, null)
    if (!raw) continue
    items.push(raw)
  }
  items.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
  return items
}

function readProject(id) {
  const { project } = projectPaths(id)
  return readJsonFile(project, null)
}

function writeProject(record) {
  const { dir, project } = projectPaths(record.id)
  mkdirSync(join(dir, 'outputs'), { recursive: true })
  writeJsonFile(project, { ...record, updatedAt: nowIso() })
  return record
}

// ---------------------------------------------------------------------------
// Built-in agent seeding
// ---------------------------------------------------------------------------

/** Recursive copy — small trees only (manifests, skills, templates). */
function copyDirSync(src, dst) {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name)
    const to = join(dst, entry.name)
    if (entry.isDirectory()) copyDirSync(from, to)
    else if (entry.isFile()) copyFileSync(from, to)
  }
}

/**
 * Copy the agent packages that ship inside this bundle into the profile data
 * dir, so `listAgents()` has something to return before the user installs
 * anything. Idempotent: an agent whose directory already holds a readable
 * manifest is left untouched (the user may have edited it).
 */
function seedBuiltinAgents() {
  if (!existsSync(BUILTIN_AGENTS_DIR)) return []
  let names = []
  try {
    names = readdirSync(BUILTIN_AGENTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }

  const index = readAgentsIndex()
  const known = new Map(index.map((item) => [item?.id, item]))
  let changed = false

  for (const name of names) {
    const manifest = readJsonFile(join(BUILTIN_AGENTS_DIR, name, 'manifest.json'), null)
    if (!manifest || typeof manifest.id !== 'string') continue
    const id = manifest.id
    const target = join(AGENTS_DIR, id)
    const installed = existsSync(join(target, 'manifest.json'))
    if (!installed) {
      try {
        copyDirSync(join(BUILTIN_AGENTS_DIR, name), target)
      } catch (error) {
        console.error(`[aibench] failed to seed built-in agent ${id}: ${errorMessage(error)}`)
        continue
      }
    }
    if (!known.has(id)) {
      known.set(id, {
        id,
        source: 'builtin',
        builtin: true,
        version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
        installedAt: nowIso(),
      })
      changed = true
    }
  }

  if (changed) writeAgentsIndex([...known.values()])
  return [...known.values()]
}

// ---------------------------------------------------------------------------
// Agent lifecycle: install / uninstall / configure
// ---------------------------------------------------------------------------

/**
 * Per-agent configuration, stored beside the manifest.
 *
 * `env` is the real point of "configure environment": those pairs are merged
 * into the Remotion subprocess environment, so an agent can demand e.g. a
 * specific `TZ` or a font-cache path without the panel growing per-agent code.
 */
function readAgentConfig(agentId) {
  const file = join(AGENTS_DIR, agentId, AGENT_CONFIG_FILE)
  const raw = readJsonFile(file, {}) ?? {}
  const env = {}
  if (raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env)) {
    for (const [key, value] of Object.entries(raw.env)) {
      // Only plain scalar env vars: a nested object here would reach spawn() and
      // throw at render time instead of at save time.
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        env[String(key)] = String(value)
      }
    }
  }
  return {
    provider: typeof raw.provider === 'string' ? raw.provider : '',
    model: typeof raw.model === 'string' ? raw.model : '',
    // The skill this agent runs without being told. `''` means "no default",
    // which is what an agent with zero skills resolves to anyway.
    skill: typeof raw.skill === 'string' ? raw.skill : '',
    env,
    defaults: raw.defaults && typeof raw.defaults === 'object' && !Array.isArray(raw.defaults) ? raw.defaults : {},
  }
}

function writeAgentConfig(agentId, next) {
  const file = join(AGENTS_DIR, agentId, AGENT_CONFIG_FILE)
  writeJsonFile(file, next)
  return next
}

/** Read a manifest from an arbitrary directory, with the fields we rely on validated. */
function readAgentManifest(dir) {
  const manifest = readJsonFile(join(dir, 'manifest.json'), null)
  if (!manifest || typeof manifest !== 'object') return null
  if (typeof manifest.id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(manifest.id)) return null
  return manifest
}

/**
 * Install one agent package from a local directory.
 *
 * The package shape is the same one the built-ins use: `manifest.json` plus
 * optional `templates/*.template.json` and `skills/<id>/SKILL.md`. We copy it
 * into the profile data dir so the source folder can be moved or deleted, and
 * so uninstall is a single recursive remove.
 */
function installAgentFromDir(sourceDir, options = {}) {
  const src = resolve(String(sourceDir ?? ''))
  if (!existsSync(src)) throw new Error(`source directory not found: ${src}`)
  const manifest = readAgentManifest(src)
  if (!manifest) throw new Error(`not an agent package (manifest.json with a valid "id"): ${src}`)
  const id = manifest.id
  const target = join(AGENTS_DIR, id)
  const existed = existsSync(join(target, 'manifest.json'))

  // Keep the user's per-agent config across a reinstall: it is ours, not the
  // package author's.
  const previousConfig = existed ? readAgentConfig(id) : null

  if (existed && !options.overwrite) {
    return { installed: false, alreadyInstalled: true, id, manifest }
  }
  if (existed) rmSync(target, { recursive: true, force: true })
  copyDirSync(src, target)

  const index = readAgentsIndex()
  const known = new Map(index.map((item) => [item?.id, item]))
  known.set(id, {
    id,
    source: options.source ?? 'local',
    builtin: options.source === 'builtin',
    version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
    installedAt: nowIso(),
    origin: src,
  })
  writeAgentsIndex([...known.values()])

  if (previousConfig) writeAgentConfig(id, previousConfig)

  return { installed: true, id, manifest, replaced: existed }
}

/** Remove an agent package. Projects keep their `agentId` and stay openable. */
function uninstallAgent(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`invalid agent id: ${id}`)
  const dir = join(AGENTS_DIR, id)
  if (!existsSync(dir)) return { removed: false, id }
  const projects = listProjects().filter((project) => project.agentId === id).length
  rmSync(dir, { recursive: true, force: true })
  writeAgentsIndex(readAgentsIndex().filter((item) => item?.id !== id))
  return { removed: true, id, projects }
}

/** Restore a built-in agent from the copy that ships inside the bundle. */
function reinstallBuiltin(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`invalid agent id: ${id}`)
  if (!existsSync(BUILTIN_AGENTS_DIR)) throw new Error('this build ships no built-in agents')
  const names = readdirSync(BUILTIN_AGENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  for (const name of names) {
    const dir = join(BUILTIN_AGENTS_DIR, name)
    const manifest = readAgentManifest(dir)
    if (manifest && manifest.id === id) return installAgentFromDir(dir, { overwrite: true, source: 'builtin' })
  }
  throw new Error(`no built-in agent with id "${id}"`)
}

/** Built-in packages that are NOT installed right now — the wall's "install" list. */
/**
 * Parse the YAML-ish frontmatter of a SKILL.md. Only the two keys the DSH skill
 * catalog needs are read (`name`, `description`), plus optional `whenToUse`.
 * A hand-rolled parser is used on purpose: skills ship inside agent packages and
 * must not drag a YAML dependency into the Host half.
 */
export function parseSkillFrontmatter(text) {
  const source = String(text ?? '')
  const match = source.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { meta: {}, body: source }
  const meta = {}
  let key = null
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const pair = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/)
    if (pair) {
      key = pair[1]
      let value = pair[2].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      meta[key] = value
      continue
    }
    // Continuation line of a folded value.
    if (key && /^\s+/.test(line)) meta[key] = `${meta[key]} ${line.trim()}`.trim()
  }
  return { meta, body: source.slice(match[0].length).replace(/^[\r\n]+/, '') }
}

/**
 * Collect every installed agent's SKILL.md as a DSH skill registration.
 *
 * The panel's own skill ids stay namespaced (`aibench:<agentId>:<skillName>`) so
 * they can never shadow a bundled DSH skill or another plugin's skill; the
 * *model-facing* name is the frontmatter `name`, which is what `@data-run` in
 * the composer resolves to.
 */
export function collectAgentSkills() {
  const out = []
  for (const agent of listAgents()) {
    const dir = join(agent.path, 'skills')
    if (!existsSync(dir)) continue
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    } catch {
      continue
    }
    for (const entry of entries) {
      const file = join(dir, entry.name, 'SKILL.md')
      if (!existsSync(file)) continue
      let raw = ''
      try {
        raw = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      const { meta } = parseSkillFrontmatter(raw)
      const name = typeof meta.name === 'string' && meta.name ? meta.name : entry.name
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) continue
      out.push({
        id: `aibench:${agent.id}:${name}`,
        name,
        description: typeof meta.description === 'string' ? meta.description : `${agent.name} skill`,
        whenToUse: typeof meta.whenToUse === 'string' ? meta.whenToUse : undefined,
        agentId: agent.id,
        agentName: agent.name,
        path: file,
        // The `@handle` lives on the record itself: every consumer that needs to
        // show or inject a skill needs it, and deriving it per call site is how
        // the director ended up reporting `undefined` for its own binding.
        at: `@${name}`,
      })
    }
  }
  return out
}

/** The skills the panel currently knows about, for the Client to display. */
export function listSkills() {
  const skills = collectAgentSkills()
  // Resolve the binding once per agent: `defaultSkillFor` re-collects skills and
  // reads config, so calling it per skill would re-read every SKILL.md N times.
  const bound = new Map()
  for (const skill of skills) {
    if (!bound.has(skill.agentId)) bound.set(skill.agentId, resolveDefaultSkill(skill.agentId, skills))
  }
  return skills.map((skill) => {
    const pick = bound.get(skill.agentId)
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse ?? null,
      agentId: skill.agentId,
      agentName: skill.agentName,
      at: skill.at,
      // `default` lets the panel mark the pipeline an agent runs on its own, so
      // the skill list reads as "this is what happens if I say nothing".
      default: !!pick && pick.id === skill.id,
    }
  })
}

/**
 * The skill an agent runs by default, resolved to a real skill record.
 *
 * Resolution order is config → manifest order → none:
 *  - `config.skill` is an explicit pick (the panel writes it, the user can edit it);
 *  - an agent that ships exactly one skill needs no pick — binding it is what
 *    makes "just talk to the agent" work without hunting for the skill name;
 *  - an agent with several skills and no pick stays unbound rather than
 *    guessing, because silently running the wrong pipeline is worse than asking.
 *
 * Returns `null` when nothing is bound.
 */
export function defaultSkillFor(agentId) {
  return resolveDefaultSkill(agentId, collectAgentSkills())
}

/**
 * The binding rule itself, against an already-collected skill list.
 * Split out so callers holding the list do not re-read every SKILL.md per agent.
 */
function resolveDefaultSkill(agentId, skills) {
  const own = skills.filter((skill) => skill.agentId === agentId)
  if (own.length === 0) return null
  const picked = readAgentConfig(agentId).skill
  if (picked) {
    const match = own.find((skill) => skill.name === picked || skill.id === picked || skill.at === picked)
    if (match) return match
    // A stale pick (skill renamed or removed by an update) must not break the
    // agent: fall through to the single-skill rule instead of returning null.
  }
  return own.length === 1 ? own[0] : null
}

/**
 * Every skill the agent owns, with the bound one marked. This is what the panel
 * renders so a user can see *why* a sentence will run a given pipeline.
 */
export function agentSkillBindings(agentId) {
  const skills = collectAgentSkills()
  const bound = resolveDefaultSkill(agentId, skills)
  return skills
    .filter((skill) => skill.agentId === agentId)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse ?? null,
      at: skill.at,
      default: !!bound && bound.id === skill.id,
    }))
}

/**
 * The pipeline text of every agent's bound skill, for the director prompt.
 *
 * The director picks the agent inside its own reply, so the bound skill cannot
 * be resolved before the call. Injecting every bound pipeline up front is what
 * makes "the agent just runs its skill" true without a second round trip: the
 * model already holds the recipe for whichever agent it lands on.
 *
 * Content is capped per skill because these files are prose, not config, and a
 * runaway SKILL.md must not eat the whole context window.
 */
const SKILL_BLOCK_CHARS = 1800

function boundSkillBlock(agents, skills) {
  const list = skills || collectAgentSkills()
  const parts = []
  for (const agent of agents) {
    const bound = resolveDefaultSkill(agent.id, list)
    if (!bound) continue
    let content = ''
    try {
      content = readFileSync(bound.path, 'utf8')
    } catch {
      continue
    }
    // Frontmatter is metadata already summarised above; the body is the recipe.
    const body = parseSkillFrontmatter(content).body || content
    const trimmed = body.length > SKILL_BLOCK_CHARS ? `${body.slice(0, SKILL_BLOCK_CHARS)}\n…` : body
    parts.push(`### ${agent.id} → ${bound.at}\n${trimmed}`)
  }
  return parts.join('\n\n')
}

function listBuiltinAvailable() {
  if (!existsSync(BUILTIN_AGENTS_DIR)) return []
  const installed = new Set(listAgents().map((agent) => agent.id))
  const out = []
  for (const entry of readdirSync(BUILTIN_AGENTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(BUILTIN_AGENTS_DIR, entry.name)
    const manifest = readAgentManifest(dir)
    if (!manifest) continue
    out.push({
      id: manifest.id,
      name: typeof manifest.name === 'string' ? manifest.name : manifest.id,
      version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
      description: typeof manifest.description === 'string' ? manifest.description : '',
      tracks: Array.isArray(manifest.tracks) ? manifest.tracks : [],
      templates: countTemplates(dir),
      installed: installed.has(manifest.id),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Render jobs
// ---------------------------------------------------------------------------

/** @type {Map<string, {id: string, kind: string, projectId: string, status: string, progress: number, startedAt: string, finishedAt: string|null, output: string|null, width: number, height: number, frame: number|null, error: string|null, logs: string[]}>} */
const jobs = new Map()

function newJob(kind, projectId, extra = {}) {
  const job = {
    id: `j_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
    kind,
    projectId,
    status: 'running',
    progress: 0,
    startedAt: nowIso(),
    finishedAt: null,
    output: null,
    width: 0,
    height: 0,
    frame: null,
    error: null,
    logs: [],
    ...extra,
  }
  jobs.set(job.id, job)
  // Keep the newest 40 jobs; renders are heavy and nobody scrolls back further.
  if (jobs.size > 40) {
    const oldest = [...jobs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0]
    if (oldest) jobs.delete(oldest.id)
  }
  return job
}

function publicJob(job) {
  return {
    id: job.id,
    kind: job.kind,
    projectId: job.projectId,
    status: job.status,
    progress: job.progress,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    output: job.output,
    width: job.width,
    height: job.height,
    frame: job.frame,
    error: job.error,
    logs: job.logs.slice(-12),
  }
}

/** Newest first: the Task page lists them in this order. */
function listJobs() {
  return [...jobs.values()]
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .map(publicJob)
}

/**
 * Spawn the Remotion CLI. `args` must use forward slashes: the CLI re-parses
 * `--props` itself and a Windows backslash path silently fails the check
 * "neither valid JSON nor a file path".
 */
function runRemotion(args, timeoutMs, job, extraEnv) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [RENDER_CLI, ...args], {
      cwd: RENDER_DIR,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Per-agent environment from config.json: this is what makes "configure
      // environment" real instead of cosmetic.
      env: extraEnv && Object.keys(extraEnv).length > 0 ? { ...process.env, ...extraEnv } : process.env,
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      err += `\n[timed out after ${timeoutMs} ms]`
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      const text = String(chunk)
      out = (out + text).slice(-20000)
      job.progress = Math.min(95, job.progress + 1)
      const line = text.trim().split(/\r?\n/).filter(Boolean).pop()
      if (line && job.logs.length < 60) job.logs.push(line)
    })
    child.stderr.on('data', (chunk) => {
      const text = String(chunk)
      err = (err + text).slice(-20000)
      const line = text.trim().split(/\r?\n/).filter(Boolean).pop()
      if (line && job.logs.length < 60) job.logs.push(line)
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      resolvePromise({ ok: false, out, err: `${err}\n${errorMessage(error)}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ ok: code === 0, out, err })
    })
  })
}

// ---------------------------------------------------------------------------
// Storyboard bridge — reuse the exact planner the renderer uses, so the panel's
// shot table can never disagree with the frames Remotion produces.
// ---------------------------------------------------------------------------

const STORYBOARD_SOURCE = join(RENDER_DIR, 'src', 'storyboard.ts')
const STORYBOARD_BUILD = join(RENDER_DIR, 'dist', 'storyboard.mjs')
let storyboardModule = null
let storyboardStamp = 0

/**
 * Pick which copy of the planner to import.
 *
 * Source checkouts import the `.ts` directly (Node strips the types, edits are
 * live). Installed packages must use the prebuilt `.mjs`: Node refuses to strip
 * types for files under `node_modules`, so importing the `.ts` there throws
 * ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING and every storyboard call fails.
 *
 * The published package therefore ships `dist/storyboard.mjs` built from the
 * same source by `scripts/build-storyboard.mjs`, and `check-storyboard-build.mjs`
 * asserts the two produce identical storyboards.
 */
function storyboardEntry() {
  if (existsSync(STORYBOARD_SOURCE) && !RENDER_DIR.includes(`${sep}node_modules${sep}`)) {
    return { path: STORYBOARD_SOURCE, stampSource: STORYBOARD_SOURCE }
  }
  if (existsSync(STORYBOARD_BUILD)) return { path: STORYBOARD_BUILD, stampSource: STORYBOARD_SOURCE }
  if (existsSync(STORYBOARD_SOURCE)) return { path: STORYBOARD_SOURCE, stampSource: STORYBOARD_SOURCE }
  throw new Error(`storyboard planner missing: ${STORYBOARD_BUILD} / ${STORYBOARD_SOURCE}`)
}

async function loadStoryboard() {
  const entry = storyboardEntry()
  // The ESM registry caches by resolved URL, not by content: resetting the local
  // variable on re-activation still hands back the module instance from the
  // first import, so edits to storyboard.ts would never reach a running Host.
  // A changing query string makes each file version a distinct URL. `mtimeMs`
  // is enough — it changes on every save and costs one stat.
  const stamp = existsSync(entry.stampSource) ? statSync(entry.stampSource).mtimeMs : 0
  if (storyboardModule && stamp === storyboardStamp) return storyboardModule
  storyboardModule = await import(`${pathToFileURL(entry.path).href}?v=${Math.trunc(stamp)}`)
  storyboardStamp = stamp
  return storyboardModule
}

/**
 * Template → render-params mapping layer.
 *
 * A template carries two descriptions of the same film: a rich human/agent-facing
 * one (`style.look`, `style.palette`, `style.rhythm`, `audio.subtitles.kind`) and
 * the explicit numeric `defaults` block. Only `defaults` used to reach the
 * renderer, so a template that named a look but omitted a numeric key silently
 * fell back to `normalizeParams`' hardcoded default. This derives the numbers from
 * the rich description so the descriptor is authoritative for everything
 * `defaults` does not spell out.
 *
 * The two tables below MUST stay in sync with `aibench-render/src/storyboard.ts`;
 * `scripts/check-templates.mjs` imports both and fails if they drift.
 */
export const LOOK_IDS = ['swiss-dynamic-type', 'blueprint', 'terminal-crt', 'halftone-dossier', 'one-line']
export const PALETTE_NAMES = ['科技暗色', '终端绿', '霓虹紫', '极简白']
const SUBTITLE_MODES = ['none', 'zh', 'en', 'bilingual']
const ASPECTS = ['16:9', '9:16', '1:1']

export function templateParams(template) {
  const tpl = template && typeof template === 'object' ? template : {}
  const style = tpl.style && typeof tpl.style === 'object' ? tpl.style : {}
  const audio = tpl.audio && typeof tpl.audio === 'object' ? tpl.audio : {}
  const out = {}

  // `tokens[0]` is the primary look; `look` is the human-readable duplicate.
  const lookId = Array.isArray(style.tokens) && style.tokens.length > 0 ? style.tokens[0] : style.look
  const styleIndex = LOOK_IDS.indexOf(lookId)
  if (styleIndex >= 0) out.style = styleIndex

  const paletteIndex = PALETTE_NAMES.indexOf(style.palette)
  if (paletteIndex >= 0) out.palette = paletteIndex

  const rhythm = Number(style.rhythm ?? audio?.bgm?.bpm)
  if (Number.isFinite(rhythm) && rhythm > 0) out.beatBpm = rhythm

  const subtitleKind = audio?.subtitles?.kind
  if (SUBTITLE_MODES.includes(subtitleKind)) out.subtitle = subtitleKind

  // `voice.mode` is 'none' | 'narration'; the renderer wants 0 | 1.
  const voiceMode = audio?.voice?.mode
  if (voiceMode === 'none') out.voice = 0
  else if (voiceMode === 'narration' || voiceMode === 'voice') out.voice = 1

  if (Number.isFinite(Number(tpl.durationSec))) out.durationSec = Number(tpl.durationSec)
  if (ASPECTS.includes(tpl.aspect)) out.aspect = tpl.aspect
  return out
}

/**
 * The params a project starts from: descriptor-derived numbers first, then the
 * template's explicit `defaults` (curated, so they win), then caller overrides.
 */
export function templateDefaults(template) {
  return { ...templateParams(template), ...(template?.defaults ?? {}) }
}

/** Normalised render params: template defaults + project overrides, type-coerced. */
export function normalizeParams(raw, aspectHint) {
  const params = raw && typeof raw === 'object' ? raw : {}
  const aspect = ['16:9', '9:16', '1:1'].includes(params.aspect)
    ? params.aspect
    : ['16:9', '9:16', '1:1'].includes(aspectHint)
      ? aspectHint
      : '16:9'
  return {
    type: Math.trunc(clampNumber(params.type, 0, 2, 0)),
    style: Math.trunc(clampNumber(params.style, 0, 4, 0)),
    palette: Math.trunc(clampNumber(params.palette, 0, 3, 0)),
    flow: Math.trunc(clampNumber(params.flow, 0, 2, 0)),
    durationSec: clampNumber(params.durationSec, 10, 300, 20),
    beatBpm: clampNumber(params.beatBpm, 60, 200, 120),
    subtitle: ['none', 'zh', 'en', 'bilingual'].includes(params.subtitle) ? params.subtitle : 'bilingual',
    transition: Math.trunc(clampNumber(params.transition, 0, 7, 0)),
    effect: Math.trunc(clampNumber(params.effect, 0, 7, 0)),
    seed: Number.isFinite(Number(params.seed)) ? Number(params.seed) : undefined,
    accent: typeof params.accent === 'string' ? params.accent : undefined,
    bg: typeof params.bg === 'string' ? params.bg : undefined,
    fg: typeof params.fg === 'string' ? params.fg : undefined,
    aspect,
  }
}

function trimStoryboard(sb) {
  return {
    title: sb.title,
    seed: sb.seed,
    fps: sb.fps,
    totalFrames: sb.totalFrames,
    durationSec: sb.durationSec,
    beatBpm: sb.beatBpm,
    beatFrames: sb.beatFrames,
    paletteIndex: sb.paletteIndex,
    palette: sb.palette,
    look: sb.look,
    type: sb.type,
    style: sb.style,
    subtitle: sb.subtitle,
    shots: (sb.shots ?? []).map((shot) => ({
      index: shot.index,
      kind: shot.kind,
      name: shot.name,
      from: shot.from,
      durationFrames: shot.durationFrames,
      copy: shot.copy,
      caption: shot.caption ?? null,
      steps: shot.steps ?? null,
    })),
  }
}

async function planProject(record) {
  const sb = await loadStoryboard()
  const params = normalizeParams(record.params, record.aspect)
  const planned = sb.planStoryboard(record.brief ?? '', params)
  return trimStoryboard(planned)
}

/**
 * Plan a storyboard without touching disk. Exported for the installed-layout
 * check: it exercises the real `loadStoryboard()` path, which is the one that
 * throws when the prebuilt planner is missing from an npm install.
 */
export async function planStoryboardForTest(brief, params) {
  const sb = await loadStoryboard()
  return trimStoryboard(sb.planStoryboard(brief ?? '', normalizeParams(params, params?.aspect)))
}

/** Write the props file the CLI will read, and return its absolute POSIX path. */
function writePropsFile(project, mode) {
  const { dir } = projectPaths(project.id)
  const params = normalizeParams(project.params, project.aspect)
  const props = {
    brief: project.brief ?? '',
    params,
    seed: params.seed,
  }
  const file = join(dir, `props-${mode}.json`)
  writeFileSync(file, JSON.stringify(props), 'utf8')
  return file.replace(/\\/g, '/')
}

function aspectOf(project) {
  const aspect = normalizeParams(project.params, project.aspect).aspect
  return COMPOSITIONS[aspect] ?? COMPOSITIONS['16:9']
}

/** The env overrides the owning agent declared, for one render subprocess. */
function agentEnvFor(project) {
  if (!project || typeof project.agentId !== 'string') return {}
  try {
    return readAgentConfig(project.agentId).env
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// One-click director — natural language in, project out
// ---------------------------------------------------------------------------
//
// Two hard rules make this safe to put behind a single button:
//  1. The model only ever *chooses among* values the renderer already supports
//     (look/palette/flow indices, a duration off the allowed list). Anything it
//     invents is clamped by `normalizeParams`, so a bad reply cannot produce an
//     unrenderable project.
//  2. Any failure — no provider, timeout, 429, malformed JSON — falls back to a
//     deterministic local plan. The button never leaves the user with nothing.

/** JSON schema-ish description handed to the model; kept tiny on purpose. */
function directorPrompt(userPrompt, agents, templates, mode) {
  const catalogue = templates
    .slice(0, 24)
    .map((tpl) => `- ${tpl.id} (${tpl.agentName}): ${tpl.title} — ${tpl.brief ?? ''}`)
    .join('\n')
  // Collect once: the agent list and the pipeline block below both need the
  // bindings, and each collection reads every SKILL.md off disk.
  const allSkills = collectAgentSkills()
  const agentList = agents
    .map((agent) => {
      const bound = resolveDefaultSkill(agent.id, allSkills)
      // The director must know which pipeline each agent will run on its own,
      // otherwise it may pick an agent whose bound skill contradicts the intent.
      return `- ${agent.id}: ${agent.name} — ${agent.description || ''}${bound ? ` [runs ${bound.at}: ${bound.description}]` : ''}`
    })
    .join('\n')
  return [
    'You are the AiBench director. Turn one sentence of user intent into a single JSON object.',
    '',
    'Reply with JSON only. No prose, no code fence.',
    '',
    'Shape:',
    '{"agentId":"<one of the agents>","templateId":"<one of the templates>","title":"<short project title, <= 20 chars>","brief":"<one sentence describing what the video says, <= 60 chars>","params":{"type":0-2,"style":0-4,"palette":0-3,"flow":0-2,"durationSec":10|15|20|25|30|45|60,"beatBpm":90|100|110|120|128|140,"subtitle":"none"|"zh"|"en"|"bilingual","aspect":"16:9"|"9:16"|"1:1"}}',
    '',
    'Agents:',
    agentList,
    '',
    'Templates:',
    catalogue,
    '',
    `Selection mode: ${mode === 'random' ? 'pick any template that fits, surprise is welcome' : 'pick the template that best matches the intent'}.`,
    'Rules: the brief must be concrete and filmable with typography only (no footage, no photos, no voice-over). Prefer the template default params unless the intent clearly implies otherwise.',
    '',
    'Each agent runs the pipeline below on its own. Follow the one belonging to the agent you pick; do not mix two of them.',
    '',
    boundSkillBlock(agents, allSkills) || '(no agent has a bound pipeline)',
    '',
    `User intent: ${userPrompt}`,
  ].join('\n')
}

/** Pull the first JSON object out of a model reply, tolerating fences and prose. */
function extractJsonObject(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const fenced = raw.match(/```(?:json)?\s*\r?\n([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * One streaming model call. Resolves `{ ok, text, route, failure }`.
 * `failure.code === 'QUOTA'` is what tells the caller to try the next route.
 */
async function callLlmOnce(llm, route, system, userText, signal) {
  let text = ''
  let failure = null
  let finishKind = null
  try {
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      system,
      temperature: 0.7,
      maxTokens: 900,
      signal,
    })
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'finish') {
        finishKind = chunk.reason?.kind ?? null
        if (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted') {
          failure = chunk.reason.failure ?? { message: 'model call failed', code: 'UNKNOWN' }
        }
      }
    }
  } catch (error) {
    failure = { message: errorMessage(error), code: 'THROWN' }
  }
  return { ok: !failure && text.trim().length > 0, text, route, failure, finishKind }
}

/** Try each configured route until one answers. Returns `{ ok, text, route, attempts }`. */
async function callLlmWithFallback(llm, system, userText) {
  const attempts = []
  let available = []
  try {
    const providers = new Set(llm.listProviders().map((item) => item.id))
    available = LLM_ROUTES.filter((route) => providers.has(route.provider))
  } catch (error) {
    return { ok: false, text: '', route: null, attempts, error: `listProviders failed: ${errorMessage(error)}` }
  }
  if (available.length === 0) {
    return { ok: false, text: '', route: null, attempts, error: 'no configured provider serves a director model' }
  }

  for (const route of available) {
    const signal = AbortSignal.timeout(LLM_TIMEOUT_MS)
    const result = await callLlmOnce(llm, route, system, userText, signal)
    attempts.push({
      route: `${route.provider}/${route.model}`,
      ok: result.ok,
      chars: result.text.length,
      failure: result.failure ? `${result.failure.code}: ${result.failure.message}` : null,
    })
    if (result.ok) return { ok: true, text: result.text, route: result.route, attempts }
    // A hard auth/route error means the next route is worth trying too; a
    // timeout does not, because the user is already waiting.
    if (result.failure && result.failure.code === 'TIMEOUT') break
  }
  return { ok: false, text: '', route: null, attempts, error: 'every director route failed' }
}

/**
 * Deterministic fallback: pick a template from the intent with a keyword vote,
 * and derive the brief from the intent text itself. No network, no randomness
 * beyond a stable hash of the prompt.
 */
/**
 * Read the numbers and the shape words straight out of the sentence, so the
 * local fallback still honours "15 秒竖版" instead of quietly using the
 * template defaults. Returns a partial params patch.
 */
export function promptHints(userPrompt) {
  const text = String(userPrompt ?? '')
  const patch = {}

  // "15 秒" / "15s" / "15 sec" / "20秒"
  const seconds = text.match(/(\d{1,3})\s*(?:秒|s\b|sec)/i)
  if (seconds) {
    const value = Number(seconds[1])
    if (Number.isFinite(value) && value > 0) patch.durationSec = Math.min(300, Math.max(10, value))
  }

  if (/竖版|竖屏|vertical|9\s*[:：]\s*16/i.test(text)) patch.aspect = '9:16'
  else if (/方版|方形|正方|square|1\s*[:：]\s*1/i.test(text)) patch.aspect = '1:1'
  else if (/横版|横屏|wide|landscape|16\s*[:：]\s*9/i.test(text)) patch.aspect = '16:9'

  if (/卡点|强节奏|快节奏|燃|upbeat|fast/i.test(text)) patch.beatBpm = 128
  else if (/舒缓|慢|calm|slow|温柔/i.test(text)) patch.beatBpm = 90

  if (/终端|terminal|黑客|代码|console|cli/i.test(text)) patch.style = 2
  else if (/蓝图|blueprint|推演|technical/i.test(text)) patch.style = 1
  else if (/瑞士|排版|swiss|typograph/i.test(text)) patch.style = 0
  else if (/一笔画|手绘|sketch/i.test(text)) patch.style = 4

  if (/双语|bilingual/i.test(text)) patch.subtitle = 'bilingual'
  else if (/英文字幕|english subtitle/i.test(text)) patch.subtitle = 'en'
  else if (/中文字幕|chinese subtitle/i.test(text)) patch.subtitle = 'zh'
  else if (/无字幕|no subtitle/i.test(text)) patch.subtitle = 'none'

  return patch
}

/**
 * Deterministic fallback director. It picks a template by keyword vote and then
 * applies whatever the sentence actually asked for (duration, aspect, pace,
 * look, subtitles) on top of the template defaults.
 */
/**
 * Which agent does the sentence *want*? A one-char overlap vote cannot tell
 * `data.three-numbers` from `reel.countdown` (its brief literally reads
 * "3 2 1 三个数字各占一拍"), so the topic decides the agent and the vote only
 * picks the template inside it.
 */
export function topicAgentHint(userPrompt) {
  const text = String(userPrompt ?? '').toLowerCase()
  const rules = [
    { agent: 'data', re: /数据|图表|数字|增长|曲线|占比|拆分|信息图|data|chart|metric/i },
    { agent: 'reel', re: /卖点|开场|片头|字标|卡点|快剪|带货|上新|预告|reel|promo|intro|hook/i },
    { agent: 'explainer', re: /科普|原理|为什么|解释|概念|公式|定理|科普向|explain|why|concept/i },
  ]
  for (const rule of rules) {
    if (rule.re.test(text)) return rule.agent
  }
  return null
}

/** Split into CJK bigrams + latin words: "三个数字" beats loose single chars. */
function tokenizeForMatch(text) {
  const clean = String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')
  const tokens = new Set()
  for (const word of clean.split(' ')) {
    if (!word) continue
    if (/^[a-z0-9]+$/.test(word)) {
      if (word.length > 1) tokens.add(word)
      continue
    }
    const chars = [...word]
    if (chars.length === 1) tokens.add(chars[0])
    for (let i = 0; i < chars.length - 1; i++) tokens.add(chars[i] + chars[i + 1])
  }
  return [...tokens]
}

export function localDirectorPlan(userPrompt, agents, templates, mode) {
  const prompt = String(userPrompt ?? '').trim()
  const pool = templates.length > 0 ? templates : []
  if (pool.length === 0) throw new Error('no templates are installed; install an agent first')

  let picked = null
  if (mode === 'random') {
    picked = pool[hashText(prompt || 'aibench') % pool.length]
  } else {
    // Score on CJK bigrams / latin words, and give templates of the topic's
    // agent a decisive head start so "数据讲解" cannot land on a reel template.
    const wanted = topicAgentHint(prompt)
    const tokens = tokenizeForMatch(prompt)
    const scored = pool.map((tpl) => {
      const hay = `${tpl.title ?? ''} ${tpl.brief ?? ''} ${tpl.track ?? ''}`.toLowerCase()
      let score = 0
      for (const token of tokens) {
        if (hay.includes(token)) score += token.length > 1 ? 3 : 1
      }
      if (wanted && String(tpl.agentId ?? '').indexOf(wanted) >= 0) score += 12
      return { tpl, score }
    })
    scored.sort((a, b) => b.score - a.score)
    picked = scored[0].score > 0 ? scored[0].tpl : pool[0]
  }

  const brief = prompt || picked.brief || ''
  return {
    agentId: picked.agentId,
    templateId: picked.id,
    title: (brief || picked.title || 'Untitled').slice(0, 20),
    brief: brief.slice(0, 60),
    params: { ...templateDefaults(picked), ...promptHints(prompt) },
  }
}

/**
 * Validate a model plan against what actually exists, then clamp it.
 * Returns `{ plan, rejected }` — `rejected` lists every field we overrode, which
 * the client surfaces so the user can see the director was corrected.
 */
function sanitizeDirectorPlan(raw, agents, templates, mode, userPrompt) {
  const rejected = []
  const fallback = localDirectorPlan(userPrompt, agents, templates, mode)
  const plan = raw && typeof raw === 'object' ? raw : {}

  let template = templates.find((tpl) => tpl.id === plan.templateId) || null
  if (!template) {
    if (plan.templateId) rejected.push('templateId')
    template = templates.find((tpl) => tpl.id === fallback.templateId) || templates[0]
  }

  let agent = agents.find((item) => item.id === plan.agentId) || null
  if (!agent) {
    if (plan.agentId) rejected.push('agentId')
    agent = agents.find((item) => item.id === template.agentId) || agents[0]
  }
  // A template belongs to exactly one agent; trust the template over the model.
  if (agent.id !== template.agentId) {
    agent = agents.find((item) => item.id === template.agentId) || agent
  }

  const rawParams = plan.params && typeof plan.params === 'object' ? plan.params : {}
  // With no model answer (or a partial one) the deterministic plan still knows
  // what the sentence asked for, so it fills the gaps rather than the template
  // defaults winning.
  const merged = { ...templateDefaults(template), ...(fallback.params ?? {}), ...rawParams }
  const params = normalizeParams(merged, template.aspect ?? templateDefaults(template).aspect)
  for (const key of ['type', 'style', 'palette', 'flow', 'durationSec', 'beatBpm', 'subtitle', 'aspect']) {
    if (key in rawParams && String(rawParams[key]) !== String(params[key])) rejected.push(key)
  }

  const title = typeof plan.title === 'string' && plan.title.trim() ? plan.title.trim().slice(0, 40) : fallback.title
  const brief = typeof plan.brief === 'string' && plan.brief.trim() ? plan.brief.trim().slice(0, 200) : fallback.brief

  return { plan: { agentId: agent.id, templateId: template.id, title, brief, params }, rejected, template, agent }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * The activation context, captured by `apply()`.
 *
 * `handle()` is a module-level function so the route table stays one flat if
 * chain, but a few routes need Host services (`llm`). Keeping the context here
 * is the smallest thing that works; it is cleared on dispose.
 */
let ctxRef = null

/**
 * Live registrations in the DSH `skills` service, keyed by `aibench:<agent>:<name>`.
 *
 * `skills.register()` returns a disposer, and re-registering the same name in one
 * layer is first-wins — so an install/uninstall cycle MUST dispose the previous
 * registration before registering again, otherwise the catalog keeps serving the
 * removed agent's skill.
 */
const skillRegistrations = new Map()

/**
 * Push the current agent skills into the DSH skill catalog.
 *
 * Safe to call any time: when the `skills` service is absent (older Host, or a
 * preset that does not mount it) this degrades to a no-op and the panel still
 * lists skills from its own route.
 */
export function syncSkills() {
  const skills = ctxRef && typeof ctxRef.get === 'function' ? ctxRef.get('skills') : null
  const wanted = collectAgentSkills()
  if (!skills || typeof skills.register !== 'function') {
    return { registered: 0, available: false, total: wanted.length }
  }

  const wantedIds = new Set(wanted.map((skill) => skill.id))
  for (const [id, disposer] of [...skillRegistrations]) {
    if (wantedIds.has(id)) continue
    try {
      disposer()
    } catch (error) {
      console.error(`[aibench] failed to release skill ${id}: ${errorMessage(error)}`)
    }
    skillRegistrations.delete(id)
  }

  for (const skill of wanted) {
    if (skillRegistrations.has(skill.id)) continue
    try {
      const disposer = skills.register({
        name: skill.name,
        description: skill.description,
        ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
        content: readFileSync(skill.path, 'utf8'),
        source: 'custom',
        provider: 'aibench',
        resourceBase: { kind: 'directory', path: dirname(skill.path) },
        invocation: { modelInvocable: true, userInvocable: true },
      })
      skillRegistrations.set(skill.id, typeof disposer === 'function' ? disposer : () => {})
    } catch (error) {
      console.error(`[aibench] failed to register skill ${skill.name}: ${errorMessage(error)}`)
    }
  }
  return { registered: skillRegistrations.size, available: true, total: wanted.length }
}

function releaseSkills() {
  for (const [id, disposer] of [...skillRegistrations]) {
    try {
      disposer()
    } catch {
      // Disposal during teardown must never throw.
    }
    skillRegistrations.delete(id)
  }
}

function routePath(url) {
  const raw = String(url ?? '/')
  const q = raw.indexOf('?')
  const path = q === -1 ? raw : raw.slice(0, q)
  const suffix = path.startsWith(BASE_PATH) ? path.slice(BASE_PATH.length) : path
  return suffix || '/'
}

function parseUrl(req) {
  try {
    return new URL(req.url ?? '/', 'http://127.0.0.1')
  } catch {
    return new URL('/', 'http://127.0.0.1')
  }
}

function renderStatus() {
  return {
    engine: 'remotion',
    projectDir: RENDER_DIR,
    cli: RENDER_CLI,
    available: existsSync(RENDER_CLI),
  }
}

async function handle(req, res) {
  if (!isTrustedRequest(req)) {
    sendError(res, 403, 'forbidden_origin', 'AiBench only accepts same-origin requests from the local host.')
    return
  }

  const url = parseUrl(req)
  const path = routePath(url.pathname)
  const method = String(req.method ?? 'GET').toUpperCase()

  // GET /panel/info
  if (method === 'GET' && path === '/panel/info') {
    const agents = listAgents()
    sendJson(res, 200, {
      ok: true,
      name: BRAND,
      version: VERSION,
      platform: PLATFORM,
      node: process.version,
      dataDir: DATA_DIR,
      agentsDir: AGENTS_DIR,
      projectsDir: PROJECTS_DIR,
      render: renderStatus(),
      counts: {
        agents: agents.length,
        templates: listTemplates(agents).length,
        projects: listProjects().length,
      },
      features: {
        permitGate: false,
        forge: false,
        store: false,
        voice: false,
        director: !!(ctxRef?.get && ctxRef.get('llm')),
        agentLifecycle: true,
        skillBridge: !!(ctxRef?.get && ctxRef.get('skills')),
      },
    })
    return
  }

  // GET /panel/health
  if (method === 'GET' && path === '/panel/health') {
    sendJson(res, 200, {
      ok: true,
      node: process.version,
      platform: PLATFORM,
      render: renderStatus(),
      dataDirWritable: existsSync(DATA_DIR),
    })
    return
  }

  // GET /panel/settings
  if (method === 'GET' && path === '/panel/settings') {
    sendJson(res, 200, { ok: true, settings: readSettings() })
    return
  }

  // PUT /panel/settings
  if (method === 'PUT' && path === '/panel/settings') {
    try {
      const body = await readJsonBody(req)
      const next = { ...readSettings(), ...body }
      writeSettings(next)
      sendJson(res, 200, { ok: true, settings: next })
    } catch (error) {
      sendError(res, 400, 'bad_request', errorMessage(error))
    }
    return
  }

  // GET /agents
  if (method === 'GET' && path === '/agents') {
    sendJson(res, 200, { ok: true, items: listAgents() })
    return
  }

  // GET /agents/available — built-in packages that are not installed right now.
  if (method === 'GET' && path === '/agents/available') {
    try {
      sendJson(res, 200, { ok: true, items: listBuiltinAvailable() })
    } catch (error) {
      sendError(res, 500, 'internal_error', errorMessage(error))
    }
    return
  }

  // GET /skills — what the panel shows, independent of the DSH catalog.
  if (method === 'GET' && path === '/skills') {
    const items = listSkills()
    sendJson(res, 200, { ok: true, items, synced: skillRegistrations.size })
    return
  }

  // POST /skills/sync — re-register after an external package change.
  if (method === 'POST' && path === '/skills/sync') {
    try {
      const result = syncSkills()
      sendJson(res, 200, { ok: true, ...result, items: listSkills() })
    } catch (error) {
      sendError(res, 500, 'sync_failed', errorMessage(error))
    }
    return
  }

  // POST /agents/install — { path } or { id } (built-in id).
  if (method === 'POST' && path === '/agents/install') {
    try {
      const body = await readJsonBody(req)
      const result =
        typeof body.id === 'string' && body.id
          ? reinstallBuiltin(body.id)
          : installAgentFromDir(body.path, { overwrite: body.overwrite === true, source: 'local' })
      // The new package brings SKILL.md files with it; the catalog must follow.
      const skillsSync = syncSkills()
      sendJson(res, 200, { ok: true, ...result, agents: listAgents(), skills: skillsSync })
    } catch (error) {
      sendError(res, 400, 'install_failed', errorMessage(error))
    }
    return
  }

  // POST /agents/:id/uninstall
  const uninstallMatch = path.match(/^\/agents\/([A-Za-z0-9._-]+)\/uninstall$/)
  if (uninstallMatch && method === 'POST') {
    try {
      const result = uninstallAgent(uninstallMatch[1])
      // Disposing before the catalog re-read is what actually removes the entry.
      const skillsSync = syncSkills()
      sendJson(res, 200, { ok: true, ...result, agents: listAgents(), skills: skillsSync })
    } catch (error) {
      sendError(res, 400, 'uninstall_failed', errorMessage(error))
    }
    return
  }

  // GET|PUT /agents/:id/config — provider/model routing + subprocess environment.
  const configMatch = path.match(/^\/agents\/([A-Za-z0-9._-]+)\/config$/)
  if (configMatch) {
    const id = configMatch[1]
    const dir = join(AGENTS_DIR, id)
    if (!existsSync(join(dir, 'manifest.json'))) {
      sendError(res, 404, 'not_found', `unknown agent: ${id}`)
      return
    }
    if (method === 'GET') {
      sendJson(res, 200, { ok: true, config: readAgentConfig(id), skills: agentSkillBindings(id) })
      return
    }
    if (method === 'PUT') {
      try {
        const body = await readJsonBody(req)
        const current = readAgentConfig(id)
        const next = {
          provider: typeof body.provider === 'string' ? body.provider : current.provider,
          model: typeof body.model === 'string' ? body.model : current.model,
          // Empty string is a legitimate value here: it clears the binding and
          // lets the single-skill rule take over again.
          skill: typeof body.skill === 'string' ? body.skill : current.skill,
          env: body.env && typeof body.env === 'object' && !Array.isArray(body.env) ? body.env : current.env,
          defaults: body.defaults && typeof body.defaults === 'object' && !Array.isArray(body.defaults) ? body.defaults : current.defaults,
        }
        // Route the write through the reader so validation lives in one place.
        writeAgentConfig(id, next)
        sendJson(res, 200, { ok: true, config: readAgentConfig(id), skills: agentSkillBindings(id) })
      } catch (error) {
        sendError(res, 400, 'bad_request', errorMessage(error))
      }
      return
    }
  }

  // GET /director/models — which director routes this Host can actually reach.
  if (method === 'GET' && path === '/director/models') {
    const llm = ctxRef?.get ? ctxRef.get('llm') : null
    let available = []
    let providers = []
    let error = null
    if (!llm) {
      error = 'the llm service is unavailable in this Host runtime'
    } else {
      try {
        providers = llm.listProviders().map((item) => item.id)
        const reachable = new Set(providers)
        available = LLM_ROUTES.filter((route) => reachable.has(route.provider)).map((route) => ({
          provider: route.provider,
          model: route.model,
          label: route.label,
        }))
      } catch (e) {
        error = errorMessage(e)
      }
    }
    sendJson(res, 200, { ok: true, available, providers, error })
    return
  }

  // POST /director — one sentence in, a renderable project out.
  if (method === 'POST' && path === '/director') {
    try {
      const body = await readJsonBody(req)
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
      if (!prompt) {
        sendError(res, 400, 'bad_request', 'prompt is required')
        return
      }
      const mode = body.mode === 'random' ? 'random' : 'template'
      const agents = listAgents()
      if (agents.length === 0) {
        sendError(res, 409, 'no_agents', 'install an agent before asking for a one-click video')
        return
      }
      const templates = listTemplates(agents)
      if (templates.length === 0) {
        sendError(res, 409, 'no_templates', 'the installed agents ship no templates')
        return
      }

      const llm = ctxRef?.get ? ctxRef.get('llm') : null
      let source = 'local'
      let directorError = null
      let attempts = []
      let rawPlan = null

      if (llm) {
        const system = 'You are a precise film director for a code-rendered video studio. You answer with JSON only.'
        const userText = directorPrompt(prompt, agents, templates, mode)
        const result = await callLlmWithFallback(llm, system, userText)
        attempts = result.attempts
        if (result.ok) {
          rawPlan = extractJsonObject(result.text)
          if (rawPlan) source = 'llm'
          else directorError = 'the director replied without a JSON object'
        } else {
          directorError = result.error ?? 'the director call failed'
        }
      } else {
        directorError = 'the llm service is unavailable in this Host runtime'
      }

      const { plan, rejected, template, agent } = sanitizeDirectorPlan(rawPlan, agents, templates, mode, prompt)

      // The agent runs its bound skill without being asked. Recording it on the
      // project is what makes the pick auditable later ("why did this render
      // with the reel pipeline?") and lets the panel show it without guessing.
      const bound = defaultSkillFor(agent.id)
      const skillAt = bound ? bound.at : ''

      const id = `p_${randomUUID().replace(/-/g, '').slice(0, 14)}`
      const record = {
        id,
        title: plan.title || template.title || 'Untitled',
        templateId: template.id,
        agentId: agent.id,
        brief: plan.brief || template.brief || prompt,
        params: plan.params,
        status: 'draft',
        storyboard: null,
        outputs: { stills: [], video: null, audio: null },
        jobId: null,
        origin: { kind: 'director', prompt, mode, source, attempts, rejected, skill: skillAt || null },
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      writeProject(record)
      const storyboard = await planProject(record)
      sendJson(res, 200, {
        ok: true,
        project: record,
        storyboard,
        director: {
          source,
          error: directorError,
          attempts,
          rejected,
          mode,
          skill: bound ? { at: bound.at, name: bound.name, description: bound.description } : null,
        },
      })
    } catch (error) {
      sendError(res, 400, 'bad_request', errorMessage(error))
    }
    return
  }

  // GET /templates
  if (method === 'GET' && path === '/templates') {
    const agents = listAgents()
    const track = url.searchParams.get('track')
    const agentId = url.searchParams.get('agentId')
    const q = String(url.searchParams.get('q') ?? '').toLowerCase()
    let items = listTemplates(agents)
    if (track) items = items.filter((tpl) => String(tpl.track ?? '') === track)
    if (agentId) items = items.filter((tpl) => tpl.agentId === agentId)
    if (q) {
      items = items.filter((tpl) =>
        `${tpl.title ?? ''} ${tpl.brief ?? ''}`.toLowerCase().includes(q),
      )
    }
    sendJson(res, 200, { ok: true, items })
    return
  }

  // GET /projects
  if (method === 'GET' && path === '/projects') {
    sendJson(res, 200, { ok: true, items: listProjects() })
    return
  }

  // POST /projects
  if (method === 'POST' && path === '/projects') {
    try {
      const body = await readJsonBody(req)
      const agents = listAgents()
      const templates = listTemplates(agents)
      const template = templates.find((tpl) => tpl.id === body.templateId)
      if (!template) {
        sendError(res, 404, 'not_found', `unknown template: ${body.templateId}`)
        return
      }
      const id = `p_${randomUUID().replace(/-/g, '').slice(0, 14)}`
      const bound = defaultSkillFor(template.agentId)
      const record = {
        id,
        title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : template.title ?? 'Untitled',
        templateId: template.id,
        agentId: template.agentId,
        brief: typeof body.brief === 'string' ? body.brief : template.brief ?? '',
        params: { ...templateDefaults(template), ...(body.overrides ?? {}) },
        status: 'draft',
        storyboard: null,
        outputs: { stills: [], video: null, audio: null },
        jobId: null,
        origin: { kind: 'manual', skill: bound ? bound.at : null },
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      writeProject(record)
      sendJson(res, 200, { ok: true, project: record, skill: bound ? { at: bound.at, name: bound.name } : null })
    } catch (error) {
      sendError(res, 400, 'bad_request', errorMessage(error))
    }
    return
  }

  // /projects/:id
  const projectMatch = path.match(/^\/projects\/([A-Za-z0-9_-]+)$/)
  if (projectMatch) {
    const id = projectMatch[1]
    const record = readProject(id)
    if (!record) {
      sendError(res, 404, 'not_found', `unknown project: ${id}`)
      return
    }
    if (method === 'GET') {
      sendJson(res, 200, { ok: true, project: record })
      return
    }
    if (method === 'PATCH') {
      try {
        const body = await readJsonBody(req)
        const next = {
          ...record,
          ...body,
          id: record.id,
          params: { ...record.params, ...(body.params ?? {}) },
        }
        writeProject(next)
        sendJson(res, 200, { ok: true, project: next })
      } catch (error) {
        sendError(res, 400, 'bad_request', errorMessage(error))
      }
      return
    }
    if (method === 'DELETE') {
      const { dir } = projectPaths(id)
      try {
        const { rmSync } = await import('node:fs')
        rmSync(dir, { recursive: true, force: true })
        sendJson(res, 200, { ok: true })
      } catch (error) {
        sendError(res, 500, 'internal_error', errorMessage(error))
      }
      return
    }
  }

  // GET /projects/:id/storyboard — the shot table, planned by the same pure
  // function the renderer uses.
  const sbMatch = path.match(/^\/projects\/([A-Za-z0-9_-]+)\/storyboard$/)
  if (sbMatch && method === 'GET') {
    const record = readProject(sbMatch[1])
    if (!record) {
      sendError(res, 404, 'not_found', `unknown project: ${sbMatch[1]}`)
      return
    }
    try {
      const storyboard = await planProject(record)
      sendJson(res, 200, { ok: true, storyboard })
    } catch (error) {
      sendError(res, 500, 'internal_error', errorMessage(error))
    }
    return
  }

  // POST /still — render exactly one frame and hand back a media URL.
  if (method === 'POST' && path === '/still') {
    try {
      const body = await readJsonBody(req)
      const record = readProject(String(body.projectId ?? ''))
      if (!record) {
        sendError(res, 404, 'not_found', `unknown project: ${body.projectId}`)
        return
      }
      if (!existsSync(RENDER_CLI)) {
        sendError(res, 503, 'render_unavailable', 'the render engine is not installed for this copy of AiBench')
        return
      }
      if (body.params && typeof body.params === 'object') {
        record.params = { ...record.params, ...body.params }
        writeProject(record)
      }
      const storyboard = await planProject(record)
      const comp = aspectOf(record)
      const frame = Math.trunc(clampNumber(body.frame, 0, Math.max(0, storyboard.totalFrames - 1), 0))
      const { dir } = projectPaths(record.id)
      const outputs = join(dir, 'outputs')
      mkdirSync(outputs, { recursive: true })
      const fileName = `still-${frame}-${Date.now().toString(36)}.png`
      const outFile = join(outputs, fileName)
      const propsFile = writePropsFile(record, 'still')

      const job = newJob('still', record.id, { frame, width: comp.width, height: comp.height })
      const result = await runRemotion(
        [
          'still',
          comp.id,
          outFile.replace(/\\/g, '/'),
          `--frame=${frame}`,
          `--props=${propsFile}`,
          '--overwrite',
          '--log=error',
        ],
        STILL_TIMEOUT_MS,
        job,
        agentEnvFor(record),
      )

      if (!result.ok || !existsSync(outFile)) {
        job.status = 'failed'
        job.error = (result.err || result.out || 'still render failed').slice(-1200)
        job.finishedAt = nowIso()
        sendError(res, 500, 'render_failed', 'still render failed', job.error)
        return
      }

      job.status = 'done'
      job.progress = 100
      job.output = `/aibench-api/media/${record.id}/${fileName}`
      job.finishedAt = nowIso()

      const next = {
        ...record,
        status: 'storyboard',
        storyboard,
        outputs: {
          ...(record.outputs ?? { stills: [], video: null, audio: null }),
          stills: [
            ...((record.outputs?.stills ?? []).slice(-19)),
            { frame, url: job.output, at: job.finishedAt },
          ],
        },
      }
      writeProject(next)
      sendJson(res, 200, {
        ok: true,
        image: job.output,
        frame,
        width: comp.width,
        height: comp.height,
        jobId: job.id,
        storyboard,
      })
    } catch (error) {
      sendError(res, 400, 'bad_request', errorMessage(error))
    }
    return
  }

  // POST /projects/:id/render — queue an mp4 render, return the job immediately.
  const renderMatch = path.match(/^\/projects\/([A-Za-z0-9_-]+)\/render$/)
  if (renderMatch && method === 'POST') {
    const record = readProject(renderMatch[1])
    if (!record) {
      sendError(res, 404, 'not_found', `unknown project: ${renderMatch[1]}`)
      return
    }
    if (!existsSync(RENDER_CLI)) {
      sendError(res, 503, 'render_unavailable', 'the render engine is not installed for this copy of AiBench')
      return
    }
    try {
      const body = await readJsonBody(req).catch(() => ({}))
      if (body?.params && typeof body.params === 'object') {
        record.params = { ...record.params, ...body.params }
        writeProject(record)
      }
      const storyboard = await planProject(record)
      const comp = aspectOf(record)
      const quality = body?.quality === 'final' ? 'final' : 'preview'
      const { dir } = projectPaths(record.id)
      const outputs = join(dir, 'outputs')
      mkdirSync(outputs, { recursive: true })
      const fileName = `clip-${quality}-${Date.now().toString(36)}.mp4`
      const outFile = join(outputs, fileName)
      const propsFile = writePropsFile(record, 'render')

      const job = newJob('render', record.id, { width: comp.width, height: comp.height })
      const args = [
        'render',
        comp.id,
        outFile.replace(/\\/g, '/'),
        `--props=${propsFile}`,
        '--overwrite',
        '--log=error',
        '--concurrency=4',
      ]
      if (quality === 'preview') args.push('--scale=0.5')

      // Fire and forget: the client polls /jobs/:id.
      void (async () => {
        const result = await runRemotion(args, RENDER_TIMEOUT_MS, job, agentEnvFor(record))
        job.finishedAt = nowIso()
        if (!result.ok || !existsSync(outFile)) {
          job.status = 'failed'
          job.error = (result.err || result.out || 'render failed').slice(-1200)
          const failed = { ...readProject(record.id), status: 'failed' }
          if (failed.id) writeProject(failed)
          return
        }
        job.status = 'done'
        job.progress = 100
        job.output = `/aibench-api/media/${record.id}/${fileName}`
        const latest = readProject(record.id) ?? record
        writeProject({
          ...latest,
          status: 'done',
          storyboard,
          outputs: {
            ...(latest.outputs ?? { stills: [], video: null, audio: null }),
            video: { url: job.output, quality, at: job.finishedAt },
          },
          jobId: job.id,
        })
      })()

      const pending = { ...record, status: 'rendering', jobId: job.id, storyboard }
      writeProject(pending)
      sendJson(res, 200, { ok: true, jobId: job.id, job: publicJob(job), storyboard })
    } catch (error) {
      sendError(res, 400, 'bad_request', errorMessage(error))
    }
    return
  }

  // GET /jobs — the Task page lists every render job, newest first.
  if (method === 'GET' && path === '/jobs') {
    sendJson(res, 200, { ok: true, items: listJobs() })
    return
  }

  // GET /jobs/:id
  const jobMatch = path.match(/^\/jobs\/([A-Za-z0-9_-]+)$/)
  if (jobMatch && method === 'GET') {
    const job = jobs.get(jobMatch[1])
    if (!job) {
      sendError(res, 404, 'not_found', `unknown job: ${jobMatch[1]}`)
      return
    }
    sendJson(res, 200, { ok: true, job: publicJob(job) })
    return
  }

  // GET /media/:projectId/:file
  const mediaMatch = path.match(/^\/media\/([A-Za-z0-9_-]+)\/([A-Za-z0-9._-]+)$/)
  if (mediaMatch && method === 'GET') {
    const [, projectId, fileName] = mediaMatch
    if (fileName.includes('..')) {
      sendError(res, 400, 'bad_request', 'invalid media path')
      return
    }
    const file = join(PROJECTS_DIR, projectId, 'outputs', fileName)
    if (!existsSync(file)) {
      sendError(res, 404, 'not_found', `unknown media: ${fileName}`)
      return
    }
    try {
      const data = readFileSync(file)
      res.statusCode = 200
      res.setHeader('content-type', contentTypeOf(fileName))
      res.setHeader('content-length', String(data.length))
      res.setHeader('cache-control', 'no-store')
      res.end(data)
    } catch (error) {
      sendError(res, 500, 'internal_error', errorMessage(error))
    }
    return
  }

  sendError(res, 404, 'not_found', `no route for ${method} ${path}`)
}

function contentTypeOf(fileName) {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

/** @type {Record<string, unknown>} */
let runtime = null

export function apply(ctx) {
  ensureDataDirs()

  // `handle()` needs `ctx.get('llm')` for the one-click director. The route table
  // is module-level, so the context is parked here and released with the route.
  ctxRef = ctx

  // Seed the three built-in agents on first activation so the panel's card wall
  // is never empty on a fresh install.
  try {
    seedBuiltinAgents()
  } catch (error) {
    console.error(`[aibench] built-in agent seeding failed: ${errorMessage(error)}`)
  }

  runtime = {
    startedAt: nowIso(),
    dataDir: DATA_DIR,
    render: renderStatus(),
  }

  // Register the installed agents' SKILL.md files so they are reachable from the
  // composer as `@<skill-name>`. Optional service: absence is not an error.
  ctx.inject(['skills'], (skillScope) => {
    const skills = skillScope?.skills ?? (typeof ctx.get === 'function' ? ctx.get('skills') : null)
    if (!skills) return
    try {
      syncSkills()
      ctx.effect(() => () => releaseSkills(), 'aibench: release skills')
    } catch (error) {
      console.error(`[aibench] skill bridge failed: ${errorMessage(error)}`)
    }
  })

  ctx.inject(['webServer'], (scope) => {
    const server = scope?.webServer ?? ctx.webServer
    if (!server || typeof server.register !== 'function') {
      console.error('[aibench] webServer is unavailable; the panel will not be reachable')
      return
    }
    const entry = {
      name: 'aibench-api',
      kind: 'prefix',
      path: BASE_PATH,
      handler: async (req, res) => {
        try {
          await handle(req, res)
        } catch (error) {
          console.error('[aibench] route failed:', error)
          sendError(res, 500, 'internal_error', errorMessage(error))
        }
      },
    }
    try {
      // The disposer must belong to this activation: re-enabling the bundle calls
      // apply() again while the previous route is still registered, and
      // webServer.register throws on a duplicate (kind, path).
      ctx.effect(() => server.register(entry))
      console.log(`[aibench] route ${BASE_PATH} registered (v${VERSION})`)
    } catch (error) {
      console.error(`[aibench] route ${BASE_PATH} not registered: ${errorMessage(error)}`)
    }
  })

  ctx.effect(() => () => {
    ctxRef = null
    releaseSkills()
  }, 'aibench: release activation context')
}

export function getRuntime() {
  return runtime
}

/**
 * Render-engine status without needing an active Host.
 *
 * `getRuntime()` only fills in after `apply()` runs. Install-time checks and
 * diagnostics need the same answer before activation, so this is exported
 * separately rather than reached through the runtime record.
 */
export function getRenderStatus() {
  return renderStatus()
}

export default { apply }
