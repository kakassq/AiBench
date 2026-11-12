/**
 * Publish the AiBench repo to GitHub over the REST API.
 *
 * There is no `git` binary on this machine, so this creates the repository and
 * writes the whole tree through the Git Data API: blobs for binaries, an inline
 * tree for text, one commit, one ref update. No working-tree clone needed.
 *
 * Usage:
 *   node scripts/publish-github.mjs --token <github-pat> [--owner <user>] \
 *        [--repo AiBench] [--private] [--dry-run]
 *
 * The token needs `repo` scope (or fine-grained Contents: read+write +
 * Administration: write to create the repo). It is never written to disk.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const API = 'https://api.github.com'

function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const hasFlag = (name) => process.argv.includes(`--${name}`)

const token = arg('token') || process.env.GITHUB_TOKEN
const repoName = arg('repo') || 'AiBench'
const isPrivate = hasFlag('private')
const dryRun = hasFlag('dry-run')

if (!token && !dryRun) {
  console.error('No GitHub token. Pass --token <pat> or set GITHUB_TOKEN.')
  process.exit(2)
}

/** Paths that must never reach the repo. Mirrors .gitignore plus local scratch. */
const IGNORED_DIRS = new Set(['node_modules', 'dist-packages', '.tmp', 'out', '.git'])
const IGNORED_FILES = new Set(['tsprobe.mjs', 'dev-cookie.mjs', '.DS_Store', 'Thumbs.db'])
const IGNORED_EXT = new Set(['.tgz', '.log'])

/** Extensions that must be sent as base64 blobs, not inline utf-8 tree content. */
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.wav', '.tgz', '.zip', '.woff', '.woff2'])

function collect(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue
    if (IGNORED_FILES.has(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      collect(full, files)
      continue
    }
    const ext = extname(entry).toLowerCase()
    if (IGNORED_EXT.has(ext)) continue
    // Repo-relative POSIX path; GitHub's tree API has no concept of backslashes.
    files.push({ full, path: relative(ROOT, full).split(sep).join('/'), ext, bytes: stat.size })
  }
  return files
}

async function gh(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'aibench-publish/1.0',
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

// ---------------------------------------------------------------------------
// 1. Who are we, and does the repo already exist?
// ---------------------------------------------------------------------------

let owner = arg('owner')
if (!owner) {
  if (dryRun) {
    owner = '<owner>'
  } else {
    const me = await gh('GET', '/user')
    owner = me.login
    console.log(`authenticated as ${owner}`)
  }
}

const fullName = `${owner}/${repoName}`
console.log(`target repo: ${fullName} (${isPrivate ? 'private' : 'public'})`)

// ---------------------------------------------------------------------------
// 2. Collect the tree
// ---------------------------------------------------------------------------

const files = collect(ROOT)
const textFiles = files.filter((file) => !BINARY_EXT.has(file.ext))
const binaryFiles = files.filter((file) => BINARY_EXT.has(file.ext))
const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)

console.log(`files: ${files.length} (${textFiles.length} text, ${binaryFiles.length} binary), ${(totalBytes / 1048576).toFixed(2)} MB`)

