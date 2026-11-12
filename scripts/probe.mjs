#!/usr/bin/env node
/**
 * AiBench smoke probe.
 *
 * Hits the panel API on the running DSH web server and prints a compact
 * pass/fail table. Used as the S0 acceptance check and as the per-stage
 * regression gate afterwards.
 *
 *   node scripts/probe.mjs            # uses http://127.0.0.1:57360
 *   node scripts/probe.mjs <origin>   # explicit origin
 *
 * Exit code 0 only when every check passes, so it can gate a release.
 */

const DEFAULT_ORIGIN = 'http://127.0.0.1:57360'
const BASE = '/aibench-api'

const origin = (process.argv[2] || process.env.AIBENCH_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, '')

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
