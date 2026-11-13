// HTTP-contract gate: exercise the Host's route table without DSH.
//
// `apply()` registers one prefix handler with `webServer`; this script stands in
// for that service, captures the handler, and drives real request objects through
// it. That covers the wiring the unit-level checks cannot see — path matching,
// status codes, and the JSON envelope the panel parses.
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'

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

// ---- stand in for the Host's webServer service ----
let handler = null
const registered = []
const fakeCtx = {
  inject(_deps, cb) {
    cb({
      webServer: {
        register(entry) {
          registered.push(entry)
          handler = entry.handler
          return () => undefined
        },
      },
    })
  },
  effect(fn) {
    // The Host runs the effect body and keeps its disposer; the route is only
    // registered because of this call, so the stand-in must run it too.
    const disposer = typeof fn === 'function' ? fn() : undefined
    return typeof disposer === 'function' ? disposer : () => undefined
  },
  get(name) {
    if (name === 'skills') return null
    if (name === 'llm') return null
    return null
  },
  on() {
    return () => undefined
  },
  logger: { info() {}, warn() {}, error() {} },
}

mod.apply(fakeCtx)
check('apply registers one prefix route', registered.length === 1, `got ${registered.length}`)
check('route path is the documented prefix', registered[0] && registered[0].path === '/aibench-api', registered[0] && registered[0].path)
check('route kind is prefix', registered[0] && registered[0].kind === 'prefix', registered[0] && registered[0].kind)
check('handler is callable', typeof handler === 'function')

// ---- minimal req/res ----
function makeReq(method, url, body) {
  const text = body === undefined ? '' : JSON.stringify(body)
  const stream = Readable.from(text ? [Buffer.from(text, 'utf8')] : [])
  stream.method = method
  stream.url = url
  stream.headers = { host: '127.0.0.1:49658', 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) }
  return stream
}

function makeRes() {
  const out = { status: 0, body: '', headers: {} }
  return {
    out,
    statusCode: 0,
    setHeader(name, value) {
      out.headers[String(name).toLowerCase()] = value
    },
    end(chunk) {
      if (chunk) out.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      out.status = this.statusCode
      return this
    },
    write(chunk) {
      if (chunk) out.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      return true
    },
    getHeaders() {
      return out.headers
    },
    getHeader(name) {
      return out.headers[String(name).toLowerCase()]
    },
  }
}

async function call(method, path, body) {
  const res = makeRes()
  await handler(makeReq(method, path, body), res)
  let json = null
  try {
    json = JSON.parse(res.out.body)
  } catch {
    json = null
  }
  return { status: res.out.status, json, raw: res.out.body }
}

// ---- routes ----
const info = await call('GET', '/aibench-api/panel/info')
check('GET /panel/info is 200', info.status === 200, `got ${info.status}`)
check('panel/info reports forge enabled', info.json && info.json.features && info.json.features.forge === true, JSON.stringify(info.json && info.json.features))

const bp = await call('GET', '/aibench-api/forge/blueprint')
check('GET /forge/blueprint is 200', bp.status === 200, `got ${bp.status}`)
check('blueprint carries the track table', bp.json && bp.json.blueprint && bp.json.blueprint.tracks.length === 5)

const draftsEmpty = await call('GET', '/aibench-api/forge/drafts')
check('GET /forge/drafts is 200', draftsEmpty.status === 200, `got ${draftsEmpty.status}`)
check('drafts is a list', draftsEmpty.json && Array.isArray(draftsEmpty.json.items))

const noGoal = await call('POST', '/aibench-api/forge/drafts', {})
check('POST /forge/drafts without a goal is 400', noGoal.status === 400, `got ${noGoal.status}`)

const created = await call('POST', '/aibench-api/forge/drafts', {
  goal: 'route-check 命令行工具开场',
  track: '1.5',
  durationSec: 12,
  beatBpm: 128,
})
check('POST /forge/drafts is 200', created.status === 200, `got ${created.status} ${created.raw.slice(0, 120)}`)
const draftId = created.json && created.json.draft && created.json.draft.id
check('created draft has an id', typeof draftId === 'string' && draftId.startsWith('f_'), String(draftId))
check('created draft validates', created.json && created.json.validation && created.json.validation.ok === true, JSON.stringify(created.json && created.json.validation && created.json.validation.errors))
const files = (created.json && created.json.draft && created.json.draft.files) || []
const paths = files.map((f) => f.path)
check(
  'created draft ships manifest + template + skill',
  paths.includes('manifest.json') && paths.some((p) => p.startsWith('templates/')) && paths.some((p) => p.endsWith('SKILL.md')),
  paths.join(','),
)
check('draft.json is not advertised as a package file', !paths.includes('draft.json'), paths.join(','))

const got = await call('GET', `/aibench-api/forge/drafts/${draftId}`)
check('GET /forge/drafts/:id is 200', got.status === 200, `got ${got.status}`)
check('the draft is in the list', (await call('GET', '/aibench-api/forge/drafts')).json.items.some((d) => d.id === draftId))

const refined = await call('POST', `/aibench-api/forge/drafts/${draftId}/refine`, {})
check('refine without a model is still 200', refined.status === 200, `got ${refined.status}`)
check('refine says it was skipped, not failed', refined.json && refined.json.ok === true && refined.json.refined === false, JSON.stringify(refined.json && refined.json.reason))

const ghost = await call('GET', '/aibench-api/forge/drafts/f_nope')
check('unknown draft is 404', ghost.status === 404, `got ${ghost.status}`)

const ghostInstall = await call('POST', '/aibench-api/forge/drafts/f_nope/install', {})
check('installing an unknown draft is 404', ghostInstall.status === 404, `got ${ghostInstall.status}`)

const removed = await call('DELETE', `/aibench-api/forge/drafts/${draftId}`)
check('DELETE /forge/drafts/:id is 200', removed.status === 200, `got ${removed.status}`)
check('the draft is gone', !(await call('GET', '/aibench-api/forge/drafts')).json.items.some((d) => d.id === draftId))

const noRoute = await call('GET', '/aibench-api/nope')
check('unknown route is 404', noRoute.status === 404, `got ${noRoute.status}`)
check('404 uses the documented envelope', noRoute.json && noRoute.json.ok === false && noRoute.json.error && noRoute.json.error.code === 'not_found', noRoute.raw.slice(0, 120))

if (failed > 0) {
  console.log(`\n${failed} route check(s) failed`)
  process.exit(1)
}
console.log('\nroute checks ok')
