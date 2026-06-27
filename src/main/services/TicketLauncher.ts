import { randomUUID } from 'node:crypto'
import type { AgentManager } from './AgentManager'
import type { Db } from './db'
import { GitService } from './GitService'
import { MrService } from './MrService'
import { branchName, buildScopePrompt } from './prompts'
import type {
  AgentRecord,
  AgentState,
  AgentStateMsg,
  AgentWithRepo,
  LaunchResult,
  Ticket,
  TicketState
} from '@shared/types'

/** Tools agents may use to implement a ticket. */
const AGENT_TOOLS = 'Bash,Edit,Read,Write'

/** States in which an agent's work is settled (used for ticket rollup). */
function isSettled(state: AgentState): boolean {
  return (
    state === 'mr_open' ||
    state === 'done' ||
    state === 'error' ||
    state === 'killed'
  )
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Coordinates a ticket launch end-to-end:
 *  - app-side: create the feature branch per repo (GitService) before spawning,
 *  - spawn one agent per repo (concurrent; producer_first arrives in Phase 5),
 *  - on a clean finish, push the branch and open an MR/PR, capturing the URL,
 *  - roll the ticket up to awaiting_review once no agent is still working.
 */
export class TicketLauncher {
  private agentToTicket = new Map<
    string,
    { ticketId: string; repoId: string; repoPath: string }
  >()
  // Repo paths with a live agent — a single working tree is single-writer, so we
  // refuse to run a second agent (from another ticket) in the same repo at once.
  private busyRepos = new Set<string>()
  // Agents whose finalize() (push+MR) is in flight — prevents double PRs.
  private finalizing = new Set<string>()

  constructor(
    private manager: AgentManager,
    private db: Db,
    private emit: (channel: string, payload: unknown) => void,
    private git: GitService = new GitService(),
    private mr: MrService = new MrService()
  ) {
    this.manager.on('state', (m: AgentStateMsg) => this.onAgentState(m))
  }

  async launch(ticketId: string): Promise<LaunchResult> {
    const ticket = this.db.getTicket(ticketId)
    if (!ticket) throw new Error('Ticket not found')

    const repos = this.db
      .listRepos(ticket.workspaceId)
      .filter((r) => ticket.targetRepoIds.includes(r.id))
    if (repos.length === 0) throw new Error('Ticket has no target repos on disk')

    // Supersede any prior run: kill its live agents first (else they keep
    // running orphaned and edit the same repo concurrently), then drop records.
    for (const [agentId, link] of this.agentToTicket) {
      if (link.ticketId === ticketId) {
        this.manager.killAgent(agentId)
        this.releaseAgent(agentId)
      }
    }
    this.db.deleteAgentsForTicket(ticketId)

    this.db.setTicketState(ticketId, 'running')
    this.emitTicketState(ticketId, 'running')

    const launched: AgentWithRepo[] = []
    for (const repo of repos) {
      const branch = branchName(ticket)

      // Refuse to share a working tree with another ticket's live agent.
      if (this.busyRepos.has(repo.path)) {
        const rec = this.makeRecord(randomUUID(), ticketId, repo.id, null, null, 'error')
        this.db.insertAgent(rec)
        this.emit('agent:state', {
          agentId: rec.id,
          state: 'error',
          error: `Repo "${repo.name}" is busy with another running ticket; skipped.`
        })
        launched.push(this.withRepo(rec, repo.name, repo.path, repo.gitHost, repo.defaultBranch))
        continue
      }

      // App-side auto-branch BEFORE the agent runs (Phase 4).
      let warnings: string[] = []
      let branchError: string | null = null
      try {
        const result = await this.git.prepareBranch(repo.path, repo.defaultBranch, branch)
        warnings = result.warnings
      } catch (e) {
        branchError = `Could not prepare branch: ${msg(e)}`
      }

      if (branchError) {
        // Record an errored agent without spawning a process. branch=null since
        // it was never created (so Open MR/Diff stay disabled for it).
        const rec = this.makeRecord(randomUUID(), ticketId, repo.id, null, null, 'error')
        this.db.insertAgent(rec)
        this.emit('agent:state', { agentId: rec.id, state: 'error', error: branchError })
        launched.push(this.withRepo(rec, repo.name, repo.path, repo.gitHost, repo.defaultBranch))
        continue
      }

      const agentId = this.manager.spawnAgent({
        cwd: repo.path,
        prompt: ticket.spec,
        systemPrompt: buildScopePrompt(repo, ticket, branch),
        allowedTools: AGENT_TOOLS
      })
      this.agentToTicket.set(agentId, { ticketId, repoId: repo.id, repoPath: repo.path })
      this.busyRepos.add(repo.path)

      for (const w of warnings) this.manager.appendNote(agentId, w)

      const rec = this.makeRecord(
        agentId,
        ticketId,
        repo.id,
        branch,
        this.manager.pidOf(agentId),
        'working'
      )
      this.db.insertAgent(rec)
      launched.push(
        this.withRepo(rec, repo.name, repo.path, repo.gitHost, repo.defaultBranch)
      )
    }

    // A launch where every repo failed branch-prep / was busy has no live agents
    // and would otherwise leave the ticket stuck in 'running' — roll it up now.
    this.checkRollup(ticketId)

    return { ticketId, agents: launched }
  }

  /** Public: (re)open the MR/PR for an agent — push + create PR. */
  async openMr(agentId: string): Promise<void> {
    await this.finalize(agentId)
  }

  // ---- internals ------------------------------------------------------------

  private onAgentState(m: AgentStateMsg): void {
    const link = this.agentToTicket.get(m.agentId)
    if (!link) return // sandbox / unknown agent

    this.db.setAgentState(m.agentId, m.state, {
      endedAt: isSettled(m.state) ? Date.now() : undefined
    })

    if (m.state === 'done') {
      // Clean finish — push + open MR asynchronously.
      void this.finalize(m.agentId)
      return
    }

    if (m.state === 'error' || m.state === 'killed') {
      this.releaseAgent(m.agentId)
      this.checkRollup(link.ticketId)
    }
  }

  /** Push the agent's branch and open an MR/PR; updates state + emits notes. */
  private async finalize(agentId: string): Promise<void> {
    // Idempotent: never push/open twice (auto 'done' + manual Open MR, or a
    // double-click) — that would create duplicate PRs.
    if (this.finalizing.has(agentId)) return
    const agent = this.db.getAgent(agentId)
    if (!agent || !agent.branch) return
    if (agent.state === 'mr_open') return // already opened
    if (agent.state === 'working') return // process still live — wait for 'done'
    const ticketId = agent.ticketId

    this.finalizing.add(agentId)
    this.setAgentState(agentId, 'awaiting_mr')
    this.manager.appendNote(agentId, 'agent finished — preparing MR…')

    try {
      const ahead = await this.git.commitsAhead(
        agent.repoPath,
        agent.defaultBranch,
        agent.branch
      )
      if (ahead === 0) {
        this.manager.appendNote(
          agentId,
          `no commits ahead of ${agent.defaultBranch}; nothing to push.`
        )
        return this.settle(agentId, ticketId, 'done')
      }

      if (!(await this.git.hasOrigin(agent.repoPath))) {
        this.manager.appendNote(
          agentId,
          "no 'origin' remote; committed locally only (add a remote to open an MR)."
        )
        return this.settle(agentId, ticketId, 'done')
      }

      this.manager.appendNote(agentId, `pushing ${agent.branch}…`)
      await this.git.push(agent.repoPath, agent.branch)

      const verb = agent.gitHost === 'github' ? 'PR' : 'MR'
      this.manager.appendNote(agentId, `pushed. opening ${verb}…`)
      const ticket = this.db.getTicket(ticketId)
      const url = await this.mr.openMr({
        repoPath: agent.repoPath,
        gitHost: agent.gitHost,
        branch: agent.branch,
        defaultBranch: agent.defaultBranch,
        title: ticket?.title ?? 'Pluri ticket',
        body: buildBody(ticket)
      })

      this.db.setAgentState(agentId, 'mr_open', { mrUrl: url, endedAt: Date.now() })
      this.emit('agent:state', { agentId, state: 'mr_open', mrUrl: url })
      this.manager.appendNote(agentId, `opened: ${url}`)
      this.releaseAgent(agentId)
      this.checkRollup(ticketId)
    } catch (e) {
      this.manager.appendNote(agentId, `MR step failed: ${msg(e)}`)
      this.settle(agentId, ticketId, 'error')
    } finally {
      this.finalizing.delete(agentId)
    }
  }

  private settle(agentId: string, ticketId: string, state: AgentState): void {
    this.db.setAgentState(agentId, state, { endedAt: Date.now() })
    this.emit('agent:state', { agentId, state })
    this.releaseAgent(agentId)
    this.checkRollup(ticketId)
  }

  /** Drop an agent's ticket mapping and free its repo for the next ticket. */
  private releaseAgent(agentId: string): void {
    const link = this.agentToTicket.get(agentId)
    if (!link) return
    this.busyRepos.delete(link.repoPath)
    this.agentToTicket.delete(agentId)
  }

  private setAgentState(agentId: string, state: AgentState): void {
    this.db.setAgentState(agentId, state)
    this.emit('agent:state', { agentId, state })
  }

  private checkRollup(ticketId: string): void {
    const agents = this.db.listAgentsByTicket(ticketId)
    if (agents.length > 0 && agents.every((a) => isSettled(a.state))) {
      const ticket = this.db.getTicket(ticketId)
      if (ticket && ticket.state === 'running') {
        this.db.setTicketState(ticketId, 'awaiting_review')
        this.emitTicketState(ticketId, 'awaiting_review')
      }
    }
  }

  private makeRecord(
    id: string,
    ticketId: string,
    repoId: string,
    branch: string | null,
    pid: number | null,
    state: AgentState
  ): AgentRecord {
    return {
      id,
      ticketId,
      repoId,
      branch,
      pid,
      state,
      mrUrl: null,
      startedAt: Date.now(),
      endedAt: null
    }
  }

  private withRepo(
    rec: AgentRecord,
    repoName: string,
    repoPath: string,
    gitHost: AgentWithRepo['gitHost'],
    defaultBranch: string
  ): AgentWithRepo {
    return { ...rec, repoName, repoPath, gitHost, defaultBranch }
  }

  private emitTicketState(ticketId: string, state: TicketState): void {
    this.emit('ticket:state', { ticketId, state })
  }
}

function buildBody(ticket: Ticket | null): string {
  const spec = ticket?.spec?.trim()
  return [
    spec || '(no spec provided)',
    '',
    '---',
    '🤖 Opened by Pluri (multi-repo agent orchestrator).'
  ].join('\n')
}