if (dryRun) {
  for (const file of files.slice(0, 40)) console.log(`  ${file.path}  ${file.bytes}`)
  if (files.length > 40) console.log(`  … ${files.length - 40} more`)
  console.log('\nDRY RUN — nothing sent. Drop --dry-run with a token to publish.')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 3. Create the repo (idempotent: an existing repo is reused, not an error)
// ---------------------------------------------------------------------------

let repoExists = false
try {
  await gh('GET', `/repos/${fullName}`)
  repoExists = true
  console.log('repo already exists — adding a commit to it')
} catch (error) {
  if (error.status !== 404) throw error
}

if (!repoExists) {
  await gh('POST', '/user/repos', {
    name: repoName,
    description: 'Local-first parametric video studio panel for DeepSeek Harness. No AI image or video generation — every frame is drawn by code.',
    private: isPrivate,
    has_issues: true,
    has_wiki: false,
    has_projects: false,
    auto_init: false,
  })
  console.log('repo created')
}

// A repo object can exist while the repository is still *empty* — a previous run
// may have created it and then failed. `GET /repos/...` returns 200 either way,
// so the only reliable emptiness test is whether `main` has a commit.
let parentSha = null
try {
  const ref = await gh('GET', `/repos/${fullName}/git/ref/heads/main`)
  parentSha = ref.object.sha
} catch (error) {
  if (error.status !== 404 && error.status !== 409) throw error
}

// ---------------------------------------------------------------------------
// 4. Upload binaries as blobs, then build one tree
// ---------------------------------------------------------------------------

/**
 * An empty repository has no commit, and the Git Data API refuses to create
 * blobs against it (`409 Git Repository is empty`). Bootstrap with a single file
 * through the Contents API, which is the one endpoint that can write the very
 * first commit. Everything else then lands on top.
 */
async function bootstrapEmptyRepo() {
  await gh('PUT', `/repos/${fullName}/contents/README.md`, {
    message: 'Initial commit',
    content: Buffer.from(
      '# AiBench\n\nLocal-first parametric video studio panel for DeepSeek Harness.\n',
      'utf8',
    ).toString('base64'),
  })
  console.log('bootstrapped empty repo with an initial commit')
}

if (!parentSha) await bootstrapEmptyRepo()

const blobShas = new Map()
let uploaded = 0
for (const file of binaryFiles) {
  const content = readFileSync(file.full).toString('base64')
  const blob = await gh('POST', `/repos/${fullName}/git/blobs`, { content, encoding: 'base64' })
  blobShas.set(file.path, blob.sha)
  uploaded += 1
  if (uploaded % 10 === 0 || uploaded === binaryFiles.length) {
    console.log(`  blobs: ${uploaded}/${binaryFiles.length}`)
  }
}

const tree = [
  ...textFiles.map((file) => ({
    path: file.path,
    mode: '100644',
    type: 'blob',
    content: readFileSync(file.full, 'utf8'),
  })),
  ...binaryFiles.map((file) => ({
    path: file.path,
    mode: '100644',
    type: 'blob',
    sha: blobShas.get(file.path),
  })),
]

const treeResult = await gh('POST', `/repos/${fullName}/git/trees`, { tree })
console.log(`tree created: ${treeResult.sha.slice(0, 8)} (${tree.length} entries)`)

// ---------------------------------------------------------------------------
// 5. Commit onto main, creating the branch if this is the first push
// ---------------------------------------------------------------------------

// The bootstrap above wrote a commit, so re-read the ref: the first real commit
// must sit on top of it rather than starting a second root.
if (!parentSha) {
  const ref = await gh('GET', `/repos/${fullName}/git/ref/heads/main`)
  parentSha = ref.object.sha
}

const commit = await gh('POST', `/repos/${fullName}/git/commits`, {
  message: 'AiBench 0.1.0 — local-first parametric video studio',
  tree: treeResult.sha,
  parents: [parentSha],
})
console.log(`commit: ${commit.sha.slice(0, 8)}`)

await gh('PATCH', `/repos/${fullName}/git/refs/heads/main`, { sha: commit.sha, force: false })

// ---------------------------------------------------------------------------
// 6. Topics — the catalog CI checks for `dsh-plugin`
// ---------------------------------------------------------------------------

try {
  await gh('PUT', `/repos/${fullName}/topics`, {
    names: ['dsh-plugin', 'deepseek', 'dsh', 'remotion', 'video', 'panel', 'ai-video', 'motion-graphics'],
  })
  console.log('topics set (includes dsh-plugin)')
} catch (error) {
  console.warn(`topics not set: ${error.message}`)
}

console.log(`\nhttps://github.com/${fullName}`)
