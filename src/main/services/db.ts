import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  type AddRepoInput,
  type AgentRecord,
  type AgentState,
  type AgentWithRepo,
  type AppSettings,
  type CreateTicketInput,
  type CreateWorkspaceInput,
  type GitHost,
  type OrderingMode,
  type Repo,
  type Ticket,
  type TicketState,
  type TicketWithAgents,
  type Workspace,
  type WorkspaceWithRepos
} from '@shared/types'

// Raw row shapes (SQLite stores booleans as 0/1).
interface RepoRow {
  id: string
  workspaceId: string
  name: string
  path: string
  gitHost: string
  defaultBranch: string
  isContractProducer: number
  claudeMdPath: string | null
  indexedAt: number | null
}

interface TicketRow {
  id: string
  workspaceId: string
  title: string
  spec: string
  targetRepoIds: string
  state: string
  orderingMode: string
  createdAt: number
}

interface AgentRow {
  id: string
  ticketId: string
  repoId: string
  branch: string | null
  pid: number | null
  state: string
  mrUrl: string | null
  startedAt: number | null
  endedAt: number | null
}

interface AgentWithRepoRow extends AgentRow {
  repoName: string
  repoPath: string
  gitHost: string
  defaultBranch: string
}

/**
 * Synchronous SQLite persistence (better-sqlite3). Electron-free on purpose —
 * the caller passes the file path — so the schema and CRUD can be exercised
 * headlessly (see scripts/test-db.mjs run under ELECTRON_RUN_AS_NODE).
 *
 * NOTE: the native binary must match Electron's ABI; `npm run rebuild`
 * (electron-rebuild) handles that, and it runs automatically on postinstall.
 */
export class Db {
  private db: Database.Database

