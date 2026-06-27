import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { AgentManager } from './services/AgentManager'
import type { Db } from './services/db'
import type {
  AddRepoInput,
  AgentEventMsg,
  AgentStateMsg,
  CreateWorkspaceInput,
  GitHost,
  Repo,
  SpawnAgentRequest,
  SpawnAgentResult,
  Workspace,
  WorkspaceWithRepos
} from '@shared/types'

const GIT_HOSTS: GitHost[] = ['github', 'gitlab']

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

/**
 * Wire all privileged work to IPC. The renderer only sends typed requests and
 * subscribes to events; nothing privileged happens in the renderer.
 *
 * @param getWindow accessor for the current main window (events target it).
 * @param db        persistence layer.
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

  // Native folder picker for adding a repo path.
  ipcMain.handle('dialog:pickDirectory', async (): Promise<string | null> => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  return manager
}
