// Concurrency cap: with maxConcurrent=1, a second agent must queue (state 'idle')
// until the first finishes, then run. Uses the REAL AgentManager + live `claude`.
import { AgentManager } from '../src/main/services/AgentManager'

let fail = 0
const assert = (c: boolean, m: string): void => {
  console.log(`${c ? '  ok   ' : '  FAIL '}${m}`)
  if (!c) fail++
}

const mgr = new AgentManager()
mgr.setMaxConcurrent(1)

const states = new Map<string, string>()
mgr.on('state', (m: { agentId: string; state: string }) => states.set(m.agentId, m.state))

const PROMPT = 'Reply with exactly the word OK and nothing else. Do not use any tools.'
const id1 = mgr.spawnAgent({ cwd: process.cwd(), prompt: PROMPT, allowedTools: 'Read' })
const id2 = mgr.spawnAgent({ cwd: process.cwd(), prompt: PROMPT, allowedTools: 'Read' })

// Synchronously after spawning: first runs, second is queued.
assert(states.get(id1) === 'working', 'first agent runs immediately')
assert(states.get(id2) === 'idle', 'second agent is queued (idle) under cap=1')

const done = (id: string): boolean => ['done', 'error', 'killed'].includes(states.get(id) ?? '')
await new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, 180000)
  mgr.on('state', () => {
    if (done(id1) && done(id2)) {
      clearTimeout(timer)
      setTimeout(resolve, 150)
    }
  })
})

assert(states.get(id1) === 'done', `first agent finished (${states.get(id1)})`)
assert(states.get(id2) === 'done', `second agent finished after dequeue (${states.get(id2)})`)

mgr.killAll()
console.log(fail === 0 ? '\nConcurrency tests passed ✔' : `\n${fail} concurrency test(s) failed ✖`)
process.exit(fail ? 1 : 0)
