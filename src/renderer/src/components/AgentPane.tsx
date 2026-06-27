import type { AgentState, AgentWithRepo } from '@shared/types'
import { TerminalPane } from './TerminalPane'
import { StatusDot } from './StatusDot'

interface AgentPaneProps {
  agent: AgentWithRepo
  state: AgentState
  onKill: (agentId: string) => void
}

export function AgentPane({ agent, state, onKill }: AgentPaneProps): JSX.Element {
  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-2 py-1">
        <span className="truncate text-xs font-medium">{agent.repoName}</span>
        <StatusDot state={state} />
        <div className="ml-auto flex items-center gap-2">
          <span
            className="max-w-[160px] truncate text-[10px] text-neutral-600"
            title={agent.branch ?? ''}
          >
            {agent.branch ?? '—'}
          </span>
          <button
            className="rounded bg-red-600/80 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-30"
            onClick={() => onKill(agent.id)}
            disabled={state !== 'working'}
          >
            Kill
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <TerminalPane agentId={agent.id} />
      </div>
    </div>
  )
}
