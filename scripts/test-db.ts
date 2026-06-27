// Persistence test for the SQLite layer. better-sqlite3 is compiled for
// Electron's ABI, so this runs under Electron's runtime (ELECTRON_RUN_AS_NODE)
// rather than plain node. See npm run test:db.
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Db } from '../src/main/services/db'

const file = join(tmpdir(), `pluri-test-${process.pid}.db`)
const cleanup = (): void =>
  [file, `${file}-wal`, `${file}-shm`].forEach((f) => existsSync(f) && rmSync(f))
cleanup()

let fail = 0
function assert(cond: boolean, msg: string): void {
  console.log(`${cond ? '  ok   ' : '  FAIL '}${msg}`)
  if (!cond) fail++
}

// --- Session 1: write -------------------------------------------------------
{
  const db = new Db(file)
  const ws = db.createWorkspace({ name: 'Acme' })
  assert(Boolean(ws.id), 'workspace created with id')

  const backend = db.addRepo({
    workspaceId: ws.id,
    name: 'backend',
    path: '/tmp/backend',
    gitHost: 'github',
    defaultBranch: 'main',
    isContractProducer: true
  })
  db.addRepo({
    workspaceId: ws.id,
    name: 'frontend',
    path: '/tmp/frontend',
    gitHost: 'gitlab',
    defaultBranch: 'develop',
    isContractProducer: false
  })
  assert(backend.isContractProducer === true, 'producer boolean on returned object')

  let threw = false
  try {
    db.addRepo({
      workspaceId: 'does-not-exist',
      name: 'x',
      path: '/x',
      gitHost: 'github',
      defaultBranch: 'main',
      isContractProducer: false
    })
  } catch {
    threw = true
  }
  assert(threw, 'addRepo rejects unknown workspace')

  db.close()
}

// --- Session 2: reopen, verify it persisted ---------------------------------
{
  const db = new Db(file)
  const all = db.listWorkspacesWithRepos()
  assert(all.length === 1, 'workspace persisted across reopen')
  assert(all[0]?.name === 'Acme', 'workspace name persisted')
  assert(all[0]?.repos.length === 2, 'both repos persisted')

  const backend = all[0]?.repos.find((r) => r.name === 'backend')
  const frontend = all[0]?.repos.find((r) => r.name === 'frontend')
  assert(backend?.isContractProducer === true, 'producer=true persisted as boolean')
  assert(frontend?.isContractProducer === false, 'producer=false persisted as boolean')
  assert(
    frontend?.gitHost === 'gitlab' && frontend?.defaultBranch === 'develop',
    'repo gitHost/defaultBranch persisted'
  )

  // --- Tickets + agents (Phase 3) -------------------------------------------
  const wsId = all[0]!.id
  const backendId = backend!.id
  const frontendId = frontend!.id

  const ticket = db.createTicket({
    workspaceId: wsId,
    title: 'Add login page',
    spec: 'Implement login across repos.',
    targetRepoIds: [backendId, frontendId],
    orderingMode: 'producer_first'
  })
  assert(ticket.state === 'draft', 'new ticket starts as draft')
  assert(ticket.orderingMode === 'producer_first', 'orderingMode stored')

  const got = db.getTicket(ticket.id)
  assert(got?.targetRepoIds.length === 2, 'targetRepoIds JSON round-trips')
  assert(
    JSON.stringify(got?.targetRepoIds) === JSON.stringify([backendId, frontendId]),
    'targetRepoIds preserve order/content'
  )

  // Simulate a launch: two agents, then drive them to terminal states.
  db.insertAgent({
    id: 'agent-be',
    ticketId: ticket.id,
    repoId: backendId,
    branch: 'ticket-x-add-login',
    pid: 1234,
    state: 'working',
    mrUrl: null,
    startedAt: Date.now(),
    endedAt: null
  })
  db.insertAgent({
    id: 'agent-fe',
    ticketId: ticket.id,
    repoId: frontendId,
    branch: 'ticket-x-add-login',
    pid: 1235,
    state: 'working',
    mrUrl: null,
    startedAt: Date.now(),
    endedAt: null
  })

  let agents = db.listAgentsByTicket(ticket.id)
  assert(agents.length === 2, 'two agents listed for ticket')
  assert(
    agents.every((a) => a.repoName === 'backend' || a.repoName === 'frontend'),
    'agent rows join repo name'
  )
  assert(agents[0]?.repoPath !== undefined, 'agent join includes repo path')

  // Rollup logic mirror: not all terminal yet.
  db.setAgentState('agent-be', 'done', { endedAt: Date.now() })
  agents = db.listAgentsByTicket(ticket.id)
  const allTerminal1 = agents.every((a) =>
    ['done', 'error', 'killed', 'mr_open'].includes(a.state)
  )
  assert(!allTerminal1, 'ticket not all-terminal while one agent works')

  db.setAgentState('agent-fe', 'error', { endedAt: Date.now() })
  agents = db.listAgentsByTicket(ticket.id)
  const allTerminal2 = agents.every((a) =>
    ['done', 'error', 'killed', 'mr_open'].includes(a.state)
  )
  assert(allTerminal2, 'ticket all-terminal once both agents finish')

  db.setTicketState(ticket.id, 'awaiting_review')
  assert(
    db.getTicket(ticket.id)?.state === 'awaiting_review',
    'ticket state transitions to awaiting_review'
  )

  // Relaunch replaces prior agents.
  db.deleteAgentsForTicket(ticket.id)
  assert(
    db.listAgentsByTicket(ticket.id).length === 0,
    'deleteAgentsForTicket clears agents for relaunch'
  )

  const withAgents = db.listTicketsWithAgents(wsId)
  assert(withAgents.length === 1, 'listTicketsWithAgents returns the ticket')

  db.close()
}

cleanup()
console.log(fail === 0 ? '\nDB tests passed ✔' : `\n${fail} DB test(s) failed ✖`)
process.exit(fail ? 1 : 0)
