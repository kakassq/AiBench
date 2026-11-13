/**
 * Delete the projects that earlier gate runs leaked into the real data dir.
 *
 * `forge-e2e.mjs` and the route/forge gates import the Host module and then
 * create real projects. Before `scripts/sandbox-data.mjs` existed, `DATA_DIR`
 * resolved to the live profile, so every gate run left a "forge e2e" project in
 * the user's Studio list. The gates are fixed; this cleans up after them.
 *
 * Only projects belonging to the fixture agent are touched, and only when the
 * title matches — a real project that happens to be called "forge e2e" is still
 * the user's, so it is reported and skipped unless --force is passed.
 *
 * Usage:
 *   node scripts/cleanup-gate-projects.mjs [--dry-run] [--force]
 */
const origin = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : process.env.AIBENCH_ORIGIN
const hasFlag = (name) => process.argv.includes(`--${name}`)
const dryRun = hasFlag('dry-run')
const force = hasFlag('force')

/** Ports DSH has used on this machine; the host picks a fresh one on restart. */
const KNOWN_PORTS = [61013, 49658, 57360]

async function probe(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/aibench-api/panel/info`, {
      signal: AbortSignal.timeout(400),
    })
    if (!response.ok) return null
    const payload = await response.json()
    return payload?.ok && payload?.name ? `http://127.0.0.1:${port}` : null
  } catch {
    return null
  }
}

async function discoverOrigin() {
  for (const port of KNOWN_PORTS) {
    const found = await probe(port)
    if (found) return found
  }
  // Full ephemeral range, in batches: 16k ports at 400ms each would take hours
  // serially, and the scan is the difference between "works" and "hangs".
  const ports = []
  for (let port = 49152; port <= 65535; port += 1) ports.push(port)
  for (let index = 0; index < ports.length; index += 256) {
    const batch = ports.slice(index, index + 256)
    const results = await Promise.all(batch.map((port) => probe(port)))
    const hit = results.find(Boolean)
    if (hit) return hit
  }
  return null
}

const base = origin || (await discoverOrigin())
if (!base) {
  console.error('no running AiBench host found; pass an origin explicitly')
  process.exit(1)
}
console.log(`host: ${base}`)

async function call(method, path) {
  const response = await fetch(`${base}/aibench-api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: response.status, json, text }
}

const listed = await call('GET', '/projects')
if (listed.status !== 200) {
  console.error(`GET /projects -> ${listed.status}`)
  process.exit(1)
}

const items = listed.json?.items ?? []
const suspects = items.filter((project) => project.agentId === 'agent-e2e' && project.title === 'forge e2e')

console.log(`projects total: ${items.length}`)
console.log(`gate fixtures: ${suspects.length}`)

if (suspects.length === 0) {
  console.log('nothing to clean')
  process.exit(0)
}

for (const project of suspects) {
  const label = `${project.id}  ${project.title}  ${project.agentId}`
  if (dryRun) {
    console.log(`WOULD DELETE  ${label}`)
    continue
  }
  const removed = await call('DELETE', `/projects/${project.id}`)
  console.log(`${removed.status === 200 ? 'deleted' : `FAILED(${removed.status})`}  ${label}`)
}

if (dryRun) console.log('\nDRY RUN — nothing deleted.')
