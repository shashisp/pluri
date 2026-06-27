import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentEventMsg,
  AgentStateMsg,
  SpawnAgentRequest,
  SpawnAgentResult
} from '@shared/types'

/** Subscribe helper that returns an unsubscribe function. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

/** The typed API surface exposed to the renderer as `window.api`. */
const api = {
  spawnAgent: (req: SpawnAgentRequest): Promise<SpawnAgentResult> =>
    ipcRenderer.invoke('agent:spawn', req),

  killAgent: (agentId: string): Promise<void> =>
    ipcRenderer.invoke('agent:kill', agentId),

  onAgentEvent: (cb: (msg: AgentEventMsg) => void): (() => void) =>
    subscribe<AgentEventMsg>('agent:event', cb),

  onAgentState: (cb: (msg: AgentStateMsg) => void): (() => void) =>
    subscribe<AgentStateMsg>('agent:state', cb)
}

export type PluriApi = typeof api

contextBridge.exposeInMainWorld('api', api)
