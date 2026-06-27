// End-to-end test of the REAL AgentManager against a live `claude` process.
// Bundled with esbuild (resolves @shared) then run with node — no Electron, no GUI.
//   see: npm run test:e2e (defined ad hoc in verification)
import { AgentManager } from '../src/main/services/AgentManager'

function once(mgr: AgentManager, cwd: string, prompt: string, kill: boolean) {
  return new Promise<string>((resolve, reject) => {
    let events = 0
    let sawResult = false
    const id = mgr.spawnAgent({ cwd, prompt, allowedTools: 'Read' })
    mgr.on('event', (m: { agentId: string; parsed: { type?: string } | null }) => {
      if (m.agentId !== id) return
      events++
      if (m.parsed?.type === 'result') sawResult = true
    })
    mgr.on('state', (m: { agentId: string; state: string; error?: string }) => {
      if (m.agentId !== id) return
      if (['done', 'error', 'killed'].includes(m.state)) {
        console.log(`    final=${m.state} events=${events} sawResult=${sawResult} ${m.error ?? ''}`)
        resolve(m.state)
      }
    })
    if (kill) setTimeout(() => mgr.killAgent(id), 3500)
    setTimeout(() => reject(new Error('timeout')), 120000)
  })
}

const mgr = new AgentManager()
const cwd = process.cwd()

console.log('Test 1: spawn -> stream -> done')
const r1 = await once(
  mgr,
  cwd,
  'Reply with exactly the word PONG and nothing else. Do not use any tools.',
  false
)

console.log('Test 2: spawn -> kill')
const r2 = await once(
  mgr,
  cwd,
  'List and read every file in this directory, then write a 500-word essay about each. Take your time.',
  true
)

const pass = r1 === 'done' && r2 === 'killed'
console.log(`\nTest 1 (done): ${r1}\nTest 2 (killed): ${r2}\n${pass ? 'E2E PASSED ✔' : 'E2E FAILED ✖'}`)
process.exit(pass ? 0 : 1)
