import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { AgentManager } from './services/AgentManager'
import { TicketLauncher } from './services/TicketLauncher'
import { GitService } from './services/GitService'
import { ContractService } from './services/ContractService'
import { MemoryService } from './services/MemoryService'
import type { Db } from './services/db'
import type {
  AddRepoInput,
  AgentEventMsg,
  AgentStateMsg,
  AppSettings,
  CreateTicketInput,
  CreateWorkspaceInput,
  GitHost,
  LaunchResult,
  MemoryScope,
  OrderingMode,
  Repo,
  SpawnAgentRequest,
  SpawnAgentResult,
  Ticket,
  TicketWithAgents,
  Workspace,
  WorkspaceWithRepos
} from '@shared/types'

/** Validate a MemoryScope coming from the (untrusted) renderer. */
function assertMemoryScope(scope: unknown): asserts scope is MemoryScope {
  if (!scope || typeof scope !== 'object') throw new Error('Invalid memory scope')
  const s = scope as Record<string, unknown>
  if (s.type !== 'workspace' && s.type !== 'repo') throw new Error('Invalid scope type')
  if (typeof s.id !== 'string' || !s.id) throw new Error('scope id required')
}

const GIT_HOSTS: GitHost[] = ['github', 'gitlab']
const ORDERING_MODES: OrderingMode[] = ['concurrent', 'producer_first']

/** Validate AddRepoInput coming from the (untrusted) renderer. */
function assertAddRepoInput(input: unknown): asserts input is AddRepoInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid repo input')
  const i = input as Record<string, unknown>
  if (typeof i.workspaceId !== 'string' || !i.workspaceId)
    throw new Error('workspaceId is required')
  if (typeof i.name !== 'string') throw new Error('name must be a string')
  if (typeof i.path !== 'string') throw new Error('path must be a string')
  if (typeof i.defaultBranch !== 'string')
    throw new Error('defaultBranch must be a string')
  if (!GIT_HOSTS.includes(i.gitHost as GitHost))
    throw new Error(`Invalid gitHost: ${String(i.gitHost)}`)
  if (typeof i.isContractProducer !== 'boolean')
    throw new Error('isContractProducer must be a boolean')
}

/** Coerce a settings patch from the (untrusted) renderer into safe values. */
function sanitizeSettingsPatch(patch: unknown): Partial<AppSettings> {
  if (!patch || typeof patch !== 'object') throw new Error('Invalid settings')
  const i = patch as Record<string, unknown>
  const out: Partial<AppSettings> = {}
  if (i.maxConcurrentAgents !== undefined) {
    const n = Math.floor(Number(i.maxConcurrentAgents))
    if (!Number.isFinite(n)) throw new Error('maxConcurrentAgents must be a number')
    out.maxConcurrentAgents = Math.max(1, Math.min(64, n))
  }
  if (i.defaultOrderingMode !== undefined) {
    if (!ORDERING_MODES.includes(i.defaultOrderingMode as OrderingMode))
      throw new Error(`Invalid orderingMode: ${String(i.defaultOrderingMode)}`)
    out.defaultOrderingMode = i.defaultOrderingMode as OrderingMode
  }
  if (i.agentTools !== undefined) {
    if (typeof i.agentTools !== 'string') throw new Error('agentTools must be a string')
    out.agentTools = i.agentTools.trim() || 'Bash,Edit,Read,Write'
  }
  return out
}

/** Validate CreateTicketInput coming from the (untrusted) renderer. */
function assertCreateTicketInput(input: unknown): asserts input is CreateTicketInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid ticket input')
  const i = input as Record<string, unknown>
  if (typeof i.workspaceId !== 'string' || !i.workspaceId)
    throw new Error('workspaceId is required')
  if (typeof i.title !== 'string') throw new Error('title must be a string')
  if (typeof i.spec !== 'string') throw new Error('spec must be a string')
  if (
    !Array.isArray(i.targetRepoIds) ||
    i.targetRepoIds.length === 0 ||
    !i.targetRepoIds.every((x) => typeof x === 'string')
  )
    throw new Error('targetRepoIds must be a non-empty string array')
  if (!ORDERING_MODES.includes(i.orderingMode as OrderingMode))
    throw new Error(`Invalid orderingMode: ${String(i.orderingMode)}`)
}

/**
 * Wire all privileged work to IPC. The renderer only sends typed requests and
 * subscribes to events; nothing privileged happens in the renderer.
 *
 * @returns the AgentManager so the app can killAll() on quit.
 */
