// Timeline invariant gate: every generated storyboard must tile totalFrames
// exactly, with no overlaps, no gaps, and no shot shorter than 12 frames.
const { planStoryboard } = await import('../packages/aibench-render/src/storyboard.ts')

const BRIEFS = [
  '贝叶斯公式并不神秘，它只是把先验加新证据等于后验',
  '熵增定律解释了为什么时间只朝一个方向流',
  '为什么聪明的人会一起变笨',
]
const DURATIONS = [10, 12, 15, 20, 25, 30, 45, 60, 90, 120]
const BPMS = [60, 90, 100, 110, 120, 128, 140, 180, 200]
const LOCKED = [undefined, ['hook.from'], ['process.durationFrames'], ['cta.from', 'hook.from']]

const bad = []
let checked = 0

for (const brief of BRIEFS) {
  for (const durationSec of DURATIONS) {
    for (const beatBpm of BPMS) {
      for (const type of [0, 1, 2]) {
        for (const flow of [0, 1, 2]) {
          for (const locked of LOCKED) {
            for (const style of [0, 4]) {
              checked += 1
              const subtitle = checked % 3 === 0 ? 'none' : 'bilingual'
              const sb = planStoryboard(brief, { type, flow, style, palette: 0, durationSec, beatBpm, subtitle, locked })
              const shots = sb.shots
              const sum = shots.reduce((a, s) => a + s.durationFrames, 0)
              const last = shots[shots.length - 1]
              const problems = []
              if (sum !== sb.totalFrames) problems.push(`sum ${sum} != ${sb.totalFrames}`)
              if (shots[0].from !== 0) problems.push(`first starts at ${shots[0].from}`)
              if (last.from + last.durationFrames !== sb.totalFrames) problems.push(`ends at ${last.from + last.durationFrames}`)
              for (let i = 0; i < shots.length - 1; i += 1) {
                const end = shots[i].from + shots[i].durationFrames
                if (end !== shots[i + 1].from) problems.push(`gap/overlap at ${i}`)
              }
              for (const s of shots) if (s.durationFrames < 12) problems.push(`${s.kind} too short (${s.durationFrames})`)
              // `Captions` renders `shot.caption` only, so a missing caption is an
              // invisible subtitle: the band stays empty while `subtitle` asks for
              // one. Guard it here because nothing throws when it regresses.
              if (subtitle !== 'none') {
                for (const s of shots) if (!s.caption) problems.push(`${s.kind} has no caption`)
              } else {
                for (const s of shots) if (s.caption) problems.push(`${s.kind} has a caption in none mode`)
              }
              if (problems.length > 0) {
                bad.push({ brief: brief.slice(0, 8), durationSec, beatBpm, type, flow, locked, problems, timeline: shots.map((s) => `${s.kind}@${s.from}+${s.durationFrames}`).join(' ') })
              }
            }
          }
        }
      }
    }
  }
}

console.log(`checked ${checked} storyboards, ${bad.length} broken`)
for (const row of bad.slice(0, 8)) console.log(JSON.stringify(row))
process.exit(bad.length === 0 ? 0 : 1)
