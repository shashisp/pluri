import { contextBridge, ipcRenderer } from 'electron'
import type {
  AddRepoInput,
  AgentEventMsg,
  AgentStateMsg,
  AppSettings,
  ContractUpdateMsg,
  MemoryScope,
  MemoryUpdateMsg,
  CreateTicketInput,
  CreateWorkspaceInput,
  LaunchResult,
  Repo,
  SpawnAgentRequest,
  SpawnAgentResult,
  Ticket,
  TicketAgentsMsg,
  TicketStateMsg,
  TicketWithAgents,
  Workspace,
  WorkspaceWithRepos
} from '@shared/types'

/** Subscribe helper that returns an unsubscribe function. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

/** The typed API surface exposed to the renderer as `window.api`. */
const api = {
  // Agents (Phase 1)
  spawnAgent: (req: SpawnAgentRequest): Promise<SpawnAgentResult> =>
    ipcRenderer.invoke('agent:spawn', req),
  killAgent: (agentId: string): Promise<void> =>
    ipcRenderer.invoke('agent:kill', agentId),
  getAgentLog: (agentId: string): Promise<AgentEventMsg[]> =>
    ipcRenderer.invoke('agent:log', agentId),
  openMr: (agentId: string): Promise<void> =>
    ipcRenderer.invoke('agent:openMr', agentId),
  agentDiff: (agentId: string): Promise<string> =>
    ipcRenderer.invoke('agent:diff', agentId),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('app:openExternal', url),
  onAgentEvent: (cb: (msg: AgentEventMsg) => void): (() => void) =>
    subscribe<AgentEventMsg>('agent:event', cb),
  onAgentState: (cb: (msg: AgentStateMsg) => void): (() => void) =>
    subscribe<AgentStateMsg>('agent:state', cb),

  // Workspaces / repos (Phase 2)
  listWorkspaces: (): Promise<WorkspaceWithRepos[]> =>
    ipcRenderer.invoke('workspace:list'),
  createWorkspace: (input: CreateWorkspaceInput): Promise<Workspace> =>
    ipcRenderer.invoke('workspace:create', input),
  addRepo: (input: AddRepoInput): Promise<Repo> =>
    ipcRenderer.invoke('repo:add', input),
  pickDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pickDirectory'),

  // Tickets (Phase 3)
  listTickets: (workspaceId: string): Promise<TicketWithAgents[]> =>
    ipcRenderer.invoke('ticket:list', workspaceId),
  createTicket: (input: CreateTicketInput): Promise<Ticket> =>
    ipcRenderer.invoke('ticket:create', input),
  getTicket: (ticketId: string): Promise<TicketWithAgents | null> =>
    ipcRenderer.invoke('ticket:get', ticketId),
  launchTicket: (ticketId: string): Promise<LaunchResult> =>
    ipcRenderer.invoke('ticket:launch', ticketId),
  markTicketDone: (ticketId: string): Promise<void> =>
    ipcRenderer.invoke('ticket:markDone', ticketId),
  onTicketState: (cb: (msg: TicketStateMsg) => void): (() => void) =>
    subscribe<TicketStateMsg>('ticket:state', cb),
  onTicketAgents: (cb: (msg: TicketAgentsMsg) => void): (() => void) =>
    subscribe<TicketAgentsMsg>('ticket:agents', cb),

  // Contract (Phase 5)
  readContract: (ticketId: string): Promise<string> =>
    ipcRenderer.invoke('contract:read', ticketId),
  onContractUpdate: (cb: (msg: ContractUpdateMsg) => void): (() => void) =>
    subscribe<ContractUpdateMsg>('contract:update', cb),

  // Settings (Phase 6)
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:set', patch),

  // Memory (context subsystem)
  readMemory: (scope: MemoryScope): Promise<string> =>
    ipcRenderer.invoke('memory:read', scope),
  writeMemory: (scope: MemoryScope, content: string): Promise<void> =>
    ipcRenderer.invoke('memory:write', scope, content),
  onMemoryUpdate: (cb: (msg: MemoryUpdateMsg) => void): (() => void) =>
    subscribe<MemoryUpdateMsg>('memory:update', cb)
}

export type PluriApi = typeof api

contextBridge.exposeInMainWorld('api', api)
