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
  db.close()
}

cleanup()
console.log(fail === 0 ? '\nDB tests passed ✔' : `\n${fail} DB test(s) failed ✖`)
process.exit(fail ? 1 : 0)
