// MemoryService (paths / atomic write / watch) + tiered prompt composition,
// using a fake AgentManager (no real `claude`) against real fs + git + DB.
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Db } from '../src/main/services/db'
import { MemoryService } from '../src/main/services/MemoryService'
import { ContractService } from '../src/main/services/ContractService'
import { TicketLauncher } from '../src/main/services/TicketLauncher'
import { GitService } from '../src/main/services/GitService'
import type { AgentManager } from '../src/main/services/AgentManager'

let fail = 0
const assert = (c: boolean, m: string): void => {
  console.log(`${c ? '  ok   ' : '  FAIL '}${m}`)
  if (!c) fail++
}
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const root = mkdtempSync(join(tmpdir(), 'pluri-mem-'))
const git = (cwd: string, ...a: string[]): void => {
  execFileSync('git', a, { cwd })
}
function mkrepo(name: string): string {
  const p = join(root, name)
  mkdirSync(p, { recursive: true })
  git(p, 'init', '-q', '-b', 'main')
  git(p, 'config', 'user.email', 't@t.t')
  git(p, 'config', 'user.name', 'test')
  writeFileSync(join(p, 'README.md'), `# ${name}\n`)
  git(p, 'add', '-A')
  git(p, 'commit', '-qm', 'init')
  return p
}
const backend = mkrepo('backend')
const frontend = mkrepo('frontend')

const db = new Db(join(root, 'test.db'))
const ws = db.createWorkspace({ name: 'Acme' })
const rB = db.addRepo({
  workspaceId: ws.id, name: 'backend', path: backend,
  gitHost: 'github', defaultBranch: 'main', isContractProducer: true
})
const rF = db.addRepo({
  workspaceId: ws.id, name: 'frontend', path: frontend,
  gitHost: 'github', defaultBranch: 'main', isContractProducer: false
})

const events: { ch: string; content: string }[] = []
const memory = new MemoryService(db, (ch, p) =>
  events.push({ ch, content: (p as { content: string }).content })
)

// --- MemoryService: path resolution ----------------------------------------
assert(
  memory.filePath({ type: 'workspace', id: ws.id }) ===
    join(root, '.pluri', 'memory', 'workspace.md'),
  'workspace memory path -> .pluri/memory/workspace.md'
)
assert(
  memory.filePath({ type: 'repo', id: rB.id }) === join(backend, 'CLAUDE.md'),
  'repo memory path -> <repo>/CLAUDE.md'
)

// --- atomic write + read + DB pointer --------------------------------------
const WS_MEM = 'Acme is a B2B invoicing product. Glossary: a "ledger" is an append-only record.'
await memory.write({ type: 'workspace', id: ws.id }, WS_MEM)
assert(existsSync(join(root, '.pluri', 'memory', 'workspace.md')), 'workspace.md created')
assert((await memory.read({ type: 'workspace', id: ws.id })) === WS_MEM, 'workspace memory round-trips')
assert(
  db.listWorkspaces().find((w) => w.id === ws.id)?.memoryPath ===
    join(root, '.pluri', 'memory', 'workspace.md'),
  'DB memoryPath pointer set on write'
)

const CLAUDE = '# backend\nStack: Node/Express. Models in src/models, routes in src/routes.'
await memory.write({ type: 'repo', id: rB.id }, CLAUDE)
assert(readFileSync(join(backend, 'CLAUDE.md'), 'utf8') === CLAUDE, 'CLAUDE.md written at repo root')

// --- tiered prompt composition (the core of the feature) -------------------
class FakeManager extends EventEmitter {
  spawns: { cwd: string; prompt: string; systemPrompt?: string }[] = []
  spawnAgent(req: { cwd: string; prompt: string; systemPrompt?: string }): string {
    const id = `a${this.spawns.length + 1}`
    this.spawns.push(req)
    return id
  }
  pidOf(): number | null {
    return null
  }
  stateOf(): string {
    return 'working'
  }
  appendNote(): void {}
  killAgent(): void {}
  getLog(): unknown[] {
    return []
  }
}
const fake = new FakeManager()
const launcher = new TicketLauncher(
  fake as unknown as AgentManager,
  db,
  () => {},
  new ContractService(db),
  new GitService(),
  undefined,
  memory
)
const ticket = db.createTicket({
  workspaceId: ws.id, title: 'Add tax field', spec: 'Add a tax field to invoices.',
  targetRepoIds: [rB.id, rF.id], orderingMode: 'concurrent'
})
void rF
await launcher.launch(ticket.id)
assert(fake.spawns.length === 2, 'launched one agent per target repo')
const be = fake.spawns.find((s) => s.cwd === backend)!
const fe = fake.spawns.find((s) => s.cwd === frontend)!

assert(be.systemPrompt!.includes(WS_MEM), 'tier 1: workspace memory injected into the prompt')
assert(/CLAUDE\.md/.test(be.systemPrompt!), 'tier 2: references the repo CLAUDE.md')
assert(/do NOT re-explore/i.test(be.systemPrompt!), 'tier 2: tells the agent not to re-explore')
assert(/Verify your change ONCE/i.test(be.systemPrompt!), 'instruction: verify once, then stop')
assert(be.prompt === 'Add a tax field to invoices.', 'tier 4: ticket spec is the -p prompt')
assert(!be.systemPrompt!.includes(CLAUDE), 'CLAUDE.md is referenced, NOT inlined (no double tokens)')

assert(fe.systemPrompt!.includes(WS_MEM), 'tier 1 also injected for the consumer')
assert(
  !/do NOT re-explore/i.test(fe.systemPrompt!),
  'repo without a CLAUDE.md omits the trust/re-explore line'
)

// --- watcher emits on external change --------------------------------------
memory.ensureWatch({ type: 'workspace', id: ws.id })
writeFileSync(join(root, '.pluri', 'memory', 'workspace.md'), `${WS_MEM}\nAdditional note.`)
for (let i = 0; i < 40 && !events.some((e) => e.content.includes('Additional note.')); i++)
  await delay(100)
assert(
  events.some((e) => e.ch === 'memory:update' && e.content.includes('Additional note.')),
  'watcher emits memory:update on an external edit'
)

memory.closeAll()
db.close()
rmSync(root, { recursive: true, force: true })
console.log(fail === 0 ? '\nMemory tests passed ✔' : `\n${fail} memory test(s) failed ✖`)
process.exit(fail ? 1 : 0)