  constructor(filePath: string) {
    this.db = new Database(filePath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    // All four tables are created now; only Workspace/Repo are wired in Phase 2.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS Workspace (
        id        TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS Repo (
        id                 TEXT PRIMARY KEY,
        workspaceId        TEXT NOT NULL REFERENCES Workspace(id) ON DELETE CASCADE,
        name               TEXT NOT NULL,
        path               TEXT NOT NULL,
        gitHost            TEXT NOT NULL CHECK (gitHost IN ('github', 'gitlab')),
        defaultBranch      TEXT NOT NULL,
        isContractProducer INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_repo_workspace ON Repo(workspaceId);

      CREATE TABLE IF NOT EXISTS Ticket (
        id            TEXT PRIMARY KEY,
        workspaceId   TEXT NOT NULL REFERENCES Workspace(id) ON DELETE CASCADE,
        title         TEXT NOT NULL,
        spec          TEXT NOT NULL,
        targetRepoIds TEXT NOT NULL,
        state         TEXT NOT NULL,
        createdAt     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ticket_workspace ON Ticket(workspaceId);

      CREATE TABLE IF NOT EXISTS Agent (
        id        TEXT PRIMARY KEY,
        ticketId  TEXT NOT NULL REFERENCES Ticket(id) ON DELETE CASCADE,
        repoId    TEXT NOT NULL REFERENCES Repo(id) ON DELETE CASCADE,
        branch    TEXT,
        pid       INTEGER,
        state     TEXT NOT NULL,
        mrUrl     TEXT,
        startedAt INTEGER,
        endedAt   INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_agent_ticket ON Agent(ticketId);

      CREATE TABLE IF NOT EXISTS Setting (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

    // Incremental migrations for DBs created by an earlier phase. The Ticket
    // table existed in Phase 2 without orderingMode, so add it idempotently.
    this.ensureColumn('Ticket', 'orderingMode', "TEXT NOT NULL DEFAULT 'concurrent'")
    // Memory subsystem pointers (added later; no prose in the DB).
    this.ensureColumn('Workspace', 'memoryPath', 'TEXT')
    this.ensureColumn('Repo', 'claudeMdPath', 'TEXT')
    this.ensureColumn('Repo', 'indexedAt', 'INTEGER')
  }

  /** Add a column if it doesn't already exist (CREATE TABLE IF NOT EXISTS won't). */
  private ensureColumn(table: string, column: string, definition: string): void {
    const cols = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }

  // ---- Workspaces -----------------------------------------------------------

  listWorkspaces(): Workspace[] {
    return this.db
      .prepare('SELECT id, name, createdAt, memoryPath FROM Workspace ORDER BY createdAt ASC')
      .all() as Workspace[]
  }

  createWorkspace(input: CreateWorkspaceInput): Workspace {
    const name = input.name.trim()
    if (!name) throw new Error('Workspace name is required')
    const ws: Workspace = { id: randomUUID(), name, createdAt: Date.now(), memoryPath: null }
    this.db
      .prepare('INSERT INTO Workspace (id, name, createdAt) VALUES (?, ?, ?)')
      .run(ws.id, ws.name, ws.createdAt)
    return ws
  }

  setWorkspaceMemoryPath(workspaceId: string, memoryPath: string): void {
    this.db
      .prepare('UPDATE Workspace SET memoryPath = ? WHERE id = ?')
      .run(memoryPath, workspaceId)
  }

  // ---- Repos ----------------------------------------------------------------

  private rowToRepo(row: RepoRow): Repo {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      path: row.path,
      gitHost: row.gitHost as GitHost,
      defaultBranch: row.defaultBranch,
      isContractProducer: row.isContractProducer === 1,
      claudeMdPath: row.claudeMdPath ?? null,
      indexedAt: row.indexedAt ?? null
    }
  }

  private static REPO_COLS =
    'id, workspaceId, name, path, gitHost, defaultBranch, isContractProducer, claudeMdPath, indexedAt'

  listRepos(workspaceId: string): Repo[] {
    const rows = this.db
      .prepare(`SELECT ${Db.REPO_COLS} FROM Repo WHERE workspaceId = ? ORDER BY name ASC`)
      .all(workspaceId) as RepoRow[]
    return rows.map((r) => this.rowToRepo(r))
  }

  getRepo(id: string): Repo | null {
    const row = this.db
      .prepare(`SELECT ${Db.REPO_COLS} FROM Repo WHERE id = ?`)
      .get(id) as RepoRow | undefined
    return row ? this.rowToRepo(row) : null
  }

  setRepoIndexed(repoId: string, indexedAt: number, claudeMdPath: string): void {
    this.db
      .prepare('UPDATE Repo SET indexedAt = ?, claudeMdPath = ? WHERE id = ?')
      .run(indexedAt, claudeMdPath, repoId)
  }

  addRepo(input: AddRepoInput): Repo {
    const name = input.name.trim()
    const path = input.path.trim()
    if (!name) throw new Error('Repo name is required')
    if (!path) throw new Error('Repo path is required')

    const exists = this.db
      .prepare('SELECT 1 FROM Workspace WHERE id = ?')
      .get(input.workspaceId)
    if (!exists) throw new Error('Workspace not found')

    const repo: Repo = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name,
      path,
      gitHost: input.gitHost,
      defaultBranch: input.defaultBranch.trim() || 'main',
      isContractProducer: input.isContractProducer,
      claudeMdPath: join(path, 'CLAUDE.md'),
      indexedAt: null
    }
    this.db
      .prepare(
        'INSERT INTO Repo (id, workspaceId, name, path, gitHost, defaultBranch, isContractProducer, claudeMdPath) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        repo.id,
        repo.workspaceId,
        repo.name,
        repo.path,
        repo.gitHost,
        repo.defaultBranch,
        repo.isContractProducer ? 1 : 0,
        repo.claudeMdPath
      )
    return repo
  }

  // ---- Tickets --------------------------------------------------------------

  private rowToTicket(row: TicketRow): Ticket {
    let targetRepoIds: string[] = []
    try {
      const parsed = JSON.parse(row.targetRepoIds)
      if (Array.isArray(parsed)) targetRepoIds = parsed.filter((x) => typeof x === 'string')
    } catch {
      targetRepoIds = []
    }
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      title: row.title,
      spec: row.spec,
      targetRepoIds,
      state: row.state as TicketState,
      orderingMode: row.orderingMode as OrderingMode,
      createdAt: row.createdAt
    }
  }

  createTicket(input: CreateTicketInput): Ticket {
    const title = input.title.trim()
    if (!title) throw new Error('Ticket title is required')
    if (!Array.isArray(input.targetRepoIds) || input.targetRepoIds.length === 0)
      throw new Error('A ticket must target at least one repo')

    const ticket: Ticket = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      title,
      spec: input.spec,
      targetRepoIds: input.targetRepoIds,
      state: 'draft',
      orderingMode: input.orderingMode,
      createdAt: Date.now()
    }
    this.db
      .prepare(
        'INSERT INTO Ticket (id, workspaceId, title, spec, targetRepoIds, state, orderingMode, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        ticket.id,
        ticket.workspaceId,
        ticket.title,
        ticket.spec,
        JSON.stringify(ticket.targetRepoIds),
        ticket.state,
        ticket.orderingMode,
        ticket.createdAt
      )
    return ticket
  }

  getTicket(id: string): Ticket | null {
    const row = this.db.prepare('SELECT * FROM Ticket WHERE id = ?').get(id) as
      | TicketRow
      | undefined
    return row ? this.rowToTicket(row) : null
  }

  listTickets(workspaceId: string): Ticket[] {
    const rows = this.db
      .prepare('SELECT * FROM Ticket WHERE workspaceId = ? ORDER BY createdAt DESC')
      .all(workspaceId) as TicketRow[]
    return rows.map((r) => this.rowToTicket(r))
  }

  setTicketState(id: string, state: TicketState): void {
    this.db.prepare('UPDATE Ticket SET state = ? WHERE id = ?').run(state, id)
  }

  // ---- Agents ---------------------------------------------------------------

  private rowToAgentWithRepo(row: AgentWithRepoRow): AgentWithRepo {
    return {
      id: row.id,
      ticketId: row.ticketId,
      repoId: row.repoId,
      branch: row.branch,
      pid: row.pid,
      state: row.state as AgentState,
      mrUrl: row.mrUrl,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      repoName: row.repoName,
      repoPath: row.repoPath,
      gitHost: row.gitHost as GitHost,
      defaultBranch: row.defaultBranch
    }
  }

  insertAgent(rec: AgentRecord): void {
    this.db
      .prepare(
        'INSERT INTO Agent (id, ticketId, repoId, branch, pid, state, mrUrl, startedAt, endedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        rec.id,
        rec.ticketId,
        rec.repoId,
        rec.branch,
        rec.pid,
        rec.state,
        rec.mrUrl,
        rec.startedAt,
        rec.endedAt
      )
  }

  /** Update an agent's state and any of the optional fields supplied. */
  setAgentState(
    id: string,
    state: AgentState,
    fields: Partial<Pick<AgentRecord, 'mrUrl' | 'endedAt' | 'pid' | 'branch'>> = {}
  ): void {
    const sets = ['state = @state']
    const params: Record<string, unknown> = { id, state }
    for (const key of ['mrUrl', 'endedAt', 'pid', 'branch'] as const) {
      if (key in fields && fields[key] !== undefined) {
        sets.push(`${key} = @${key}`)
        params[key] = fields[key]
      }
    }
    this.db.prepare(`UPDATE Agent SET ${sets.join(', ')} WHERE id = @id`).run(params)
  }

  getAgent(id: string): AgentWithRepo | null {
    const row = this.db
      .prepare(
        `SELECT a.*, r.name AS repoName, r.path AS repoPath, r.gitHost AS gitHost, r.defaultBranch AS defaultBranch
         FROM Agent a JOIN Repo r ON a.repoId = r.id WHERE a.id = ?`
      )
      .get(id) as AgentWithRepoRow | undefined
    return row ? this.rowToAgentWithRepo(row) : null
  }

  listAgentsByTicket(ticketId: string): AgentWithRepo[] {
    const rows = this.db
      .prepare(
        `SELECT a.*, r.name AS repoName, r.path AS repoPath, r.gitHost AS gitHost, r.defaultBranch AS defaultBranch
         FROM Agent a JOIN Repo r ON a.repoId = r.id
         WHERE a.ticketId = ? ORDER BY r.name ASC`
      )
      .all(ticketId) as AgentWithRepoRow[]
    return rows.map((r) => this.rowToAgentWithRepo(r))
  }

  /** Replace any agents of a ticket (a fresh launch supersedes prior agents). */
  deleteAgentsForTicket(ticketId: string): void {
    this.db.prepare('DELETE FROM Agent WHERE ticketId = ?').run(ticketId)
  }

  // ---- Composite reads ------------------------------------------------------

  listWorkspacesWithRepos(): WorkspaceWithRepos[] {
    return this.listWorkspaces().map((ws) => ({
      ...ws,
      repos: this.listRepos(ws.id)
    }))
  }

  listTicketsWithAgents(workspaceId: string): TicketWithAgents[] {
    return this.listTickets(workspaceId).map((t) => ({
      ...t,
      agents: this.listAgentsByTicket(t.id)
    }))
  }

  getTicketWithAgents(id: string): TicketWithAgents | null {
    const ticket = this.getTicket(id)
    if (!ticket) return null
    return { ...ticket, agents: this.listAgentsByTicket(id) }
  }

  // ---- Settings -------------------------------------------------------------

  getSettings(): AppSettings {
    const row = this.db.prepare("SELECT value FROM Setting WHERE key = 'app'").get() as
      | { value: string }
      | undefined
    if (!row) return { ...DEFAULT_SETTINGS }
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<AppSettings>) }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  saveSettings(patch: Partial<AppSettings>): AppSettings {
    const merged: AppSettings = { ...this.getSettings(), ...patch }
    this.db
      .prepare("INSERT INTO Setting (key, value) VALUES ('app', @v) ON CONFLICT(key) DO UPDATE SET value = @v")
      .run({ v: JSON.stringify(merged) })
    return merged
  }

