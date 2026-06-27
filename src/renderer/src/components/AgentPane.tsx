import { FileDiff, GitPullRequest, Square } from 'lucide-react'
import type { AgentState, AgentWithRepo } from '@shared/types'
import { TerminalPane } from './TerminalPane'
import { AGENT_STATE_LABEL, Button, IconButton, StatusDot, Tag } from './ui'

interface AgentPaneProps {
  agent: AgentWithRepo
  state: AgentState
  mrUrl: string | null
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
  const queued = state === 'idle'
  const canCreateMr =
    hasBranch && state !== 'working' && state !== 'awaiting_mr' && !queued
  const canKill = state === 'working' || queued

  return (
    <div className={`pk-pane${state === 'working' ? ' pk-pane--active' : ''}`}>
      <div className="pk-pane__head">
        <span className="pluri-avatar pluri-avatar--agent">
          {agent.repoName.slice(0, 1).toUpperCase()}
        </span>
        <span className="pk-pane__repo">{agent.repoName}</span>
        {agent.branch && <Tag title={agent.branch}>{agent.branch}</Tag>}
        <div className="pk-pane__state">
          <StatusDot state={state} />
          <span className="pk-pane__statelbl">{AGENT_STATE_LABEL[state]}</span>
        </div>
      </div>

      {errorText && !hasBranch ? (
        <div className="pk-pane__error">{errorText}</div>
      ) : (
        <div className="pk-term">
          <TerminalPane agentId={agent.id} />
        </div>
      )}

      <div className="pk-pane__foot">
        <Button
          variant="ghost"
          size="sm"
          icon={<FileDiff size={13} />}
          disabled={!hasBranch || queued}
          onClick={() => onViewDiff(agent.id)}
        >
          View diff
        </Button>
        <div className="pk-pane__foot-r">
          {mrUrl ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<GitPullRequest size={13} />}
              onClick={() => onOpenLink(mrUrl)}
            >
              Open {verb} ↗
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon={<GitPullRequest size={13} />}
              disabled={!canCreateMr}
              onClick={() => onCreateMr(agent.id)}
            >
              {state === 'awaiting_mr' ? `Opening ${verb}…` : `Open ${verb}`}
            </Button>
          )}
          <IconButton size="sm" label="Kill agent" disabled={!canKill} onClick={() => onKill(agent.id)}>
            <Square size={13} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
