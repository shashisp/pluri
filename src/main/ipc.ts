import { ipcMain, type BrowserWindow } from 'electron'
import { AgentManager } from './services/AgentManager'
import type {
  AgentEventMsg,
  AgentStateMsg,
  SpawnAgentRequest,
  SpawnAgentResult
} from '@shared/types'

/**
 * Wire the AgentManager to IPC. All privileged work lives here in main; the
 * renderer only sends typed requests and subscribes to events.
 *
 * @param getWindow accessor for the current main window (events are sent to it).
 * @returns the AgentManager so the app can killAll() on quit.
 */
export function registerIpc(getWindow: () => BrowserWindow | null): AgentManager {
  const manager = new AgentManager()

  const send = (channel: string, payload: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  manager.on('event', (msg: AgentEventMsg) => send('agent:event', msg))
  manager.on('state', (msg: AgentStateMsg) => send('agent:state', msg))

  ipcMain.handle(
    'agent:spawn',
    (_e, req: SpawnAgentRequest): SpawnAgentResult => ({
      agentId: manager.spawnAgent(req)
    })
  )

  ipcMain.handle('agent:kill', (_e, agentId: string): void => {
    manager.killAgent(agentId)
  })

  return manager
}
