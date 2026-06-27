import type { AgentManager } from './AgentManager'
import type { Db } from './db'
import { branchName, buildScopePrompt } from './prompts'
import type {
  AgentRecord,
  AgentState,
  AgentStateMsg,
  AgentWithRepo,
  LaunchResult,
  TicketState
} from '@shared/types'

/** Tools agents may use to implement a ticket. */
const AGENT_TOOLS = 'Bash,Edit,Read,Write'

/** States in which an agent's process is no longer running. */
function isTerminalAgentState(state: AgentState): boolean {
  return (
    state === 'done' ||
    state === 'error' ||
    state === 'killed' ||
    state === 'mr_open'
  )
}

/**
 * Coordinates a ticket launch: spawns one agent per targeted repo, persists the
 * agent records, maps each agent back to its ticket, and rolls the ticket up to
 * `awaiting_review` once every agent has terminated. Phase 3 spawns concurrently
 * (producer_first ordering arrives in Phase 5).
 */
export class TicketLauncher {
  private agentToTicket = new Map<string, { ticketId: string; repoId: string }>()

  constructor(
    private manager: AgentManager,
    private db: Db,
    private emit: (channel: string, payload: unknown) => void
  ) {
    this.manager.on('state', (msg: AgentStateMsg) => this.onAgentState(msg))
  }

  launch(ticketId: string): LaunchResult {
    const ticket = this.db.getTicket(ticketId)
    if (!ticket) throw new Error('Ticket not found')

    const repos = this.db
      .listRepos(ticket.workspaceId)
      .filter((r) => ticket.targetRepoIds.includes(r.id))
    if (repos.length === 0) throw new Error('Ticket has no target repos on disk')

    // A fresh launch supersedes any prior agents for this ticket: kill their
    // live processes FIRST (otherwise they keep running orphaned and edit the
    // same repo concurrently with the new agents), then drop their records.
    for (const [agentId, link] of this.agentToTicket) {
      if (link.ticketId === ticketId) {
        this.manager.killAgent(agentId) // no-op if already terminal/unknown
        this.agentToTicket.delete(agentId)
      }
    }
    this.db.deleteAgentsForTicket(ticketId)

    this.db.setTicketState(ticketId, 'running')
    this.emitTicketState(ticketId, 'running')

    const launched: AgentWithRepo[] = []
    for (const repo of repos) {
      const branch = branchName(ticket)
      const agentId = this.manager.spawnAgent({
        cwd: repo.path,
        prompt: ticket.spec,
        systemPrompt: buildScopePrompt(repo, ticket, branch),
        allowedTools: AGENT_TOOLS
      })
      this.agentToTicket.set(agentId, { ticketId, repoId: repo.id })

      const rec: AgentRecord = {
        id: agentId,
        ticketId,
        repoId: repo.id,
        branch,
        pid: this.manager.pidOf(agentId),
        state: 'working',
        mrUrl: null,
        startedAt: Date.now(),
        endedAt: null
      }
      this.db.insertAgent(rec)
      launched.push({
        ...rec,
        repoName: repo.name,
        repoPath: repo.path,
        gitHost: repo.gitHost,
        defaultBranch: repo.defaultBranch
      })
    }

    return { ticketId, agents: launched }
  }

  private onAgentState(msg: AgentStateMsg): void {
    const link = this.agentToTicket.get(msg.agentId)
    if (!link) return // sandbox agent or unknown — not part of a ticket

    const terminal = isTerminalAgentState(msg.state)
    this.db.setAgentState(msg.agentId, msg.state, {
      mrUrl: msg.mrUrl,
      endedAt: terminal ? Date.now() : undefined
    })

    if (!terminal) return

    // Roll the ticket up to awaiting_review once all its agents have terminated.
    // (Uses the DB, not the in-memory map, so pruning the map below is safe.)
    const agents = this.db.listAgentsByTicket(link.ticketId)
    if (agents.length > 0 && agents.every((a) => isTerminalAgentState(a.state))) {
      const ticket = this.db.getTicket(link.ticketId)
      if (ticket && ticket.state === 'running') {
        this.db.setTicketState(link.ticketId, 'awaiting_review')
        this.emitTicketState(link.ticketId, 'awaiting_review')
      }
    }

    // No more state events arrive for a terminal agent — drop its mapping.
    this.agentToTicket.delete(msg.agentId)
  }

  private emitTicketState(ticketId: string, state: TicketState): void {
    this.emit('ticket:state', { ticketId, state })
  }
}
