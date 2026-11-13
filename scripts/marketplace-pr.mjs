/**
 * Open the awesome-dsh-plugin catalog PR for AiBench without a git binary.
 *
 * Everything goes through the Git Data API against the fork:
 *   blob  → tree (one new file on top of upstream main) → commit → branch → PR
 *
 * Usage:
 *   node scripts/marketplace-pr.mjs [--dry-run]
 *
 * Requires GITHUB_TOKEN with `public_repo` (or classic `repo`) scope, and the
 * fork `kakassq/awesome-dsh-plugin` to already exist. The token is never written
 * to disk.
 *
 * The point of scripting this rather than clicking it: the catalog wants exactly
 * one file per submission, and a hand-made PR is how people accidentally edit the
 * generated README as well. This touches only
 * `data/plugins/kakassq__AiBench--packages-aibench.yml`.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const API = 'https://api.github.com'

const UPSTREAM = { owner: 'awesome-dsh-plugin', repo: 'awesome-dsh-plugin' }
const FORK = { owner: 'kakassq', repo: 'awesome-dsh-plugin' }

/** Monorepo subpackage naming, straight from contributing.md. */
const ENTRY_PATH = 'data/plugins/kakassq__AiBench--packages-aibench.yml'
const BRANCH = 'add-aibench'
const ENTRY_SOURCE = resolve(ROOT, 'docs/marketplace-entry.yml')

const hasFlag = (name) => process.argv.includes(`--${name}`)
const dryRun = hasFlag('dry-run')
const token = process.env.GITHUB_TOKEN

if (!token && !dryRun) {
  console.error('No GitHub token. Set GITHUB_TOKEN.')
  process.exit(2)
}

async function gh(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'aibench-marketplace/1.0',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text }
  }
  if (!response.ok) {
    const message = parsed && parsed.message ? parsed.message : text.slice(0, 400)
    const error = new Error(`${method} ${path} → HTTP ${response.status}: ${message}`)
    error.status = response.status
    error.payload = parsed
    throw error
  }
  return parsed
}

/**
 * The catalog stores the entry under `docs/`, but the submitted file must be a
 * verbatim copy of the YAML block only — the surrounding comments are notes for
 * humans reading this repo, and shipping them into the catalog would be noise in
 * a generated README. So the block is extracted rather than copied wholesale.
 */
function entryYaml() {
  const raw = readFileSync(ENTRY_SOURCE, 'utf8')
  const start = raw.search(/^url:/m)
  if (start === -1) throw new Error(`no "url:" line in ${ENTRY_SOURCE}`)
  return raw.slice(start).trimEnd() + '\n'
}

const yaml = entryYaml()

