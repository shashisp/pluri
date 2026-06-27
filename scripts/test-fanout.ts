// Real fan-out e2e: launch a ticket across two throwaway git repos and verify
// two agents spawn, both terminate, and the ticket rolls up to awaiting_review.
// Spawns real `claude` processes. Runs under Electron's ABI (test:fanout).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentManager } from '../src/main/services/AgentManager'
import { Db } from '../src/main/services/db'
import { TicketLauncher } from '../src/main/services/TicketLauncher'

let fail = 0
const assert = (c: boolean, m: string): void => {
  console.log(`${c ? '  ok   ' : '  FAIL '}${m}`)
  if (!c) fail++
}

const TERMINAL = ['done', 'error', 'killed', 'mr_open']
const root = mkdtempSync(join(tmpdir(), 'pluri-fanout-'))

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd }).toString()
}
function mkrepo(name: string): string {
  const p = join(root, name)
  mkdirSync(p, { recursive: true })
  git(p, 'init', '-q')
  git(p, 'config', 'user.email', 't@t.t')
  git(p, 'config', 'user.name', 'test')
  writeFileSync(join(p, 'README.md'), `# ${name}\n`)
  git(p, 'add', '-A')
  git(p, 'commit', '-qm', 'init')
  return p
}

const repoA = mkrepo('backend')
const repoB = mkrepo('frontend')

const db = new Db(join(root, 'test.db'))
const ws = db.createWorkspace({ name: 'T' })
const rA = db.addRepo({
  workspaceId: ws.id, name: 'backend', path: repoA,
  gitHost: 'github', defaultBranch: 'main', isContractProducer: true
})
const rB = db.addRepo({
  workspaceId: ws.id, name: 'frontend', path: repoB,
  gitHost: 'github', defaultBranch: 'main', isContractProducer: false
})
const ticket = db.createTicket({
  workspaceId: ws.id,
  title: 'Add hello file',
  spec: 'Create a file named HELLO.txt containing exactly the word PONG. Keep it minimal; do not change anything else.',
  targetRepoIds: [rA.id, rB.id],
  orderingMode: 'concurrent'
})

const manager = new AgentManager()
const ticketStates: string[] = []
const launcher = new TicketLauncher(manager, db, (ch, payload) => {
  if (ch === 'ticket:state') ticketStates.push((payload as { state: string }).state)
})

const result = await launcher.launch(ticket.id)
assert(result.agents.length === 2, 'launch spawned one agent per target repo')

// Poll the DB until the ticket rolls up (push+MR finalize is async). These temp
// repos have no 'origin' remote, so each agent finishes as 'done' (committed
// locally, nothing to push), and the ticket rolls up to awaiting_review.
await new Promise<void>((resolve) => {
  const start = Date.now()
  const timer = setInterval(() => {
    const t = db.getTicket(ticket.id)
    if (t?.state === 'awaiting_review' || Date.now() - start > 180000) {
      clearInterval(timer)
      resolve()
    }
  }, 500)
})

const agents = db.listAgentsByTicket(ticket.id)
assert(agents.length === 2, 'two agent records persisted')
assert(
  agents.every((a) => TERMINAL.includes(a.state)),
  `both agents terminal (${agents.map((a) => `${a.repoName}:${a.state}`).join(', ')})`
)
assert(ticketStates.includes('running'), 'emitted ticket:state running')
assert(
  db.getTicket(ticket.id)?.state === 'awaiting_review',
  'ticket rolled up to awaiting_review'
)
assert(ticketStates.includes('awaiting_review'), 'emitted ticket:state awaiting_review')

const branchesA = git(repoA, 'branch', '--format=%(refname:short)')
assert(/ticket-/.test(branchesA), 'backend repo has a ticket-* branch from its agent')

db.close()
manager.killAll()
rmSync(root, { recursive: true, force: true })
console.log(fail === 0 ? '\nFan-out e2e passed ✔' : `\n${fail} fan-out check(s) failed ✖`)
process.exit(fail ? 1 : 0)
