import { ArrowRightLeft, Rows3 } from 'lucide-react'
import type {
  AgentState,
  Repo,
  TicketState,
  TicketWithAgents
} from '@shared/types'
import { Badge, StatusDot, Tag } from './ui'

interface TicketBoardProps {
  tickets: TicketWithAgents[]
  repos: Repo[]
  agentStates: Record<string, AgentState>
  ticketStates: Record<string, TicketState>
  onSelectTicket: (id: string) => void
}

const COLUMNS: { state: TicketState; label: string }[] = [
  { state: 'draft', label: 'Draft' },
  { state: 'running', label: 'Running' },
  { state: 'awaiting_review', label: 'Awaiting review' },
  { state: 'done', label: 'Done' }
]

export function TicketBoard({
  tickets,
  repos,
  agentStates,
  ticketStates,
  onSelectTicket
}: TicketBoardProps): JSX.Element {
  const repoName = (id: string): string => repos.find((r) => r.id === id)?.name ?? '?'
  const stateOf = (t: TicketWithAgents): TicketState => ticketStates[t.id] ?? t.state

  return (
    <div className="pk-board">
      {COLUMNS.map((col) => {
        const items = tickets.filter((t) => stateOf(t) === col.state)
        return (
          <section key={col.state} className="pk-col">
            <header className="pk-col__head">
              <span className={`pk-col__dot pk-col__dot--${col.state}`} />
              <span className="pk-col__label">{col.label}</span>
              <span className="pk-col__count">{items.length}</span>
            </header>
            <div className="pk-col__body">
              {items.map((t) => {
                const s = stateOf(t)
                const clickable = s === 'running' || s === 'awaiting_review' || t.agents.length > 0
                const mrOpen = t.agents.filter(
                  (a) => (agentStates[a.id] ?? a.state) === 'mr_open'
                ).length
                return (
                  <div
                    key={t.id}
                    className={`pluri-card${clickable ? ' pluri-card--interactive' : ''}`}
                    onClick={clickable ? () => onSelectTicket(t.id) : undefined}
                  >
                    <div className="pluri-card__body">
                      <div className="pk-ticket__top">
                        <span className="pk-ticket__id">{t.id.slice(0, 6).toUpperCase()}</span>
                        {s === 'awaiting_review' && (
                          <Badge variant="info" dot>
                            review
                          </Badge>
                        )}
                        {s === 'done' && (
                          <Badge variant="success" dot>
                            done
                          </Badge>
                        )}
                        {s === 'draft' && <Badge variant="neutral">draft</Badge>}
                        {s === 'running' && (
                          <span className="pk-ticket__order">
                            {t.orderingMode === 'producer_first' ? (
                              <ArrowRightLeft size={12} />
                            ) : (
                              <Rows3 size={12} />
                            )}
                            {t.orderingMode === 'producer_first' ? 'producer-first' : 'concurrent'}
                          </span>
                        )}
                      </div>

                      <div className="pk-ticket__title">{t.title}</div>
                      {t.spec && <div className="pk-ticket__spec">{t.spec}</div>}

                      <div className="pk-ticket__repos">
                        {t.targetRepoIds.map((id) => (
                          <Tag key={id}>{repoName(id)}</Tag>
                        ))}
                      </div>

                      {t.agents.length > 0 && (
                        <div className="pk-ticket__foot">
                          <div className="pk-ticket__dots">
                            {t.agents.map((a) => (
                              <StatusDot key={a.id} state={agentStates[a.id] ?? a.state} />
                            ))}
                          </div>
                          {s === 'running' && (
                            <span className="pk-ticket__meta">{t.agents.length} agents</span>
                          )}
                          {s === 'awaiting_review' && (
                            <span className="pk-ticket__meta">{mrOpen} MRs</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              {items.length === 0 && <div className="pk-col__empty">—</div>}
            </div>
          </section>
        )
      })}
    </div>
  )
}
