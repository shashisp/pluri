import type { AgentState, AgentWithRepo } from '@shared/types'
import { TerminalPane } from './TerminalPane'
import { StatusDot } from './StatusDot'

interface AgentPaneProps {
  agent: AgentWithRepo
  state: AgentState
  /** Effective MR/PR URL (live overlay ?? persisted). */
  mrUrl: string | null
  /** Error reason for agents that have no terminal log (e.g. branch-prep failed). */
  errorText?: string
  onKill: (agentId: string) => void
  onViewDiff: (agentId: string) => void
  onCreateMr: (agentId: string) => void
  onOpenLink: (url: string) => void
}

export function AgentPane({
  agent,
  state,
  mrUrl,
  errorText,
  onKill,
  onViewDiff,
  onCreateMr,
  onOpenLink
}: AgentPaneProps): JSX.Element {
  const verb = agent.gitHost === 'github' ? 'PR' : 'MR'
  const hasBranch = Boolean(agent.branch)
  // Can't open/diff an MR with no branch (e.g. branch-prep failed), nor while
  // the agent is still working or mid-push.
  const canCreateMr = hasBranch && state !== 'working' && state !== 'awaiting_mr'

  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-2 py-1">
        <span className="truncate text-xs font-medium">{agent.repoName}</span>
        <StatusDot state={state} />
        <span
          className="max-w-[140px] truncate text-[10px] text-neutral-600"
          title={agent.branch ?? ''}
        >
          {agent.branch ?? '—'}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-30"
            onClick={() => onViewDiff(agent.id)}
            disabled={!hasBranch}
          >
            Diff
          </button>

          {mrUrl ? (
            <button
              className="rounded bg-green-700/80 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-green-600"
              onClick={() => onOpenLink(mrUrl)}
              title={mrUrl}
            >
              Open {verb} ↗
            </button>
          ) : (
            <button
              className="rounded bg-blue-700/80 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-30"
              onClick={() => onCreateMr(agent.id)}
              disabled={!canCreateMr}
              title={canCreateMr ? `Push & open ${verb}` : 'Agent still working'}
            >
              {state === 'awaiting_mr' ? `Opening ${verb}…` : `Open ${verb}`}
            </button>
          )}

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
        {errorText && !hasBranch ? (
          <div className="h-full overflow-auto p-3 text-xs text-red-400">
            {errorText}
          </div>
        ) : (
          <TerminalPane agentId={agent.id} />
        )}
      </div>
    </div>
  )
}
