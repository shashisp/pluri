import type {
  AgentState,
  TicketState,
  TicketWithAgents
} from '@shared/types'
import { AgentPane } from './AgentPane'

interface TicketDetailProps {
  ticket: TicketWithAgents
  ticketState: TicketState
  agentStates: Record<string, AgentState>
  /** True while a launch for this ticket is in flight. */
  launching: boolean
  onBack: () => void
  onKill: (agentId: string) => void
  onRelaunch: (ticketId: string) => void
  onMarkDone: (ticketId: string) => void
}

/** Column count for an N-pane responsive grid. */
function columnsFor(n: number): number {
  if (n <= 1) return 1
  if (n <= 2) return 2
  if (n <= 4) return 2
  if (n <= 9) return 3
  return 4
}

export function TicketDetail({
  ticket,
  ticketState,
  agentStates,
  launching,
  onBack,
  onKill,
  onRelaunch,
  onMarkDone
}: TicketDetailProps): JSX.Element {
  const cols = columnsFor(ticket.agents.length)
  const anyRunning = ticket.agents.some(
    (a) => (agentStates[a.id] ?? a.state) === 'working'
  )
  const launchDisabled = anyRunning || launching

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <button
          className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
          onClick={onBack}
        >
          ← Board
        </button>
        <span className="truncate text-sm font-semibold">{ticket.title}</span>
        <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">
          {ticketState.replace('_', ' ')}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700 disabled:opacity-40"
            onClick={() => onRelaunch(ticket.id)}
            disabled={launchDisabled}
            title={anyRunning ? 'Agents still running' : 'Spawn agents again'}
          >
            {launching
              ? 'Launching…'
              : ticket.agents.length === 0
                ? 'Launch'
                : 'Relaunch'}
          </button>
          <button
            className="rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700 disabled:opacity-40"
            onClick={() => onMarkDone(ticket.id)}
            disabled={ticketState === 'done'}
          >
            Mark done
          </button>
        </div>
      </div>

      {ticket.agents.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">
          No agents yet — launch this ticket to spawn one agent per target repo.
        </div>
      ) : (
        <div
          className="grid min-h-0 flex-1 gap-2 p-2"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {ticket.agents.map((agent) => (
            <AgentPane
              key={agent.id}
              agent={agent}
              state={agentStates[agent.id] ?? agent.state}
              onKill={onKill}
            />
          ))}
        </div>
      )}
    </div>
  )
}
