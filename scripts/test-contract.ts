// ContractService unit tests + producer_first ordering (with a fake AgentManager
// so no real `claude` runs) against real git repos + fs + DB. Electron ABI.
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Db } from '../src/main/services/db'
import { ContractService, commonAncestor } from '../src/main/services/ContractService'
import { TicketLauncher } from '../src/main/services/TicketLauncher'
import { GitService } from '../src/main/services/GitService'
import type { AgentManager } from '../src/main/services/AgentManager'

let fail = 0
const assert = (c: boolean, m: string): void => {
  console.log(`${c ? '  ok   ' : '  FAIL '}${m}`)
  if (!c) fail++
}
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// commonAncestor unit.
assert(commonAncestor(['/a/b/x', '/a/b/y']) === '/a/b', 'commonAncestor of siblings')
assert(commonAncestor(['/a/b/x', '/a/c/y']) === '/a', 'commonAncestor diverging')
assert(commonAncestor(['/a/b/repo']) === '/a/b', 'commonAncestor single -> parent')

// Real git repos under a common parent.
const root = mkdtempSync(join(tmpdir(), 'pluri-contract-'))
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
const ws = db.createWorkspace({ name: 'W' })
const rBackend = db.addRepo({
  workspaceId: ws.id, name: 'backend', path: backend,
  gitHost: 'github', defaultBranch: 'main', isContractProducer: true
})
db.addRepo({
  workspaceId: ws.id, name: 'frontend', path: frontend,
  gitHost: 'github', defaultBranch: 'main', isContractProducer: false
})
const ticket = db.createTicket({
  workspaceId: ws.id, title: 'Add login', spec: 'Implement login.',
  targetRepoIds: [rBackend.id, db.listRepos(ws.id).find((r) => r.name === 'frontend')!.id],
  orderingMode: 'producer_first'
})

const contracts = new ContractService(db)

// init creates the folder structure.
const initRes = await contracts.init(ticket.id, db.getTicket(ticket.id)!)
assert(initRes.contractPath !== null, 'init returns a contract path')
assert(existsSync(join(root, '.pluri', 'tickets', ticket.id, 'ticket.md')), 'ticket.md created')
assert(existsSync(join(root, '.pluri', 'tickets', ticket.id, 'status')), 'status/ created')
assert((await contracts.read(ticket.id)) === '', 'contract empty initially')
assert((await contracts.hasContract(ticket.id)) === false, 'hasContract false initially')

// watch fires when contract.md changes.
let watched = ''
const stop = contracts.watchOnly(ticket.id, (c) => {
  watched = c
})
writeFileSync(initRes.contractPath!, '# API\nGET /login\n')
for (let i = 0; i < 30 && !watched; i++) await delay(100)
assert(/GET \/login/.test(watched), 'watch reports contract.md content')
stop()
assert((await contracts.hasContract(ticket.id)) === true, 'hasContract true after write')

// Nested repos: .pluri would land inside a repo -> contract disabled.
{
  const wsN = db.createWorkspace({ name: 'N' })
  const mono = join(root, 'mono')
  mkdirSync(join(mono, 'pkg'), { recursive: true })
  const rX = db.addRepo({
    workspaceId: wsN.id, name: 'mono', path: mono,
    gitHost: 'github', defaultBranch: 'main', isContractProducer: true
  })
  const rY = db.addRepo({
    workspaceId: wsN.id, name: 'pkg', path: join(mono, 'pkg'),
    gitHost: 'github', defaultBranch: 'main', isContractProducer: false
  })
  const tN = db.createTicket({
    workspaceId: wsN.id, title: 'N', spec: 'x',
    targetRepoIds: [rX.id, rY.id], orderingMode: 'concurrent'
  })
  const initN = await contracts.init(tN.id, db.getTicket(tN.id)!)
  assert(initN.contractPath === null, 'nested repos -> contract sharing disabled')
}

// reset contract for the ordering test.
writeFileSync(initRes.contractPath!, '')

// --- producer_first ordering with a fake AgentManager ----------------------
class FakeManager extends EventEmitter {
  spawns: { cwd: string; systemPrompt?: string }[] = []
  spawnAgent(req: { cwd: string; systemPrompt?: string }): string {
    const id = `agent-${this.spawns.length + 1}`
    this.spawns.push({ cwd: req.cwd, systemPrompt: req.systemPrompt })
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
const events: { channel: string; payload: unknown }[] = []
const launcher = new TicketLauncher(
  fake as unknown as AgentManager,
  db,
  (channel, payload) => events.push({ channel, payload }),
  contracts,
  new GitService()
)

await launcher.launch(ticket.id)
// Only the producer should have spawned so far.
assert(fake.spawns.length === 1, 'producer_first spawns producer first (1 agent)')
assert(fake.spawns[0]?.cwd === backend, 'first spawn is the producer (backend)')
assert(
  /CONTRACT PRODUCER/.test(fake.spawns[0]?.systemPrompt ?? ''),
  'producer prompt instructs writing the contract'
)
assert(db.listAgentsByTicket(ticket.id).length === 1, 'only producer persisted before contract')

// Producer "writes" the contract -> consumers should spawn.
writeFileSync(initRes.contractPath!, '# API\nPOST /session\n')
for (let i = 0; i < 60 && fake.spawns.length < 2; i++) await delay(100)
assert(fake.spawns.length === 2, 'consumer spawns after contract.md is written')
assert(fake.spawns[1]?.cwd === frontend, 'second spawn is the consumer (frontend)')
assert(
  /POST \/session/.test(fake.spawns[1]?.systemPrompt ?? '') &&
    /already been defined/.test(fake.spawns[1]?.systemPrompt ?? ''),
  'consumer prompt has the contract content injected'
)
assert(
  events.some((e) => e.channel === 'ticket:agents'),
  'ticket:agents emitted when consumers spawn'
)

const ticketMd = readFileSync(join(root, '.pluri', 'tickets', ticket.id, 'ticket.md'), 'utf8')
assert(/Add login/.test(ticketMd) && /Implement login/.test(ticketMd), 'ticket.md has title + spec')

contracts.closeAll()
db.close()
rmSync(root, { recursive: true, force: true })
console.log(fail === 0 ? '\nContract tests passed ✔' : `\n${fail} contract test(s) failed ✖`)
process.exit(fail ? 1 : 0)
