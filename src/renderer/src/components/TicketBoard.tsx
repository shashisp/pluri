import type {
  AgentState,
  TicketState,
  TicketWithAgents
} from '@shared/types'

interface TicketBoardProps {
  tickets: TicketWithAgents[]
  agentStates: Record<string, AgentState>
  ticketStates: Record<string, TicketState>
  onSelectTicket: (ticketId: string) => void
  onNewTicket: () => void
}

const COLUMNS: { state: TicketState; label: string }[] = [
  { state: 'draft', label: 'Draft' },
  { state: 'running', label: 'Running' },
  { state: 'awaiting_review', label: 'Awaiting review' },
  { state: 'done', label: 'Done' }
]

const DOT: Record<AgentState, string> = {
  idle: 'bg-neutral-500',
  working: 'bg-yellow-400 animate-pulse',
  awaiting_mr: 'bg-blue-400',
  mr_open: 'bg-green-500',
  done: 'bg-green-500',
  killed: 'bg-red-500',
  error: 'bg-red-500'
}

export function TicketBoard({
  tickets,
  agentStates,
  ticketStates,
  onSelectTicket,
  onNewTicket
}: TicketBoardProps): JSX.Element {
  const stateOf = (t: TicketWithAgents): TicketState =>
    ticketStates[t.id] ?? t.state

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <h1 className="text-sm font-semibold">Tickets</h1>
        <button
          className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
          onClick={onNewTicket}
        >
          + New ticket
        </button>
      </div>

      <div className="grid flex-1 grid-cols-4 gap-3 overflow-y-auto p-3">
        {COLUMNS.map((col) => {
          const colTickets = tickets.filter((t) => stateOf(t) === col.state)
          return (
            <div key={col.state} className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                <span>{col.label}</span>
                <span>{colTickets.length}</span>
              </div>

              {colTickets.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onSelectTicket(t.id)}
                  className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 text-left hover:border-neutral-700"
                >
                  <span className="truncate text-sm font-medium">{t.title}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-neutral-600">
                      {t.targetRepoIds.length} repo
                      {t.targetRepoIds.length === 1 ? '' : 's'}
                    </span>
                    <div className="ml-auto flex items-center gap-1">
                      {t.agents.map((a) => (
                        <span
                          key={a.id}
                          title={`${a.repoName}: ${agentStates[a.id] ?? a.state}`}
                          className={`h-2 w-2 rounded-full ${
                            DOT[agentStates[a.id] ?? a.state]
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </button>
              ))}

              {colTickets.length === 0 && (
                <div className="rounded-lg border border-dashed border-neutral-900 px-2 py-4 text-center text-[11px] text-neutral-700">
                  —
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
