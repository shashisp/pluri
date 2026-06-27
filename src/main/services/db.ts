import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type {
  AddRepoInput,
  CreateWorkspaceInput,
  GitHost,
  Repo,
  Workspace,
  WorkspaceWithRepos
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
    `)
  }

  // ---- Workspaces -----------------------------------------------------------

  listWorkspaces(): Workspace[] {
    return this.db
      .prepare('SELECT id, name, createdAt FROM Workspace ORDER BY createdAt ASC')
      .all() as Workspace[]
  }

  createWorkspace(input: CreateWorkspaceInput): Workspace {
    const name = input.name.trim()
    if (!name) throw new Error('Workspace name is required')
    const ws: Workspace = { id: randomUUID(), name, createdAt: Date.now() }
    this.db
      .prepare('INSERT INTO Workspace (id, name, createdAt) VALUES (?, ?, ?)')
      .run(ws.id, ws.name, ws.createdAt)
    return ws
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
      isContractProducer: row.isContractProducer === 1
    }
  }

  listRepos(workspaceId: string): Repo[] {
    const rows = this.db
      .prepare(
        'SELECT id, workspaceId, name, path, gitHost, defaultBranch, isContractProducer FROM Repo WHERE workspaceId = ? ORDER BY name ASC'
      )
      .all(workspaceId) as RepoRow[]
    return rows.map((r) => this.rowToRepo(r))
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
      isContractProducer: input.isContractProducer
    }
    this.db
      .prepare(
        'INSERT INTO Repo (id, workspaceId, name, path, gitHost, defaultBranch, isContractProducer) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        repo.id,
        repo.workspaceId,
        repo.name,
        repo.path,
        repo.gitHost,
        repo.defaultBranch,
        repo.isContractProducer ? 1 : 0
      )
    return repo
  }

  // ---- Composite reads ------------------------------------------------------

  listWorkspacesWithRepos(): WorkspaceWithRepos[] {
    return this.listWorkspaces().map((ws) => ({
      ...ws,
      repos: this.listRepos(ws.id)
    }))
  }

  close(): void {
    this.db.close()
  }
}