  // ---- Startup reconciliation -----------------------------------------------

  /**
   * Agents left non-terminal in the DB (idle/working/awaiting_mr) are stale on
   * startup — their processes died with the previous app session. Mark them
   * errored and roll up any 'running' ticket whose agents are now all settled.
   */
  reconcileInterrupted(): void {
    const now = Date.now()
    this.db
      .prepare(
        "UPDATE Agent SET state = 'error', endedAt = COALESCE(endedAt, ?) WHERE state IN ('idle', 'working', 'awaiting_mr')"
      )
      .run(now)

    const settled = ['mr_open', 'done', 'error', 'killed']
    const running = this.db
      .prepare("SELECT id FROM Ticket WHERE state = 'running'")
      .all() as Array<{ id: string }>
    for (const { id } of running) {
      const ticket = this.getTicket(id)
      if (!ticket) continue
      const agents = this.listAgentsByTicket(id)
      // Fewer recorded agents than target repos => the launch was interrupted
      // mid-fan-out (e.g. producer_first quit before consumers spawned, or a
      // crash between marking 'running' and the first insert). Don't roll it up
      // as complete — reset to draft so it can be relaunched cleanly.
      if (agents.length < ticket.targetRepoIds.length) {
        this.setTicketState(id, 'draft')
      } else if (agents.length > 0 && agents.every((a) => settled.includes(a.state))) {
        this.setTicketState(id, 'awaiting_review')
      }
    }
  }

  close(): void {
    this.db.close()
  }
}