if (dryRun) {
  console.log(`would write ${ENTRY_PATH} on branch ${BRANCH} of ${FORK.owner}/${FORK.repo}`)
  console.log('--- 8< ---')
  console.log(yaml)
  console.log('--- 8< ---')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 1. Base commit on the fork's main
// ---------------------------------------------------------------------------

const baseRef = await gh('GET', `/repos/${FORK.owner}/${FORK.repo}/git/ref/heads/main`)
const baseSha = baseRef.object.sha
const baseCommit = await gh('GET', `/repos/${FORK.owner}/${FORK.repo}/git/commits/${baseSha}`)
console.log(`fork main: ${baseSha.slice(0, 8)}`)

// Refuse to submit twice: the entry file is the submission, so its presence on
// main means the earlier PR already merged.
try {
  await gh('GET', `/repos/${UPSTREAM.owner}/${UPSTREAM.repo}/contents/${ENTRY_PATH}`)
  console.log('entry already exists upstream — nothing to do')
  process.exit(0)
} catch (error) {
  if (error.status !== 404) throw error
}

// ---------------------------------------------------------------------------
// 2. One blob, one tree, one commit, one branch
// ---------------------------------------------------------------------------

const blob = await gh('POST', `/repos/${FORK.owner}/${FORK.repo}/git/blobs`, {
  content: Buffer.from(yaml, 'utf8').toString('base64'),
  encoding: 'base64',
})

const tree = await gh('POST', `/repos/${FORK.owner}/${FORK.repo}/git/trees`, {
  base_tree: baseCommit.tree.sha,
  tree: [{ path: ENTRY_PATH, mode: '100644', type: 'blob', sha: blob.sha }],
})

const commit = await gh('POST', `/repos/${FORK.owner}/${FORK.repo}/git/commits`, {
  message: 'Add AiBench to the catalog\n\nLocal-first parametric video studio panel for DeepSeek Harness.\nRenders motion graphics with Remotion; no AI image or video generation.',
  tree: tree.sha,
  parents: [baseSha],
})
console.log(`commit: ${commit.sha.slice(0, 8)}`)

try {
  await gh('POST', `/repos/${FORK.owner}/${FORK.repo}/git/refs`, {
    ref: `refs/heads/${BRANCH}`,
    sha: commit.sha,
  })
  console.log(`branch created: ${BRANCH}`)
} catch (error) {
  // Resubmitting after an edit: move the branch instead of failing on 422.
  if (error.status !== 422) throw error
  await gh('PATCH', `/repos/${FORK.owner}/${FORK.repo}/git/refs/heads/${BRANCH}`, {
    sha: commit.sha,
    force: true,
  })
  console.log(`branch updated: ${BRANCH}`)
}

// ---------------------------------------------------------------------------
// 3. The pull request
// ---------------------------------------------------------------------------

const body = [
  'Adds one file, as the contributing guide asks: `data/plugins/kakassq__AiBench--packages-aibench.yml`.',
  '',
  '**What it is.** AiBench is a local-first video studio panel for DeepSeek Harness. One sentence of intent becomes a storyboard, and the film is rendered with Remotion on the local machine — vector typography, chart reveals, ASCII/CRT, dynamic type. No image or video model is called, so the same parameters always produce the same frames and rendering costs nothing.',
  '',
  '**Where the installable package lives.** This is a monorepo subpackage: the manifest is at `packages/aibench`, so the entry points `url` at that subdirectory and uses `owner/repo#subname`.',
  '',
  '**Gate checklist from `contributing.md`:**',
  '',
  '- `dsh.bundle` — declared in `packages/aibench/package.json` together with `dsh.client` and a sibling `cordis.patch.yml`.',
  '- Repo age — created 2026-11-12, so over 1 day old.',
  '- `dsh-plugin` topic — present.',
  '- Real working code, not a placeholder — the panel ships 3 agent packages, 9 templates, a Forge page that authors new agent packages from one sentence, and a skill bridge that registers each package\'s `SKILL.md` with the `skills` service so `@reel-run` works in chat. The repo also carries 15 regression gates, two of which render real frames and measure them.',
  '- Description accuracy — every clause maps to code: "local-first" (the Remotion CLI runs in-process, nothing leaves the machine), "one-sentence agent authoring" (`POST /forge/drafts`), "no AI image or video generation" (zero image/video API calls), "same parameters always produce the same film" (`planStoryboard` has no clock and no RNG; `check-timeline.mjs` asserts 19440 cases).',
  '',
  '**Icon** is a 180×180 PNG in the repo, as the guide asks for a raster rather than an SVG.',
  '',
  'The READMEs are generated — this PR deliberately touches only the entry file.',
].join('\n')

const pr = await gh('POST', `/repos/${UPSTREAM.owner}/${UPSTREAM.repo}/pulls`, {
  title: 'Add AiBench — local-first parametric video studio for DSH',
  head: `${FORK.owner}:${BRANCH}`,
  base: 'main',
  body,
  maintainer_can_modify: true,
})

console.log(`\nPR #${pr.number}: ${pr.html_url}`)
