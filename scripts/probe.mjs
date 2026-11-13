#!/usr/bin/env node
/**
 * AiBench smoke probe.
 *
 * Hits the panel API on the running DSH web server and prints a compact
 * pass/fail table. Used as the S0 acceptance check and as the per-stage
 * regression gate afterwards.
 *
 *   node scripts/probe.mjs            # discovers the running web server
 *   node scripts/probe.mjs <origin>   # explicit origin
 *
 * Exit code 0 only when every check passes, so it can gate a release.
 */

const BASE = '/aibench-api'

/**
 * The desktop app picks a free port on every launch, so a hard-coded one goes
 * stale the moment the app restarts. Probe the loopback range and use the first
 * port that answers like a DSH server. `AIBENCH_ORIGIN` still wins, which is
 * what CI and the explicit-argument form use.
 */
async function discoverOrigin() {
  const candidates = []
  for (let port = 49152; port <= 65535; port++) candidates.push(port)
  // The app has been seen in this band often enough to try it first.
  const preferred = [49658, 57360, 61013]
  const ordered = [...preferred, ...candidates.filter((p) => !preferred.includes(p))]

  const probeOne = async (port) => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${BASE}/panel/info`, {
        signal: AbortSignal.timeout(400),
        headers: { accept: 'application/json' },
      })
      if (!response.ok) return null
      const payload = await response.json()
      return payload && payload.ok === true && payload.name ? `http://127.0.0.1:${port}` : null
    } catch {
      return null
    }
  }

  // Scan in batches: 16k sequential 400ms timeouts would take hours, but a
  // batch of 256 finishes a full range in a few seconds on loopback.
  const BATCH = 256
  for (let i = 0; i < ordered.length; i += BATCH) {
    const batch = ordered.slice(i, i + BATCH)
    const found = await Promise.all(batch.map(probeOne))
    const hit = found.find(Boolean)
    if (hit) return hit
  }
  return null
}

const explicit = process.argv[2] || process.env.AIBENCH_ORIGIN
const origin = explicit
  ? explicit.replace(/\/+$/, '')
  : await discoverOrigin()

if (!origin) {
  console.error('no running AiBench host found; start DSH or pass an origin explicitly')
  process.exit(1)
}
console.log(`probing ${origin}${BASE}`)

const checks = []
function check(name, run) {
  checks.push({ name, run })
}

async function getJson(path) {
  const response = await fetch(origin + BASE + path, {
    headers: { accept: 'application/json' },
  })
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`bad JSON from ${path}: ${text.slice(0, 120)}`)
  }
  return { status: response.status, payload }
}

check('GET /panel/info -> 200 + name/version', async () => {
  const { status, payload } = await getJson('/panel/info')
  if (status !== 200) throw new Error(`status ${status}`)
  if (payload?.ok !== true) throw new Error(`ok !== true (${JSON.stringify(payload?.error)})`)
  if (!payload.name || !payload.version) throw new Error('missing name/version')
  return `name=${payload.name} version=${payload.version} node=${payload.node}`
})

check('GET /panel/info -> dataDir lives under the profile', async () => {
  const { payload } = await getJson('/panel/info')
  const dir = String(payload?.dataDir ?? '')
  if (!dir) throw new Error('no dataDir')
  if (!/profiles[\\/]desktop[\\/]aibench$/i.test(dir)) throw new Error(`unexpected dataDir: ${dir}`)
  return dir
})

check('GET /panel/health -> render reported', async () => {
  const { status, payload } = await getJson('/panel/health')
  if (status !== 200 || payload?.ok !== true) throw new Error(`status ${status}`)
  const render = payload.render ?? {}
  return `render.available=${render.available} engine=${render.engine}`
})

check('GET /agents -> array', async () => {
  const { status, payload } = await getJson('/agents')
  if (status !== 200 || payload?.ok !== true) throw new Error(`status ${status}`)
  if (!Array.isArray(payload.items)) throw new Error('items is not an array')
  return `${payload.items.length} agent(s)`
})

check('GET /templates -> array', async () => {
  const { status, payload } = await getJson('/templates')
  if (status !== 200 || payload?.ok !== true) throw new Error(`status ${status}`)
  if (!Array.isArray(payload.items)) throw new Error('items is not an array')
  return `${payload.items.length} template(s)`
})

check('GET /projects -> array', async () => {
  const { status, payload } = await getJson('/projects')
  if (status !== 200 || payload?.ok !== true) throw new Error(`status ${status}`)
  if (!Array.isArray(payload.items)) throw new Error('items is not an array')
  return `${payload.items.length} project(s)`
})

check('GET /nope -> 404 not_found', async () => {
  const { status, payload } = await getJson('/nope')
  if (status !== 404) throw new Error(`expected 404, got ${status}`)
  if (payload?.error?.code !== 'not_found') throw new Error(`code=${payload?.error?.code}`)
  return 'unknown route rejected'
})

check('cross-site request -> 403 forbidden_origin', async () => {
  const response = await fetch(origin + BASE + '/panel/info', {
    headers: { 'sec-fetch-site': 'cross-site', accept: 'application/json' },
  })
  if (response.status !== 403) throw new Error(`expected 403, got ${response.status}`)
  const payload = await response.json().catch(() => null)
  if (payload?.error?.code !== 'forbidden_origin') throw new Error(`code=${payload?.error?.code}`)
  return 'cross-site rejected'
})

const results = []
for (const item of checks) {
  try {
    const detail = await item.run()
    results.push({ ok: true, name: item.name, detail })
  } catch (error) {
    results.push({ ok: false, name: item.name, detail: String(error?.message ?? error) })
  }
}

const width = Math.max(...results.map((r) => r.name.length))
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`)
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed against ${origin}${BASE}`)
process.exit(failed === 0 ? 0 : 1)
