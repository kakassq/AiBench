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

/**
 * Data root. `AIBENCH_DATA_DIR` exists so the regression gates can run against a
 * throwaway directory: several of them import this module and then create real
 * projects, which used to land in the user's own project list and stay there.
 * Production never sets it.
 */
function resolveDataDir() {
  const override = process.env.AIBENCH_DATA_DIR
  if (override && override.trim()) return override.trim()
  return join(PROFILE_DIR, 'aibench')
}

const DATA_DIR = resolveDataDir()
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
function copyDirSync(src, dst, skip) {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (skip && skip.has(entry.name)) continue
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
export function seedBuiltinAgents() {
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
export function installAgentFromDir(sourceDir, options = {}) {
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
  // `draft.json` is Forge's own bookkeeping, not part of the package: an agent
  // installed from a draft must not carry the draft record into AGENTS_DIR.
  copyDirSync(src, target, new Set(['draft.json']))

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
export function uninstallAgent(id) {
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

export function listBuiltinAvailable() {
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
// Mirrors `MIN_DURATION_SEC` / `MAX_DURATION_SEC` in storyboard.ts. The planner
// clamps too, but a value outside this range would be silently rewritten there,
// so the Host refuses it up front and the panel can show the real bound.
const MIN_DURATION_SEC = 10
const MAX_DURATION_SEC = 300

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
      en: shot.en ?? null,
      steps: shot.steps ?? null,
    })),
  }
}

