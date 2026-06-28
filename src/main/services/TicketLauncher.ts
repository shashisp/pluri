import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AgentManager } from './AgentManager'
import type { Db } from './db'
import type { ContractService } from './ContractService'
import type { MemoryService } from './MemoryService'
import { GitService } from './GitService'
import { MrService } from './MrService'
import { branchName, buildScopePrompt } from './prompts'
import type {
  AgentRecord,
  AgentState,
  AgentStateMsg,
  AgentWithRepo,
  LaunchResult,
  Repo,
  Ticket,
  TicketState
} from '@shared/types'

/** Tools agents may use to implement a ticket. */
const AGENT_TOOLS = 'Bash,Edit,Read,Write'

/** producer_first: how long to wait for contract.md before spawning consumers. */
const CONTRACT_WAIT_MS = 180_000
const CONTRACT_POLL_MS = 1500

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
  // Per-ticket launch generation — a deferred consumer spawn (producer_first)
  // aborts if the ticket was relaunched while it was waiting.
  private launchGen = new Map<string, number>()
  // Tickets (by gen) whose producer_first consumers haven't spawned yet — blocks
  // premature rollup while only the producer is recorded.
  private pendingConsumers = new Map<string, number>()

  constructor(
    private manager: AgentManager,
    private db: Db,
    private emit: (channel: string, payload: unknown) => void,
    private contracts: ContractService,
    private git: GitService = new GitService(),
    private mr: MrService = new MrService(),
    private memory?: MemoryService
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
    const gen = (this.launchGen.get(ticketId) ?? 0) + 1
    this.launchGen.set(ticketId, gen)

    this.db.setTicketState(ticketId, 'running')
    this.emitTicketState(ticketId, 'running')

    // Create the shared contract folder (ticket.md + status/); contractPath is
    // the absolute contract.md the producer writes and consumers read.
    const { contractPath, warnings: contractWarnings } = await this.contracts.init(
      ticketId,
      ticket
    )

    const branch = branchName(ticket)
    const producer = repos.find((r) => r.isContractProducer)
    const producerFirst =
      ticket.orderingMode === 'producer_first' &&
      !!producer &&
      !!contractPath &&
      repos.length > 1

    const launched: AgentWithRepo[] = []

    if (producerFirst && producer) {
      // Spawn the producer now; spawn consumers once contract.md is written.
      const producerAgent = await this.spawnFor(
        producer, ticket, branch, contractPath, true, contractWarnings
      )
      launched.push(producerAgent)
      const consumers = repos.filter((r) => r.id !== producer.id)
      // Mark consumers pending so checkRollup doesn't roll the ticket up while
      // only the producer is recorded.
      this.pendingConsumers.set(ticketId, gen)
      void this.spawnConsumersWhenReady(
        ticketId, gen, ticket, branch, consumers, contractPath, producerAgent.id
      )
    } else {
      for (const repo of repos) {
        launched.push(
          await this.spawnFor(repo, ticket, branch, contractPath, false, contractWarnings)
        )
      }
    }

    // A launch where every repo failed branch-prep / was busy has no live agents
    // and would otherwise leave the ticket stuck in 'running' — roll it up now.
    this.checkRollup(ticketId)

    return { ticketId, agents: launched }
  }

  /**
   * Branch + spawn a single repo's agent (or record an errored agent if the repo
   * is busy or branch prep fails). Returns the AgentWithRepo to surface in the UI.
   */
  private async spawnFor(
    repo: Repo,
    ticket: Ticket,
    branch: string,
    contractPath: string | null,
    producerFirst: boolean,
    extraNotes: string[] = []
  ): Promise<AgentWithRepo> {
    const errored = (reason: string): AgentWithRepo => {
      const rec = this.makeRecord(randomUUID(), ticket.id, repo.id, null, null, 'error')
      this.db.insertAgent(rec)
      this.emit('agent:state', { agentId: rec.id, state: 'error', error: reason })
      return this.withRepo(rec, repo.name, repo.path, repo.gitHost, repo.defaultBranch)
    }

    // Refuse to share a working tree with another ticket's live agent.
    if (this.busyRepos.has(repo.path)) {
      return errored(`Repo "${repo.name}" is busy with another running ticket; skipped.`)
    }

    // App-side auto-branch BEFORE the agent runs.
    let warnings: string[] = []
    try {
      const result = await this.git.prepareBranch(repo.path, repo.defaultBranch, branch)
      warnings = result.warnings
    } catch (e) {
      return errored(`Could not prepare branch: ${msg(e)}`)
    }

    // Compose the layered context: workspace memory (tier 1), a CLAUDE.md
    // reference (tier 2), the contract (tier 3). The ticket spec is the -p prompt.
    const workspaceMemory = this.memory
      ? await this.memory.read({ type: 'workspace', id: ticket.workspaceId })
      : ''
    const contractContent = contractPath ? await this.contracts.read(ticket.id) : ''
    const hasClaudeMd = existsSync(join(repo.path, 'CLAUDE.md'))

    const agentId = this.manager.spawnAgent({
      cwd: repo.path,
      prompt: ticket.spec,
      systemPrompt: buildScopePrompt({
        repo,
        ticket,
        branch,
        contractPath,
        producerFirst,
        workspaceMemory,
        contractContent,
        hasClaudeMd
      }),
      allowedTools: this.db.getSettings().agentTools || AGENT_TOOLS,
      // Grant access to the shared contract folder (defensive; out-of-cwd writes
      // already work, but this is explicit and robust to stricter permissions).
      addDirs: contractPath ? [dirname(contractPath)] : undefined
    })
    this.agentToTicket.set(agentId, { ticketId: ticket.id, repoId: repo.id, repoPath: repo.path })
    this.busyRepos.add(repo.path)

    for (const note of [...extraNotes, ...warnings]) this.manager.appendNote(agentId, note)

    // The agent may be queued (state 'idle') if at the concurrency cap — record
    // its actual current state, not a hardcoded 'working'.
    const rec = this.makeRecord(
      agentId,
      ticket.id,
      repo.id,
      branch,
      this.manager.pidOf(agentId),
      this.manager.stateOf(agentId) ?? 'working'
    )
    this.db.insertAgent(rec)
    return this.withRepo(rec, repo.name, repo.path, repo.gitHost, repo.defaultBranch)
  }

  /** producer_first: wait for contract.md, then spawn the consumer agents. */
  private async spawnConsumersWhenReady(
    ticketId: string,
    gen: number,
    ticket: Ticket,
    branch: string,
    consumers: Repo[],
    contractPath: string | null,
    producerAgentId: string
  ): Promise<void> {
    try {
      let start = Date.now()
      let ready = false
      let producerDied = false
      while (Date.now() - start < CONTRACT_WAIT_MS) {
        if (this.launchGen.get(ticketId) !== gen) return // superseded by a relaunch
        if (await this.contracts.hasContract(ticketId)) {
          ready = true
          break
        }
        const producer = this.db.getAgent(producerAgentId)
        if (producer?.state === 'idle') {
          // Producer is still queued (concurrency cap) — don't burn the window
          // before it has even started writing the contract.
          start = Date.now()
        } else if (producer && isSettled(producer.state)) {
          // Don't wait the full window if the producer already gave up.
          producerDied = true
          break
        }
        await delay(CONTRACT_POLL_MS)
      }
      if (this.launchGen.get(ticketId) !== gen) return

      const note = ready
        ? 'contract is ready — starting consumer agents.'
        : producerDied
          ? 'producer finished without a contract — starting consumers now.'
          : 'contract not produced within the wait window — starting consumers anyway.'
      for (const repo of consumers) {
        if (this.launchGen.get(ticketId) !== gen) return // relaunched mid-loop
        await this.spawnFor(repo, ticket, branch, contractPath, true, [note])
      }
      // Tell the renderer about the newly spawned consumer agents.
      this.emit('ticket:agents', {
        ticketId,
        agents: this.db.listAgentsByTicket(ticketId)
      })
    } finally {
      // Clear the pending marker (only ours) and re-evaluate rollup now that
      // consumers exist (or we aborted).
      if (this.pendingConsumers.get(ticketId) === gen) {
        this.pendingConsumers.delete(ticketId)
        this.checkRollup(ticketId)
      }
    }
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
    if (agent.state === 'idle') return // queued — hasn't run yet
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
    // Don't roll up while producer_first consumers are still pending to spawn.
    if (this.pendingConsumers.has(ticketId)) return
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
