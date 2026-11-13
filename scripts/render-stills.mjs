const base = process.argv[2] || 'http://127.0.0.1:61013/aibench-api'
const pid = process.argv[3] || 'p_bca88be3d0334a'
const frames = (process.argv[4] || '60,180,320,470,660,850').split(',').map(Number)

for (const frame of frames) {
  const started = Date.now()
  const res = await fetch(`${base}/still`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: pid, frame }),
  })
  const payload = await res.json()
  if (!res.ok || !payload.ok) {
    console.error('FAIL', frame, res.status, JSON.stringify(payload).slice(0, 400))
    continue
  }
  console.log(`frame ${frame} -> ${payload.still?.url ?? JSON.stringify(payload).slice(0, 160)}  ${Date.now() - started}ms`)
}
