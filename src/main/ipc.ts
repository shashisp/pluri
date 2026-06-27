import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { AgentManager } from './services/AgentManager'
import { TicketLauncher } from './services/TicketLauncher'
import type { Db } from './services/db'
import type {
  AddRepoInput,
  AgentEventMsg,
  AgentStateMsg,
  CreateTicketInput,
  CreateWorkspaceInput,
  GitHost,
  LaunchResult,
  OrderingMode,
  Repo,
  SpawnAgentRequest,
  SpawnAgentResult,
  Ticket,
  TicketWithAgents,
  Workspace,
  WorkspaceWithRepos
} from '@shared/types'

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

  // Launcher updates the DB on agent-state changes and rolls tickets up; it also
  // emits 'ticket:state' straight to the renderer via `send`.
  const launcher = new TicketLauncher(manager, db, send)

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
  ipcMain.handle('ticket:launch', (_e, ticketId: string): LaunchResult => {
    if (typeof ticketId !== 'string') throw new Error('ticketId required')
    return launcher.launch(ticketId)
  })
  ipcMain.handle('ticket:markDone', (_e, ticketId: string): void => {
    if (typeof ticketId !== 'string') throw new Error('ticketId required')
    db.setTicketState(ticketId, 'done')
    send('ticket:state', { ticketId, state: 'done' })
  })

  return manager
}
