// End-to-end proof of the Forge path, without DSH.
//
// Boots the Host half on a real http server (the plugin only needs a `webServer`
// stand-in to hand it a handler), then walks the whole user journey over real
// HTTP: scaffold a draft, inspect it, install it as an agent, create a project
// from its template, and render a frame with the real Remotion CLI.
//
// The point is the last step. A Forge agent that installs but cannot render is
// exactly the failure mode this project exists to avoid, and no unit check can
// see it.
//
// Run: node scripts/forge-e2e.mjs
import { createServer } from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
// Must precede the Host import: it redirects DATA_DIR to a throwaway sandbox.
// This gate creates a real project and renders a frame from it, so without the
// sandbox every run left a "forge e2e" project in the user's Studio list.
import './sandbox-data.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const mod = await import(pathToFileURL(join(here, '..', 'packages', 'aibench', 'index.js')).href)

let failed = 0
function check(label, condition, detail) {
  if (condition) console.log(`PASS  ${label}`)
  else {
    failed += 1
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// ---- stand in for the Host services the plugin asks for ----
let handler = null
const fakeCtx = {
  inject(_deps, cb) {
    cb({
      webServer: {
        register(entry) {
          handler = entry.handler
          return () => undefined
        },
      },
    })
  },
  effect(fn) {
    const disposer = typeof fn === 'function' ? fn() : undefined
    return typeof disposer === 'function' ? disposer : () => undefined
  },
  get() {
    return null
  },
  on() {
    return () => undefined
  },
  logger: { info() {}, warn() {}, error() {} },
}

mod.apply(fakeCtx)
check('host registered its route handler', typeof handler === 'function')

const server = createServer((req, res) => {
  handler(req, res).catch((error) => {
    res.statusCode = 500
    res.end(JSON.stringify({ ok: false, error: { message: String(error) } }))
  })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const base = `${origin}/aibench-api`
console.log(`host listening on ${origin}`)

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: response.status, json, raw: text }
}

const goal = 'e2e 造一个命令行工具的开场'
const created = await call('POST', '/forge/drafts', { goal, track: '1.5', durationSec: 12, beatBpm: 120 })
check('scaffold a draft over HTTP', created.status === 200, `${created.status} ${created.raw.slice(0, 160)}`)
const draft = created.json?.draft
check('draft validates before install', created.json?.validation?.ok === true, JSON.stringify(created.json?.validation?.errors))
check('draft preview lists exactly the package files', draft?.files?.length === 3, String(draft?.files?.length))

const installed = await call('POST', `/forge/drafts/${draft.id}/install`, {})
check('install the draft as an agent', installed.status === 200, `${installed.status} ${installed.raw.slice(0, 200)}`)
const agentId = installed.json?.id
check('installed agent has an id', typeof agentId === 'string' && agentId.length > 0, String(agentId))

const agents = await call('GET', '/agents')
const agent = agents.json?.items?.find((item) => item.id === agentId)
check('installed agent appears in the agent list', Boolean(agent), agents.json?.items?.map((a) => a.id).join(','))
check('installed agent ships a template', Boolean(agent) && agent.templates > 0, String(agent?.templates))
check('installed agent ships a skill', Boolean(agent) && agent.skills.length > 0, JSON.stringify(agent?.skills))

const templates = await call('GET', `/templates?agentId=${agentId}`)
const template = templates.json?.items?.[0]
check('its template is listed', Boolean(template), JSON.stringify(templates.json?.items?.map((t) => t.id)))
check('its template resolves to the look we asked for', Boolean(template) && template.style?.look === 'terminal-crt', String(template?.style?.look))

// ---- the part that matters: can the new agent actually render? ----
const project = await call('POST', '/projects', {
  templateId: template.id,
  title: 'forge e2e',
  brief: '命令行工具开场',
})
check('create a project from the new template', project.status === 200, `${project.status} ${project.raw.slice(0, 200)}`)
const projectId = project.json?.project?.id
// `POST /projects` stores the record without a plan; the storyboard is planned on
// demand by the dedicated endpoint, which is what the panel calls.
const planned = await call('GET', `/projects/${projectId}/storyboard`)
const storyboard = planned.json?.storyboard
check('the storyboard endpoint answers', planned.status === 200, `${planned.status}`)
check('the storyboard plans shots', Boolean(storyboard) && storyboard.shots.length > 0, JSON.stringify(storyboard?.shots?.map((s) => s.kind)))
check('the storyboard has a frame budget', Boolean(storyboard) && storyboard.totalFrames > 0, String(storyboard?.totalFrames))
check('the storyboard honours the requested duration', Boolean(storyboard) && storyboard.totalFrames === 12 * 30, `totalFrames=${storyboard?.totalFrames}`)

const render = await call('GET', '/panel/info')
const renderReady = render.json?.render?.available === true
check('the render engine is available', renderReady, JSON.stringify(render.json?.render))

if (renderReady) {
  const still = await call('POST', '/still', { projectId, frame: 15 })
  check('render a frame with the forged agent', still.status === 200, `${still.status} ${still.raw.slice(0, 200)}`)
  // `/still` answers with a media URL, not a filesystem path: fetch it back so the
  // assertion covers the same bytes the panel would show.
  const imageUrl = still.json?.image
  check('the frame URL is media-scoped', typeof imageUrl === 'string' && imageUrl.startsWith('/aibench-api/media/'), String(imageUrl))
  const frame = await fetch(`${origin}${imageUrl}`)
  const bytes = Buffer.from(await frame.arrayBuffer())
  check('the frame downloads', frame.status === 200, `status ${frame.status}`)
  check('the frame is a real PNG', bytes.length > 10000 && bytes[0] === 0x89 && bytes.subarray(1, 4).toString() === 'PNG', `${bytes.length} bytes`)
  console.log(`      frame: ${imageUrl} (${bytes.length} bytes)`)
} else {
  console.log('SKIP  render: the render engine is not installed in this checkout')
}

// ---- cleanup: the fixture agent and draft must not linger ----
const removedAgent = await call('POST', `/agents/${agentId}/uninstall`, {})
check('fixture agent uninstalls', removedAgent.status === 200, `${removedAgent.status}`)
const removedDraft = await call('DELETE', `/forge/drafts/${draft.id}`, undefined)
check('fixture draft is deleted', removedDraft.status === 200, `${removedDraft.status}`)

server.close()

if (failed > 0) {
  console.log(`\n${failed} forge e2e check(s) failed`)
  process.exit(1)
}
console.log('\nforge e2e ok')
