import { useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  GitFork,
  GitPullRequest,
  RotateCw,
  SquareTerminal
} from 'lucide-react'
import type { AgentState, TicketState, TicketWithAgents } from '@shared/types'
import { AgentPane } from './AgentPane'
import { Badge, Button, EmptyState, Tabs } from './ui'

interface TicketDetailProps {
  ticket: TicketWithAgents
  ticketState: TicketState
  agentStates: Record<string, AgentState>
  agentMrUrls: Record<string, string>
  agentErrors: Record<string, string>
  contractContent: string
  launching: boolean
  onBack: () => void
  onKill: (agentId: string) => void
  onRelaunch: (ticketId: string) => void
  onMarkDone: (ticketId: string) => void
  onViewDiff: (agentId: string) => void
  onCreateMr: (agentId: string) => void
  onOpenLink: (url: string) => void
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

  const anyRunning = ticket.agents.some(
    (a) => (agentStates[a.id] ?? a.state) === 'working'
  )
  const mrOpen = ticket.agents.filter(
    (a) => (agentStates[a.id] ?? a.state) === 'mr_open'
  ).length
  const launchDisabled = anyRunning || launching

  return (
    <div className="pk-detail">
      <div className="pk-detail__bar">
        <button className="pk-back" onClick={onBack} title="Back to board">
          <ArrowLeft size={15} />
        </button>
        <div className="pk-detail__title">
          <span className="pk-ticket__id">{ticket.id.slice(0, 6).toUpperCase()}</span>
          <h1>{ticket.title}</h1>
        </div>
        {ticketState === 'running' && (
          <Badge variant="warning" dot>
            running
          </Badge>
        )}
        {ticketState === 'awaiting_review' && (
          <Badge variant="info" dot>
            awaiting review
          </Badge>
        )}
        {ticketState === 'done' && (
          <Badge variant="success" dot>
            done
          </Badge>
        )}

        <div className="pk-detail__spacer" />
        <span className="pk-detail__meta">
          <GitFork size={13} /> {ticket.agents.length} agents
        </span>
        <span className="pk-detail__meta">
          <GitPullRequest size={13} /> {mrOpen} open
        </span>
        <Button
          variant="secondary"
          size="sm"
          icon={<RotateCw size={13} />}
          disabled={launchDisabled}
          onClick={() => onRelaunch(ticket.id)}
        >
          {launching ? 'Launching…' : ticket.agents.length === 0 ? 'Launch' : 'Relaunch'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<CheckCircle2 size={13} />}
          disabled={ticketState === 'done'}
          onClick={() => onMarkDone(ticket.id)}
        >
          Mark done
        </Button>
      </div>

      <div className="pk-detail__tabs">
        <Tabs
          value={tab}
          onChange={(v) => setTab(v as 'agents' | 'contract')}
          tabs={[
            {
              value: 'agents',
              label: 'Agents',
              icon: <SquareTerminal size={14} />,
              count: ticket.agents.length
            },
            { value: 'contract', label: 'Contract', icon: <FileText size={14} /> }
          ]}
        />
      </div>

      <div className="pk-detail__body">
        {tab === 'contract' ? (
          contractContent.trim() ? (
            <div className="pk-contract">
              <div className="pk-contract__bar">
                <FileText size={14} style={{ color: 'var(--text-muted)' }} />
                <span className="pk-contract__path">
                  .orchestrator/tickets/{ticket.id.slice(0, 8)}/contract.md
                </span>
                <span className="pk-contract__watch">
                  <span className="pk-livedot" /> watching
                </span>
              </div>
              <pre className="pk-contract__body">{contractContent}</pre>
            </div>
          ) : (
            <EmptyState
              icon={<FileText size={20} />}
              title="No contract yet"
              desc="The contract producer writes contract.md early; consumers read it before implementing. It streams here live."
            />
          )
        ) : ticket.agents.length === 0 ? (
          <EmptyState
            icon={<SquareTerminal size={20} />}
            title="No agents yet"
            desc="Launch this ticket to spawn one agent per target repo."
          />
        ) : (
          <div
            className="pk-panes"
            style={{
              gridTemplateColumns:
                ticket.agents.length === 1
                  ? '1fr'
                  : 'repeat(auto-fill, minmax(420px, 1fr))'
            }}
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
    </div>
  )
}
