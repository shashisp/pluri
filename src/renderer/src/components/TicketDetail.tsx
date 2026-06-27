import { useState } from 'react'
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
  agentMrUrls: Record<string, string>
  agentErrors: Record<string, string>
  contractContent: string
  /** True while a launch for this ticket is in flight. */
  launching: boolean
  onBack: () => void
  onKill: (agentId: string) => void
  onRelaunch: (ticketId: string) => void
  onMarkDone: (ticketId: string) => void
  onViewDiff: (agentId: string) => void
  onCreateMr: (agentId: string) => void
  onOpenLink: (url: string) => void
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
  agentMrUrls,
  agentErrors,
  contractContent,
  launching,
  onBack,
  onKill,
  onRelaunch,
  onMarkDone,
  onViewDiff,
  onCreateMr,
  onOpenLink
}: TicketDetailProps): JSX.Element {
  const [tab, setTab] = useState<'agents' | 'contract'>('agents')
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

        <div className="ml-3 flex gap-1 text-xs">
          {(['agents', 'contract'] as const).map((t) => (
            <button
              key={t}
              className={`rounded px-2 py-1 ${
                tab === t
                  ? 'bg-neutral-800 text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
              onClick={() => setTab(t)}
            >
              {t === 'agents' ? 'Agents' : 'Contract'}
            </button>
          ))}
        </div>

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

      {tab === 'contract' ? (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {contractContent.trim() ? (
            <pre className="m-0 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-neutral-300">
              {contractContent}
            </pre>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-neutral-600">
              No contract yet. The producer agent writes{' '}
              <code className="mx-1 text-neutral-400">contract.md</code> early; it
              streams here live.
            </div>
          )}
        </div>
      ) : ticket.agents.length === 0 ? (
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
              mrUrl={agentMrUrls[agent.id] ?? agent.mrUrl}
              errorText={agentErrors[agent.id]}
              onKill={onKill}
              onViewDiff={onViewDiff}
              onCreateMr={onCreateMr}
              onOpenLink={onOpenLink}
            />
          ))}
        </div>
      )}
    </div>
  )
}