export function registerIpc(
  getWindow: () => BrowserWindow | null,
  db: Db
): AgentManager {
  const manager = new AgentManager()

  const send = (channel: string, payload: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  // Launcher updates the DB on agent-state changes, drives push+MR, and rolls
  // tickets up; it emits 'agent:state'/'ticket:state'/'ticket:agents' to the
  // renderer. ContractService owns the shared .pluri/ folder per ticket.
  const git = new GitService()
  const contracts = new ContractService(db)
  const memory = new MemoryService(db, send)
  const launcher = new TicketLauncher(manager, db, send, contracts, git, undefined, memory)

  // Apply the persisted concurrency cap at startup.
  manager.setMaxConcurrent(db.getSettings().maxConcurrentAgents)

  app.on('before-quit', () => {
    contracts.closeAll()
    memory.closeAll()
  })

  manager.on('event', (msg: AgentEventMsg) => send('agent:event', msg))
  manager.on('state', (msg: AgentStateMsg) => send('agent:state', msg))

  // ---- Agents (Phase 1) -----------------------------------------------------
  ipcMain.handle(
    'agent:spawn',
    (_e, req: SpawnAgentRequest): SpawnAgentResult => ({
      agentId: manager.spawnAgent(req)
    })
  )
  ipcMain.handle('agent:kill', (_e, agentId: string): void => {
    manager.killAgent(agentId)
  })
  ipcMain.handle('agent:log', (_e, agentId: string): AgentEventMsg[] =>
    manager.getLog(agentId)
  )
  ipcMain.handle('agent:openMr', (_e, agentId: string): Promise<void> => {
    if (typeof agentId !== 'string') throw new Error('agentId required')
    return launcher.openMr(agentId)
  })
  ipcMain.handle('agent:diff', (_e, agentId: string): Promise<string> => {
    if (typeof agentId !== 'string') throw new Error('agentId required')
    const agent = db.getAgent(agentId)
    if (!agent) throw new Error('Agent not found')
    return git.diff(agent.repoPath, agent.defaultBranch, agent.branch ?? agent.defaultBranch)
  })

  // ---- Workspaces / Repos (Phase 2) ----------------------------------------
  ipcMain.handle('workspace:list', (): WorkspaceWithRepos[] =>
    db.listWorkspacesWithRepos()
  )
  ipcMain.handle('workspace:create', (_e, input: CreateWorkspaceInput): Workspace => {
    if (!input || typeof input.name !== 'string')
      throw new Error('Invalid workspace input')
    return db.createWorkspace(input)
  })
  ipcMain.handle('repo:add', (_e, input: unknown): Repo => {
    assertAddRepoInput(input)
    return db.addRepo(input)
  })
  ipcMain.handle('dialog:pickDirectory', async (): Promise<string | null> => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Open an MR/PR (or any http) link in the OS browser.
  ipcMain.handle('app:openExternal', (_e, url: string): void => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url)
  })

  // ---- Tickets (Phase 3) ----------------------------------------------------
  ipcMain.handle('ticket:list', (_e, workspaceId: string): TicketWithAgents[] => {
    if (typeof workspaceId !== 'string') throw new Error('workspaceId required')
    return db.listTicketsWithAgents(workspaceId)
  })
  ipcMain.handle('ticket:create', (_e, input: unknown): Ticket => {
    assertCreateTicketInput(input)
    return db.createTicket(input)
  })
  ipcMain.handle(
    'ticket:get',
    (_e, ticketId: string): TicketWithAgents | null =>
      db.getTicketWithAgents(ticketId)
  )
  ipcMain.handle('ticket:launch', (_e, ticketId: string): Promise<LaunchResult> => {
    if (typeof ticketId !== 'string') throw new Error('ticketId required')
    return launcher.launch(ticketId)
  })
  ipcMain.handle('ticket:markDone', (_e, ticketId: string): void => {
    if (typeof ticketId !== 'string') throw new Error('ticketId required')
    db.setTicketState(ticketId, 'done')
    send('ticket:state', { ticketId, state: 'done' })
  })

  // ---- Settings (Phase 6) ---------------------------------------------------
  ipcMain.handle('settings:get', (): AppSettings => db.getSettings())
  ipcMain.handle('settings:set', (_e, patch: unknown): AppSettings => {
    const saved = db.saveSettings(sanitizeSettingsPatch(patch))
    manager.setMaxConcurrent(saved.maxConcurrentAgents)
    return saved
  })

  // ---- Memory (context subsystem) -------------------------------------------
  ipcMain.handle('memory:read', (_e, scope: unknown): Promise<string> => {
    assertMemoryScope(scope)
    memory.ensureWatch(scope) // live updates for the Memory tab
    return memory.read(scope)
  })
  ipcMain.handle('memory:write', (_e, scope: unknown, content: unknown): Promise<void> => {
    assertMemoryScope(scope)
    if (typeof content !== 'string') throw new Error('content must be a string')
    return memory.write(scope, content)
  })

  // ---- Contract (Phase 5) ---------------------------------------------------
  ipcMain.handle('contract:read', (_e, ticketId: string): Promise<string> => {
    if (typeof ticketId !== 'string') throw new Error('ticketId required')
    // Watch only this ticket (the UI views one at a time) for live updates.
    contracts.watchOnly(ticketId, (content) =>
      send('contract:update', { ticketId, content })
    )
    return contracts.read(ticketId)
  })

  return manager
}