async function planProject(record) {
  const sb = await loadStoryboard()
  const params = normalizeParams(record.params, record.aspect)
  // A project with a script is laid out from its shots; one without keeps the
  // archetype plan. Both go through the same boundary maths in storyboard.ts.
  const planned = record.script && Array.isArray(record.script.shots) && record.script.shots.length > 0
    ? sb.planScriptedStoryboard(record.brief ?? '', params, record.script)
    : sb.planStoryboard(record.brief ?? '', params)
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
  // The composition resolves the script itself so the CLI's `calculateMetadata`
  // and the rendered frames agree on the length. Sending a pre-planned
  // storyboard instead would let the two drift apart.
  if (project.script && Array.isArray(project.script.shots) && project.script.shots.length > 0) {
    props.script = project.script
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
async function callLlmOnce(llm, route, system, userText, signal, maxTokens = 900) {
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
      maxTokens,
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
async function callLlmWithFallback(llm, system, userText, maxTokens = 900) {
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
    const result = await callLlmOnce(llm, route, system, userText, signal, maxTokens)
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
// Script layer — the words, as opposed to the timing
// ---------------------------------------------------------------------------
//
// The template archetypes are a floor, not a script: every explainer says "一件事，
// 拆成三步讲" no matter what the video is about. That is fine for proving the
// renderer works and useless for publishing. A script supplies the words; every
// timing rule (beat snapping, weight distribution, minimum shot length, caption
// derivation) stays in `storyboard.ts`, so an authored video is laid out exactly
// like a planned one.
//
// Two rules keep a model-authored script from becoming garbage:
//  1. Structure is validated, not trusted. Shot kinds, shot count, empty copy,
//     duplicate steps — anything that would render as a blank or broken frame is
//     dropped here, before it reaches the timeline.
//  2. No model, no problem. When the LLM is unavailable the script is built from
//     the user's own sentence, so the button still produces something filmable.

/** How many shots a script may have. Mirrors `MAX_SCRIPT_SHOTS` in storyboard.ts. */
const MAX_SCRIPT_SHOTS = 8

/** A shot copy longer than this cannot be set as a headline at any size. */
const MAX_SHOT_COPY = 34

const SCRIPT_KINDS = ['hook', 'process', 'cta']

function scriptPrompt(userPrompt, template, agent) {
  const bound = resolveDefaultSkill(agent.id, collectAgentSkills())
  return [
    'You are a scriptwriter for a code-rendered typographic video. No footage, no photos, no voice-over: every word appears as type on screen.',
    '',
    'Reply with JSON only. No prose, no code fence.',
    '',
    'Shape:',
    '{"title":"<video title, <= 18 chars>","shots":[{"kind":"hook"|"process"|"cta","copy":"<the big on-screen line>","caption":"<the spoken line, may differ from copy>","en":"<short English gloss, optional>","steps":[{"zh":"<item>","en":"<item>"}],"weight":<1-6>}]}',
    '',
    'Rules:',
    `- 3 to ${MAX_SCRIPT_SHOTS} shots. The first must be "hook", the last must be "cta".`,
    '- Exactly one shot of each of hook/process/cta is the minimum; extra shots may repeat any kind.',
    `- "copy" is the headline: <= ${MAX_SHOT_COPY} characters, no trailing period, no quotes. It must be a claim, not a label.`,
    '- "caption" is the narration sentence under it: <= 40 characters, complete, speakable.',
    '- A "process" shot needs 2-4 "steps"; each step is a short verb phrase, not a sentence.',
    '- "weight" is how long the shot holds, 1 (short) to 6 (long). Give the most weight to the shot that carries the payoff.',
    '- Write in the language of the user intent. Do not translate the headline into English; use "en" only for the small gloss.',
    '- Never invent facts, numbers, dates or quotes. If the intent has no facts, write structure and meaning, not statistics.',
    '- No filler: no "让我们开始", no "敬请期待", no "以上就是". Every line must say something.',
    '',
    `Template this will render with: ${template.id} (${template.title ?? ''}) — ${template.brief ?? ''}`,
    bound ? `Its pipeline: ${bound.at} — ${bound.description}` : '',
    '',
    `User intent: ${userPrompt}`,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n')
}

/** Trim, drop quotes, and refuse a headline that cannot be typeset. */
function cleanLine(value, max) {
  if (typeof value !== 'string') return ''
  const text = value
    .replace(/^[\s"'“”「」『』]+|[\s"'“”「」『』]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  return text.length > max ? text.slice(0, max) : text
}

/**
 * Validate a model-authored script against what the renderer can lay out.
 *
 * Returns `{ script, rejected }`. A script is only accepted when it has at least
 * a hook and a cta with real copy — a half-parsed reply is worse than no reply,
 * because it renders a plausible-looking video that says nothing.
 */
export function sanitizeScript(raw, fallbackBrief) {
  const rejected = []
  const input = raw && typeof raw === 'object' ? raw : {}
  const shotsIn = Array.isArray(input.shots) ? input.shots : []
  if (shotsIn.length === 0) return { script: null, rejected: ['shots'] }

  const shots = []
  for (const item of shotsIn.slice(0, MAX_SCRIPT_SHOTS)) {
    if (!item || typeof item !== 'object') {
      rejected.push('shot')
      continue
    }
    const kind = SCRIPT_KINDS.includes(item.kind) ? item.kind : null
    if (!kind) {
      rejected.push('kind')
      continue
    }
    const copy = cleanLine(item.copy, MAX_SHOT_COPY)
    if (!copy) {
      rejected.push('copy')
      continue
    }
    const shot = { kind, copy }
    const caption = cleanLine(item.caption, 60)
    if (caption) shot.caption = caption
    const en = cleanLine(item.en, 48)
    if (en) shot.en = en

    if (kind === 'process') {
      const stepsIn = Array.isArray(item.steps) ? item.steps : []
      const steps = stepsIn
        .map((step) => ({
          zh: cleanLine(step && step.zh, 24),
          en: cleanLine(step && step.en, 32),
        }))
        .filter((step) => step.zh)
        .slice(0, 4)
      if (steps.length < 2) {
        // A process shot with fewer than two steps renders one lonely row under
        // a headline, which reads as a mistake rather than a rhythm.
        rejected.push('steps')
        continue
      }
      shot.steps = steps
    }

    const weight = Number(item.weight)
    if (Number.isFinite(weight) && weight > 0) shot.weight = Math.min(6, Math.max(1, weight))
    shots.push(shot)
  }

  if (shots.length === 0) return { script: null, rejected }

  const kinds = shots.map((shot) => shot.kind)
  if (kinds[0] !== 'hook') {
    rejected.push('firstShot')
    shots.unshift({ kind: 'hook', copy: cleanLine(fallbackBrief, MAX_SHOT_COPY) || '先说结论' })
  }
  if (shots[shots.length - 1].kind !== 'cta') {
    rejected.push('lastShot')
    shots.push({ kind: 'cta', copy: '记住这一句就够了。', weight: 1 })
  }
  if (!kinds.includes('process') && shots.length < 3) {
    rejected.push('process')
  }

  const title = cleanLine(input.title, 24)
  return { script: { title: title || undefined, shots }, rejected }
}

/** The script a render falls back to when no model answers: the user's own words. */
export function localScript(userPrompt, brief) {
  const text = cleanLine(brief || userPrompt, MAX_SHOT_COPY * 2) || '我的下一个作品'
  const head = cleanLine(text, MAX_SHOT_COPY)
  const rest = text.length > MAX_SHOT_COPY ? text.slice(MAX_SHOT_COPY).trim() : ''
  return {
    title: cleanLine(head, 18) || undefined,
    shots: [
      { kind: 'hook', copy: head, caption: text, weight: 3 },
      {
        kind: 'process',
        copy: rest ? cleanLine(rest, MAX_SHOT_COPY) : '把它拆开，一层一层看',
        weight: 4,
        steps: [
          { zh: '先看整体', en: 'See the whole' },
          { zh: '再看结构', en: 'See the parts' },
          { zh: '最后看它为什么成立', en: 'See why it holds' },
        ],
      },
      { kind: 'cta', copy: '看到这里就够了。', weight: 1 },
    ],
  }
}

/**
 * Author a script for a prompt, with the model if there is one.
 *
 * Resolves `{ script, source, rejected, attempts, error }`. `source` is `'llm'`
 * only when the reply survived validation; anything else falls back to the
 * user's sentence so the caller never has to handle "no script".
 */
async function authorScript(llm, userPrompt, brief, template, agent) {
  if (!llm) {
    return { script: localScript(userPrompt, brief), source: 'local', rejected: [], attempts: [], error: 'the llm service is unavailable in this Host runtime' }
  }
  const system = 'You are a scriptwriter for code-rendered typographic video. You answer with JSON only.'
  const userText = scriptPrompt(userPrompt, template, agent)
  // A six-shot script with captions runs past the director's 900-token budget.
  const result = await callLlmWithFallback(llm, system, userText, 1800)
  if (!result.ok) {
    return { script: localScript(userPrompt, brief), source: 'local', rejected: [], attempts: result.attempts, error: result.error ?? 'the script call failed' }
  }
  const parsed = extractJsonObject(result.text)
  if (!parsed) {
    return { script: localScript(userPrompt, brief), source: 'local', rejected: ['json'], attempts: result.attempts, error: 'the scriptwriter replied without a JSON object' }
  }
  const { script, rejected } = sanitizeScript(parsed, brief || userPrompt)
  if (!script) {
    return { script: localScript(userPrompt, brief), source: 'local', rejected, attempts: result.attempts, error: 'the script failed validation' }
  }
  return { script, source: 'llm', rejected, attempts: result.attempts, error: null }
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

// ---------------------------------------------------------------------------
// Forge — build a new agent package from a sentence.
//
// The scaffold is deterministic: the same goal always produces the same valid
// package, with no model involved. That is deliberate. A model that is down,
// rate-limited, or simply wrong must not be able to produce an agent that
// installs and then renders nothing — so the offline path has to be *complete*,
// and the model only rewrites prose (SKILL.md body, template briefs) on top.
//
// `validateDraft()` is the gate: it re-checks everything the runtime depends on,
// including that the planner accepts the template's params. `POST .../install`
// refuses to run unless validation is clean, so a broken draft can never reach
// AGENTS_DIR.
// ---------------------------------------------------------------------------

const FORGE_TRACKS = [
  { id: '1.1', name: '品牌片头', hint: '字标、几何推进、落板' },
  { id: '1.2', name: '社媒短片', hint: '竖版卡点、卖点快剪' },
  { id: '1.3', name: '数据解说', hint: '数字、图表、结论' },
  { id: '1.4', name: '科普解说', hint: '概念、拆解、双语字幕' },
  { id: '1.5', name: '产品演示', hint: '功能三连、界面特写' },
]

/** The shape a draft must satisfy. Returned to the panel so the wizard can show it. */
export function forgeBlueprint() {
  return {
    tracks: FORGE_TRACKS,
    looks: LOOK_IDS,
    palettes: PALETTE_NAMES,
    aspects: ASPECTS,
    subtitles: SUBTITLE_MODES,
    durations: [10, 15, 20, 25, 30, 45, 60],
    bpms: [90, 100, 110, 120, 128, 140],
    files: ['manifest.json', 'skills/<name>/SKILL.md', 'templates/<name>.template.json'],
    constraints: [
      'manifest.id 必须是 kebab-case，且与安装目录同名',
      'manifest.templates 至少要有一个，每个都要有对应文件',
      'template.defaults 必须能通过 normalizeParams，否则渲染会静默回落到默认值',
      'SKILL.md 必须有 name / description frontmatter，name 与目录名一致',
      '同一参数必须渲染出同一帧：不允许 Date.now() / Math.random()',
    ],
  }
}

/** Deterministic draft id: stable for the same goal so re-forging overwrites. */
export function forgeDraftId(goal) {
  return `f_${hashText(goal).toString(16).slice(0, 12)}`
}

export function forgeDraftDir(draftId) {
  return join(FORGE_DIR, draftId)
}

/**
 * Turn a free-text goal into an agent id.
 *
 * CJK has no ASCII fallback, so a pure-Chinese goal slugifies to nothing and we
 * fall back to a hash suffix — an agent id must be addressable in a URL and a
 * directory name, not pretty.
 */
function forgeAgentId(goal, trackId) {
  const ascii = slugify(goal, '')
  if (ascii && ascii.length >= 3) return `agent-${ascii.slice(0, 28)}`
  const prefix = trackId ? `agent-${trackId.replace('.', '-')}` : 'agent'
  return `${prefix}-${hashText(goal).toString(16).slice(0, 6)}`
}

function forgeLookForTrack(trackId) {
  switch (trackId) {
    case '1.1':
      return 'one-line'
    case '1.2':
      return 'halftone-dossier'
    case '1.3':
      return 'blueprint'
    case '1.4':
      return 'swiss-dynamic-type'
    case '1.5':
      return 'terminal-crt'
    default:
      return 'swiss-dynamic-type'
  }
}

function forgeAspectForTrack(trackId) {
  return trackId === '1.2' || trackId === '1.1' ? '9:16' : '16:9'
}

/**
 * Build the package files for a draft. Pure function of its inputs — no clock,
 * no randomness, no model.
 */
export function scaffoldAgentPackage(spec) {
  const {
    goal,
    agentId,
    trackId,
    look,
    palette,
    durationSec,
    beatBpm,
    subtitle,
    aspect,
    name,
  } = spec

  const track = FORGE_TRACKS.find((item) => item.id === trackId) ?? FORGE_TRACKS[0]
  const displayName = name || `AiBench ${track.name}`
  const skillName = `${agentId.replace(/^agent-/, '')}-run`.slice(0, 40)
  const templateId = `${agentId.replace(/^agent-/, '')}.main`

  // The params block must be exactly what normalizeParams accepts, otherwise the
  // template silently falls back to hardcoded defaults and the agent "works" but
  // ignores its own description.
  const params = normalizeParams(
    {
      type: 0,
      style: Math.max(0, LOOK_IDS.indexOf(look)),
      palette: Math.max(0, PALETTE_NAMES.indexOf(palette)),
      flow: 0,
      durationSec,
      beatBpm,
      subtitle,
      aspect,
    },
    aspect,
  )

  const manifest = {
    id: agentId,
    name: displayName,
    version: '0.1.0',
    description: `${track.name}：${goal}`.slice(0, 120),
    tracks: [track.id],
    license: 'MIT',
    builtin: false,
    engines: { aibench: '>=0.1.0', node: '>=22.19' },
    capabilities: {
      render: true,
      voice: false,
      subtitles: subtitle !== 'none',
      bilingual: subtitle === 'bilingual',
    },
    defaults: params,
    skills: [{ id: skillName, name: skillName, file: `skills/${skillName}/SKILL.md` }],
    templates: [
      {
        id: templateId,
        file: `templates/main.template.json`,
        title: goal.slice(0, 40) || track.name,
        track: track.id,
      },
    ],
    runtime: { shared: ['remotion@4', 'react@19'], requires: [] },
  }

  const template = {
    id: templateId,
    title: (goal.slice(0, 40) || track.name).trim(),
    track: track.id,
    brief: goal,
    durationSec: params.durationSec,
    aspect: params.aspect,
    style: {
      look,
      palette,
      tokens: [look],
      motion: 'cut-on-beat',
      rhythm: params.beatBpm,
      font: look === 'terminal-crt' || look === 'blueprint' ? 'mono' : 'inter',
    },
    audio: {
      bgm: { bpm: params.beatBpm, mood: 'neutral' },
      sfxSet: ['tick', 'reveal'],
      voice: { mode: 'none', lang: 'zh' },
      subtitles: { kind: params.subtitle },
    },
    beatMap: {
      rule: '每个切点卡在整拍上',
      notes: [`BPM ${params.beatBpm}`, `总长 ${params.durationSec} 秒`],
    },
    defaults: params,
  }

  const skill = `---
name: ${skillName}
description: ${track.name}流水线：${track.hint}。目标 —— ${goal.slice(0, 60)}
---

# ${displayName} · ${track.name}流水线

${goal}

## 你只能用这套动效语言

look = \`${look}\`，palette = \`${palette}\`，画幅 ${params.aspect}，${params.durationSec} 秒，BPM ${params.beatBpm}，字幕 ${params.subtitle}。

## 流水线

1. **定钩子**：前 2 秒必须出现一个能记住的东西 —— 一个字标、一个数字，或一句短话。
2. **拆结构**：把目标拆成 2–4 个信息块，每块一个视觉动作，不要塞第二个论点。
3. **卡点**：切点一律落在整拍上。BPM ${params.beatBpm} 时 1 拍 = ${Math.round((60 / params.beatBpm) * 30)} 帧。
4. **字幕**：硬字幕，单行尽量短；竖版比横版严格得多。
5. **落版**：最后一格只放主题 + 一句副标题，不要塞第三个信息。
6. **校验**：先出 still 看安全区，再出 mp4 听卡点。

## 硬约束（违反即视为失败）

- 30 fps，所有分镜帧数之和必须等于 \`totalFrames\`。
- 每镜至少 12 帧，且相邻镜首尾相接。
- 只用 \`bg\` / \`fg\` / \`accent\` 三色。
- 禁止 \`Date.now()\` / \`Math.random()\`；随机一律来自 \`seed = hashText(brief)\`。
- 结尾必须有落版帧，不能直接黑场结束。

## 输出契约

\`\`\`jsonc
{
  "brief": "${goal.slice(0, 50).replace(/"/g, "'")}",
  "params": ${JSON.stringify(params)}
}
\`\`\`
`

  return {
    manifest,
    template,
    skill,
    paths: {
      manifest: 'manifest.json',
      template: 'templates/main.template.json',
      skill: `skills/${skillName}/SKILL.md`,
    },
  }
}

export function writeDraftFiles(draftId, files) {
  const dir = forgeDraftDir(draftId)
  mkdirSync(dir, { recursive: true })
  for (const [relPath, content] of Object.entries(files)) {
    const target = join(dir, relPath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
  return dir
}

/** Read every package file in a draft, as posix relative paths. Used by the panel preview. */
function readDraftFiles(draftId) {
  const dir = forgeDraftDir(draftId)
  if (!existsSync(dir)) return null
  const out = []
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      // `draft.json` is the draft's own record (exposed as `meta`), not a file the
      // agent package contains, so it must not be previewed as one.
      if (!prefix && entry.name === 'draft.json') continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full, rel)
      else if (entry.isFile()) out.push({ path: rel, content: readFileSync(full, 'utf8') })
    }
  }
  walk(dir, '')
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

/**
 * Check a draft the way the runtime will use it.
 *
 * Every assertion here maps to a failure that would otherwise be silent: a
 * template whose defaults miss `normalizeParams` still renders, just not what the
 * template says. `renderFrame` is off by default because it spawns Remotion.
 */
export async function validateDraft(draftId, options = {}) {
  const dir = forgeDraftDir(draftId)
  const errors = []
  const warnings = []
  const facts = {}

  if (!existsSync(dir)) {
    return { ok: false, errors: [`draft not found: ${draftId}`], warnings, facts }
  }

  // --- manifest -----------------------------------------------------------
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    errors.push('manifest.json is missing')
    return { ok: false, errors, warnings, facts }
  }
  let manifest = null
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (e) {
    errors.push(`manifest.json is not valid JSON: ${errorMessage(e)}`)
    return { ok: false, errors, warnings, facts }
  }

  if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) {
    errors.push('manifest.id must be kebab-case (a-z, 0-9, dash)')
  }
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) errors.push('manifest.name is required')
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push('manifest.version must look like 1.0.0')
  }
  if (typeof manifest.description !== 'string' || !manifest.description.trim()) {
    errors.push('manifest.description is required')
  }
  if (!Array.isArray(manifest.tracks) || manifest.tracks.length === 0) {
    errors.push('manifest.tracks must list at least one track')
  } else {
    for (const track of manifest.tracks) {
      if (!FORGE_TRACKS.some((item) => item.id === track)) {
        warnings.push(`unknown track "${track}" — the panel filters on known tracks`)
      }
    }
  }

  // `defaults` feeds the renderer directly, so it must survive normalizeParams
  // without losing the values the manifest claims.
  const normalizedDefaults = normalizeParams(manifest.defaults ?? {}, manifest.defaults?.aspect)
  if (!Number.isFinite(normalizedDefaults.durationSec)) errors.push('manifest.defaults.durationSec is not a number')
  facts.defaults = normalizedDefaults

  // --- templates ----------------------------------------------------------
  const templates = Array.isArray(manifest.templates) ? manifest.templates : []
  if (templates.length === 0) errors.push('manifest.templates must list at least one template')
  facts.templates = []
  for (const entry of templates) {
    const rel = typeof entry === 'string' ? entry : entry?.file
    const id = typeof entry === 'string' ? entry : entry?.id
    if (!rel) {
      errors.push(`template entry ${JSON.stringify(entry)} has no file`)
      continue
    }
    const file = join(dir, rel)
    if (!existsSync(file)) {
      errors.push(`template file is missing: ${rel}`)
      continue
    }
    let template = null
    try {
      template = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      errors.push(`template ${rel} is not valid JSON: ${errorMessage(e)}`)
      continue
    }
    if (typeof template.id !== 'string' || !template.id) errors.push(`template ${rel} has no id`)
    if (typeof template.brief !== 'string' || !template.brief.trim()) {
      errors.push(`template ${rel} has no brief`)
    }
    if (id && template.id && id !== template.id) {
      warnings.push(`manifest lists template "${id}" but the file declares "${template.id}"`)
    }
    const params = templateDefaults(template)
    const normalized = normalizeParams(params, template.aspect ?? params.aspect)
    // A template that loses its look on the way to numbers renders as the default
    // look — visually wrong, but with no error anywhere. Catch it here.
    const claimedStyle = template.style?.look ?? template.style?.tokens?.[0]
    if (claimedStyle && !LOOK_IDS.includes(claimedStyle)) {
      errors.push(`template ${rel} names unknown look "${claimedStyle}"`)
    }
    const claimedPalette = template.style?.palette
    if (claimedPalette && !PALETTE_NAMES.includes(claimedPalette)) {
      errors.push(`template ${rel} names unknown palette "${claimedPalette}"`)
    }
    facts.templates.push({ id: template.id ?? id, file: rel, params: normalized })
  }

  // --- skills -------------------------------------------------------------
  const skills = Array.isArray(manifest.skills) ? manifest.skills : []
  if (skills.length === 0) warnings.push('manifest.skills is empty — this agent will have no pipeline to call')
  facts.skills = []
  for (const entry of skills) {
    const rel = typeof entry === 'string' ? entry : entry?.file
    const declaredName = typeof entry === 'string' ? null : entry?.name
    if (!rel) {
      errors.push(`skill entry ${JSON.stringify(entry)} has no file`)
      continue
    }
    const file = join(dir, rel)
    if (!existsSync(file)) {
      errors.push(`skill file is missing: ${rel}`)
      continue
    }
    const parsed = parseSkillFrontmatter(readFileSync(file, 'utf8'))
    if (!parsed.meta.name) errors.push(`skill ${rel} has no frontmatter name`)
    else if (!/^[a-z0-9][a-z0-9-]*$/.test(parsed.meta.name)) {
      errors.push(`skill ${rel} name "${parsed.meta.name}" must be kebab-case`)
    }
    if (declaredName && parsed.meta.name && declaredName !== parsed.meta.name) {
      errors.push(`skill ${rel} declares name "${parsed.meta.name}" but manifest says "${declaredName}"`)
    }
    if (!parsed.meta.description) errors.push(`skill ${rel} has no frontmatter description`)
    if (!parsed.body.trim()) errors.push(`skill ${rel} body is empty`)
    facts.skills.push({ name: parsed.meta.name, file: rel, chars: parsed.body.length })
  }

  // --- optional: prove a frame renders -----------------------------------
  if (options.renderFrame && errors.length === 0) {
    try {
      const sb = await loadStoryboard()
      const first = facts.templates[0]
      const storyboard = trimStoryboard(sb.planStoryboard(manifest.defaults?.brief ?? '', first.params))
      if (storyboard.totalFrames <= 0) errors.push('planner produced zero frames')
      else facts.frames = storyboard.totalFrames
    } catch (e) {
      errors.push(`planner rejected the template params: ${errorMessage(e)}`)
    }
  }

  return { ok: errors.length === 0, errors, warnings, facts }
}

export function readForgeDraft(draftId) {
  const dir = forgeDraftDir(draftId)
  if (!existsSync(dir)) return null
  const meta = readJsonFile(join(dir, 'draft.json'), null)
  const files = readDraftFiles(draftId) ?? []
  return { id: draftId, dir, meta, files }
}

export function listForgeDrafts() {
  if (!existsSync(FORGE_DIR)) return []
  const out = []
  for (const entry of readdirSync(FORGE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const meta = readJsonFile(join(FORGE_DIR, entry.name, 'draft.json'), null)
    if (!meta) continue
    out.push({ id: entry.name, ...meta })
  }
  out.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
  return out
}

function routePath(url) {  const raw = String(url ?? '/')
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
        forge: true,
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

      // A template supplies timing and look; the script supplies the words.
      // Authoring is a second model call because asking one call to pick a
      // template *and* write a six-shot script reliably truncates the script.
      const authored = await authorScript(llm, prompt, plan.brief, template, agent)

      const id = `p_${randomUUID().replace(/-/g, '').slice(0, 14)}`
      const record = {
        id,
        title: authored.script?.title || plan.title || template.title || 'Untitled',
        templateId: template.id,
        agentId: agent.id,
        brief: plan.brief || template.brief || prompt,
        params: plan.params,
        script: authored.script,
        status: 'draft',
        storyboard: null,
        outputs: { stills: [], video: null, audio: null },
        jobId: null,
        origin: {
          kind: 'director',
          prompt,
          mode,
          source,
          attempts,
          rejected,
          skill: skillAt || null,
          script: { source: authored.source, error: authored.error, rejected: authored.rejected, attempts: authored.attempts },
        },
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
          script: {
            source: authored.source,
            error: authored.error,
            rejected: authored.rejected,
            shots: record.script ? record.script.shots.length : 0,
          },
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

  // POST /projects/:id/script — rewrite the words of an existing project.
  //
  // Separate from `/director` because the two failures are different: a bad
  // template pick means the video is in the wrong shape, a bad script means the
  // shape is right and the words are wrong. Re-authoring keeps the template,
  // params and look, so the user only pays for the part that was wrong.
  const scriptMatch = path.match(/^\/projects\/([A-Za-z0-9_-]+)\/script$/)
  if (scriptMatch && method === 'POST') {
    const record = readProject(scriptMatch[1])
    if (!record) {
      sendError(res, 404, 'not_found', `unknown project: ${scriptMatch[1]}`)
      return
    }
    try {
      const body = await readJsonBody(req)
      const agents = listAgents()
      const templates = listTemplates(agents)
      const template = templates.find((tpl) => tpl.id === record.templateId) || templates[0]
      const agent = agents.find((item) => item.id === record.agentId) || agents[0]
      if (!template || !agent) {
        sendError(res, 409, 'no_templates', 'the agent or template for this project is no longer installed')
        return
      }
      // `prompt` defaults to the original intent: "write it again, same brief"
      // is the common case, and it is what the retry button sends.
      const prompt = typeof body.prompt === 'string' && body.prompt.trim()
        ? body.prompt.trim()
        : (record.origin && record.origin.prompt) || record.brief || record.title
      const llm = ctxRef?.get ? ctxRef.get('llm') : null
      const authored = await authorScript(llm, prompt, record.brief, template, agent)
      const next = {
        ...record,
        script: authored.script,
        title: authored.script?.title || record.title,
        origin: {
          ...(record.origin ?? {}),
          prompt,
          script: { source: authored.source, error: authored.error, rejected: authored.rejected, attempts: authored.attempts },
        },
        updatedAt: nowIso(),
      }
      writeProject(next)
      const storyboard = await planProject(next)
      sendJson(res, 200, {
        ok: true,
        project: next,
        storyboard,
        script: {
          source: authored.source,
          error: authored.error,
          rejected: authored.rejected,
          shots: authored.script ? authored.script.shots.length : 0,
        },
      })
    } catch (error) {
      sendError(res, 400, 'bad_request', errorMessage(error))
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

  // GET /forge/blueprint — the option tables the wizard renders.
  if (method === 'GET' && path === '/forge/blueprint') {
    sendJson(res, 200, { ok: true, blueprint: forgeBlueprint() })
    return
  }

  // GET /forge/drafts — every draft on disk, newest first.
  if (method === 'GET' && path === '/forge/drafts') {
    sendJson(res, 200, { ok: true, items: listForgeDrafts() })
    return
  }

  // POST /forge/drafts — scaffold a package from a goal, with no model involved.
  if (method === 'POST' && path === '/forge/drafts') {
    try {
      const body = await readJsonBody(req)
      const goal = typeof body.goal === 'string' ? body.goal.trim() : ''
      if (!goal) {
        sendError(res, 400, 'bad_request', 'goal is required')
        return
      }
      const trackId = FORGE_TRACKS.some((t) => t.id === body.track) ? body.track : '1.3'
      const look = LOOK_IDS.includes(body.look) ? body.look : forgeLookForTrack(trackId)
      const palette = PALETTE_NAMES.includes(body.palette) ? body.palette : '科技暗色'
      const aspect = ASPECTS.includes(body.aspect) ? body.aspect : forgeAspectForTrack(trackId)
      const durationSec = clampNumber(body.durationSec, MIN_DURATION_SEC, MAX_DURATION_SEC, 20)
      const beatBpm = clampNumber(body.beatBpm, 40, 240, 120)
      const subtitle = SUBTITLE_MODES.includes(body.subtitle) ? body.subtitle : 'zh'

      const draftId = forgeDraftId(goal)
      const agentId = forgeAgentId(goal, trackId)
      const built = scaffoldAgentPackage({
        goal,
        agentId,
        trackId,
        look,
        palette,
        durationSec,
        beatBpm,
        subtitle,
        aspect,
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : '',
      })

      writeDraftFiles(draftId, {
        'manifest.json': JSON.stringify(built.manifest, null, 2),
        [built.paths.template]: JSON.stringify(built.template, null, 2),
        [built.paths.skill]: built.skill,
      })

      const meta = {
        goal,
        agentId,
        track: trackId,
        look,
        palette,
        aspect,
        durationSec: Number(durationSec),
        beatBpm: Number(beatBpm),
        subtitle,
        createdAt: nowIso(),
        source: 'scaffold',
      }
      writeJsonFile(join(forgeDraftDir(draftId), 'draft.json'), meta)

      const validation = await validateDraft(draftId)
      const draft = readForgeDraft(draftId)
      sendJson(res, 200, { ok: true, draft, validation })
      return
    } catch (error) {
      sendError(res, 500, 'forge_failed', errorMessage(error))
      return
    }
  }

  // POST /forge/drafts/:id/refine — let a model rewrite the prose, then revalidate.
  const refineMatch = path.match(/^\/forge\/drafts\/([A-Za-z0-9_-]+)\/refine$/)
  if (refineMatch && method === 'POST') {
    const draftId = refineMatch[1]
    const draft = readForgeDraft(draftId)
    if (!draft) {
      sendError(res, 404, 'not_found', `unknown draft: ${draftId}`)
      return
    }
    const llm = ctxRef?.get ? ctxRef.get('llm') : null
    if (!llm) {
      // No model is not an error here: the scaffold is already complete and valid.
      const validation = await validateDraft(draftId)
      sendJson(res, 200, {
        ok: true,
        refined: false,
        reason: 'the llm service is unavailable in this Host runtime',
        draft: readForgeDraft(draftId),
        validation,
      })
      return
    }
    try {
      const body = await readJsonBody(req)
      const note = typeof body.note === 'string' ? body.note.trim() : ''
      const system =
        'You rewrite the SKILL.md body of a video-agent package. Keep every heading, every hard constraint, and the output-contract JSON block byte-identical. Reply with the new markdown only — no code fence, no commentary.'
      const userText = [
        `Goal: ${draft.meta?.goal ?? ''}`,
        note ? `Additional instruction: ${note}` : '',
        'Current SKILL.md:',
        draft.files.find((f) => f.path.endsWith('SKILL.md'))?.content ?? '',
      ]
        .filter(Boolean)
        .join('\n\n')

      const result = await callLlmWithFallback(llm, system, userText)
      let refined = false
      let reason = result.ok ? null : 'every model route failed'
      if (result.ok && result.text.trim()) {
        const skillFile = draft.files.find((f) => f.path.endsWith('SKILL.md'))
        if (skillFile && parseSkillFrontmatter(result.text).meta.name) {
          writeFileSync(join(draft.dir, skillFile.path), result.text.trim() + '\n', 'utf8')
          refined = true
        } else {
          reason = 'the model reply lost its frontmatter, so it was discarded'
        }
      }
      const validation = await validateDraft(draftId)
      sendJson(res, 200, {
        ok: true,
        refined,
        reason,
        attempts: result.attempts,
        draft: readForgeDraft(draftId),
        validation,
      })
      return
    } catch (error) {
      sendError(res, 500, 'forge_failed', errorMessage(error))
    }
    return
  }

  // GET /forge/drafts/:id
  const draftMatch = path.match(/^\/forge\/drafts\/([A-Za-z0-9_-]+)$/)
  if (draftMatch && method === 'GET') {
    const draft = readForgeDraft(draftMatch[1])
    if (!draft) {
      sendError(res, 404, 'not_found', `unknown draft: ${draftMatch[1]}`)
      return
    }
    const validation = await validateDraft(draftMatch[1])
    sendJson(res, 200, { ok: true, draft, validation })
    return
  }

  // POST /forge/drafts/:id/install — validate, then install as a real agent.
  const installMatch = path.match(/^\/forge\/drafts\/([A-Za-z0-9_-]+)\/install$/)
  if (installMatch && method === 'POST') {
    const draftId = installMatch[1]
    const draft = readForgeDraft(draftId)
    if (!draft) {
      sendError(res, 404, 'not_found', `unknown draft: ${draftId}`)
      return
    }
    // The gate: a draft that fails validation never reaches AGENTS_DIR, because
    // a half-valid package is worse than no package — it installs, then renders
    // something nobody asked for.
    const validation = await validateDraft(draftId)
    if (!validation.ok) {
      sendError(res, 409, 'invalid_draft', 'the draft failed validation', { errors: validation.errors })
      return
    }
    try {
      const result = installAgentFromDir(draft.dir, { overwrite: true, source: 'forge' })
      const skillsSync = syncSkills()
      sendJson(res, 200, { ok: true, ...result, validation, skills: skillsSync, agents: listAgents() })
    } catch (error) {
      sendError(res, 400, 'install_failed', errorMessage(error))
    }
    return
  }

  // DELETE /forge/drafts/:id
  if (draftMatch && method === 'DELETE') {
    const dir = forgeDraftDir(draftMatch[1])
    if (!existsSync(dir)) {
      sendError(res, 404, 'not_found', `unknown draft: ${draftMatch[1]}`)
      return
    }
    rmSync(dir, { recursive: true, force: true })
    sendJson(res, 200, { ok: true, removed: draftMatch[1] })
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
