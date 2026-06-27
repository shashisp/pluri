import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentState,
  AgentStateMsg,
  ContractUpdateMsg,
  TicketAgentsMsg,
  TicketState,
  TicketStateMsg,
  TicketWithAgents,
  WorkspaceWithRepos
} from '@shared/types'
import { Sidebar } from './components/Sidebar'
import { AgentSandbox } from './components/AgentSandbox'
import { TicketBoard } from './components/TicketBoard'
import { TicketDetail } from './components/TicketDetail'
import { NewTicketForm } from './components/NewTicketForm'
import { DiffModal } from './components/DiffModal'

type View = 'board' | 'sandbox'

export default function App(): JSX.Element {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRepos[]>([])
  const [selectedWsId, setSelectedWsId] = useState<string | null>(null)
  const [view, setView] = useState<View>('board')

  const [tickets, setTickets] = useState<TicketWithAgents[]>([])
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [showNewTicket, setShowNewTicket] = useState(false)
  // Ticket id with a launch in flight — guards against double-launch races.
  const [launchingTicketId, setLaunchingTicketId] = useState<string | null>(null)

  // Live overlays keyed by id; take precedence over persisted state.
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({})
  const [agentMrUrls, setAgentMrUrls] = useState<Record<string, string>>({})
  const [agentErrors, setAgentErrors] = useState<Record<string, string>>({})
  const [ticketStates, setTicketStates] = useState<Record<string, TicketState>>({})

  const [diff, setDiff] = useState<{ title: string; text: string } | null>(null)
  const [contractContent, setContractContent] = useState('')

  const selectedTicketIdRef = useRef<string | null>(selectedTicketId)
  selectedTicketIdRef.current = selectedTicketId

  const refreshWorkspaces = useCallback(async (): Promise<void> => {
    setWorkspaces(await window.api.listWorkspaces())
  }, [])

  const refreshTickets = useCallback(async (wsId: string | null): Promise<void> => {
    setTickets(wsId ? await window.api.listTickets(wsId) : [])
  }, [])

  useEffect(() => {
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  useEffect(() => {
    void refreshTickets(selectedWsId)
  }, [selectedWsId, refreshTickets])

  // Live subscriptions (registered once).
  useEffect(() => {
    const offAgent = window.api.onAgentState((msg: AgentStateMsg) => {
      setAgentStates((prev) => ({ ...prev, [msg.agentId]: msg.state }))
      if (msg.mrUrl) setAgentMrUrls((prev) => ({ ...prev, [msg.agentId]: msg.mrUrl! }))
      if (msg.error) setAgentErrors((prev) => ({ ...prev, [msg.agentId]: msg.error! }))
    })
    const offTicket = window.api.onTicketState((msg: TicketStateMsg) =>
      setTicketStates((prev) => ({ ...prev, [msg.ticketId]: msg.state }))
    )
    // producer_first: consumers spawn later — update that ticket's agent list.
    const offAgents = window.api.onTicketAgents((msg: TicketAgentsMsg) =>
      setTickets((prev) =>
        prev.map((t) => (t.id === msg.ticketId ? { ...t, agents: msg.agents } : t))
      )
    )
    const offContract = window.api.onContractUpdate((msg: ContractUpdateMsg) => {
      if (msg.ticketId === selectedTicketIdRef.current) setContractContent(msg.content)
    })
    return () => {
      offAgent()
      offTicket()
      offAgents()
      offContract()
    }
  }, [])

  // Load the contract whenever the selected ticket changes (live updates arrive
  // via onContractUpdate above).
  useEffect(() => {
    setContractContent('')
    if (!selectedTicketId) return
    let active = true
    const id = selectedTicketId
    void window.api.readContract(id).then((content) => {
      if (active && selectedTicketIdRef.current === id) setContractContent(content)
    })
    return () => {
      active = false
    }
  }, [selectedTicketId])

  const selectedWs = useMemo(
    () => workspaces.find((w) => w.id === selectedWsId) ?? null,
    [workspaces, selectedWsId]
  )
  const selectedTicket = useMemo(
    () => tickets.find((t) => t.id === selectedTicketId) ?? null,
    [tickets, selectedTicketId]
  )

  function selectWorkspace(id: string): void {
    setSelectedWsId(id)
    setSelectedTicketId(null)
  }

  async function handleTicketDone(ticketId: string, launched: boolean): Promise<void> {
    setShowNewTicket(false)
    await refreshTickets(selectedWsId)
    if (launched) {
      setView('board')
      setSelectedTicketId(ticketId)
    }
  }

  async function relaunch(ticketId: string): Promise<void> {
    if (launchingTicketId) return // a launch is already in flight
    setLaunchingTicketId(ticketId)
    try {
      await window.api.launchTicket(ticketId)
      await refreshTickets(selectedWsId)
    } finally {
      setLaunchingTicketId(null)
    }
  }

  async function markDone(ticketId: string): Promise<void> {
    await window.api.markTicketDone(ticketId)
    await refreshTickets(selectedWsId)
  }

  async function viewDiff(agentId: string): Promise<void> {
    const agent = selectedTicket?.agents.find((a) => a.id === agentId)
    setDiff({ title: agent?.repoName ?? 'agent', text: 'Loading diff…' })
    try {
      const text = await window.api.agentDiff(agentId)
      setDiff({ title: agent?.repoName ?? 'agent', text: text || '(no differences)' })
    } catch (err) {
      setDiff({ title: agent?.repoName ?? 'agent', text: String(err) })
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] text-neutral-200">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tracking-tight">Pluri</span>
          <span className="text-xs text-neutral-500">
            Phase 3 — tickets &amp; multi-repo fan-out
          </span>
        </div>
        <div className="flex gap-1 text-xs">
          {(['board', 'sandbox'] as View[]).map((v) => (
            <button
              key={v}
              className={`rounded px-2 py-1 ${
                view === v
                  ? 'bg-neutral-800 text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
              onClick={() => setView(v)}
            >
              {v === 'board' ? 'Board' : 'Agent sandbox'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr]">
        <Sidebar
          workspaces={workspaces}
          selectedWsId={selectedWsId}
          onSelect={selectWorkspace}
          onChanged={refreshWorkspaces}
        />

        <div className="min-w-0 overflow-hidden">
          {view === 'sandbox' ? (
            <AgentSandbox />
          ) : !selectedWs ? (
            <div className="flex h-full items-center justify-center text-sm text-neutral-600">
              Select or create a workspace to begin.
            </div>
          ) : selectedTicket ? (
            <TicketDetail
              ticket={selectedTicket}
              ticketState={ticketStates[selectedTicket.id] ?? selectedTicket.state}
              agentStates={agentStates}
              agentMrUrls={agentMrUrls}
              agentErrors={agentErrors}
              contractContent={contractContent}
              launching={launchingTicketId === selectedTicket.id}
              onBack={() => {
                setSelectedTicketId(null)
                void refreshTickets(selectedWsId)
              }}
              onKill={(agentId) => void window.api.killAgent(agentId)}
              onRelaunch={(id) => void relaunch(id)}
              onMarkDone={(id) => void markDone(id)}
              onViewDiff={(id) => void viewDiff(id)}
              onCreateMr={(id) => void window.api.openMr(id)}
              onOpenLink={(url) => void window.api.openExternal(url)}
            />
          ) : (
            <TicketBoard
              tickets={tickets}
              agentStates={agentStates}
              ticketStates={ticketStates}
              onSelectTicket={setSelectedTicketId}
              onNewTicket={() => setShowNewTicket(true)}
            />
          )}
        </div>
      </div>

      {showNewTicket && selectedWs && (
        <NewTicketForm
          workspace={selectedWs}
          onClose={() => setShowNewTicket(false)}
          onDone={handleTicketDone}
        />
      )}

      {diff && (
        <DiffModal title={diff.title} diff={diff.text} onClose={() => setDiff(null)} />
      )}
    </div>
  )
}
