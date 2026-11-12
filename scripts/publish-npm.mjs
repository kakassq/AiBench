/**
 * Publish both packages to the npm registry over HTTPS.
 *
 * There is no npm CLI and no git on this machine, so publishing goes straight to
 * the registry API: a single PUT per package carrying the metadata and the
 * tarball as a base64 attachment.
 *
 * Order matters. `dsh-aibench` declares a dependency on `aibench-render`, and npm
 * refuses to publish a package whose dependency does not exist yet — so the
 * render engine goes first.
 *
 * Usage:
 *   node scripts/publish-npm.mjs --token <npm-token> [--dry-run] [--otp 123456]
 *
 * The token is read from the argument or from NPM_TOKEN. It is never written to
 * disk or logged.
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DIST = join(ROOT, 'dist-packages')

const REGISTRY = process.env.AIBENCH_NPM_REGISTRY || 'https://registry.npmjs.org'
const PACKAGES = ['aibench-render', 'dsh-aibench']

function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const hasFlag = (name) => process.argv.includes(`--${name}`)

const token = arg('token') || process.env.NPM_TOKEN
const otp = arg('otp')
const dryRun = hasFlag('dry-run')

if (!dryRun && !token) {
  console.error('No npm token. Pass --token <token> or set NPM_TOKEN.')
  process.exit(2)
}

/** Locate the packed tarball for a package, failing loudly if it was not built. */
function tarballFor(name) {
  if (!existsSync(DIST)) {
    console.error(`dist-packages/ is missing — run \`pnpm pack\` for each package first.`)
    process.exit(2)
  }
  const match = readdirSync(DIST).find((file) => file.startsWith(`${name}-`) && file.endsWith('.tgz'))
  if (!match) {
    console.error(`No tarball for ${name} in dist-packages/. Pack it first.`)
    process.exit(2)
  }
  return join(DIST, match)
}

/** Read the package.json out of the tarball's `package/package.json` entry. */
function manifestFromTarball(tarball) {
  // The tarball is gzip+tar; rather than pull in a dependency, read the plain
  // copy that pack leaves behind next to the source.
  const source = join(ROOT, 'packages', tarball.includes('aibench-render') ? 'aibench-render' : 'aibench', 'package.json')
  return JSON.parse(readFileSync(source, 'utf8'))
}

function shasum(buffer) {
  return createHash('sha1').update(buffer).digest('hex')
}

function integrity(buffer) {
  return `sha512-${createHash('sha512').update(buffer).digest('base64')}`
}

async function publishOne(name) {
  const tarball = tarballFor(name)
  const bytes = readFileSync(tarball)
  const manifest = manifestFromTarball(tarball)
  const fileName = tarball.split(/[\\/]/).pop()

  if (manifest.name !== name) {
    console.error(`Manifest name "${manifest.name}" does not match expected "${name}".`)
    process.exit(2)
  }

  // npm's publish document: the version record plus an attachment carrying the
  // bytes. `dist` must be present or the registry rejects the publish.
  const versionRecord = {
    ...manifest,
    _id: `${name}@${manifest.version}`,
    dist: {
      shasum: shasum(bytes),
      integrity: integrity(bytes),
      tarball: `${REGISTRY}/${name}/-/${fileName}`,
      fileCount: undefined,
      unpackedSize: undefined,
    },
  }
  delete versionRecord.dist.fileCount
  delete versionRecord.dist.unpackedSize

  const document = {
    _id: name,
    name,
    description: manifest.description,
    'dist-tags': { latest: manifest.version },
    versions: { [manifest.version]: versionRecord },
    readme: existsSync(join(ROOT, 'packages', name === 'aibench-render' ? 'aibench-render' : 'aibench', 'README.md'))
      ? readFileSync(join(ROOT, 'packages', name === 'aibench-render' ? 'aibench-render' : 'aibench', 'README.md'), 'utf8')
      : undefined,
    _attachments: {
      [fileName]: {
        content_type: 'application/octet-stream',
        data: bytes.toString('base64'),
        length: bytes.length,
      },
    },
  }

  const body = JSON.stringify(document)
  const sizeMb = (body.length / 1048576).toFixed(2)

  if (dryRun) {
    console.log(`DRY  ${name}@${manifest.version}  tarball=${fileName}  payload=${sizeMb}MB  shasum=${versionRecord.dist.shasum}`)
    return { name, version: manifest.version, dryRun: true }
  }

  console.log(`PUT  ${REGISTRY}/${name}  (${sizeMb} MB payload)`)
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'npm-command': 'publish',
    'user-agent': 'aibench-publish/1.0',
  }
  if (otp) headers['npm-otp'] = otp

  const response = await fetch(`${REGISTRY}/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers,
    body,
    signal: AbortSignal.timeout(180_000),
  })

  const text = await response.text()
  if (!response.ok) {
    console.error(`FAIL ${name}: HTTP ${response.status}`)
    console.error(text.slice(0, 2000))
    process.exit(1)
  }

  let parsed = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    /* registry can answer with an empty body on success */
  }
  console.log(`OK   ${name}@${manifest.version}  ${parsed.ok ? 'published' : 'accepted'}`)
  return { name, version: manifest.version }
}

const results = []
for (const name of PACKAGES) {
  results.push(await publishOne(name))
}

console.log('\n--- publish summary ---')
for (const result of results) {
  console.log(`${result.name}@${result.version}${result.dryRun ? ' (dry run)' : ''}`)
}
if (!dryRun) {
  console.log('\nVerify:')
  for (const result of results) {
    console.log(`  curl ${REGISTRY}/${result.name}`)
  }
}
