import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  createLineBuffer,
  isErrorResult,
  isTerminalEvent,
  parseEventLine,
  type LineBuffer
} from '@shared/streamParser'
import type {
  AgentEventMsg,
  AgentState,
  AgentStateMsg,
  SpawnAgentRequest
} from '@shared/types'

/** How long to wait after SIGTERM before escalating to SIGKILL. */
const KILL_GRACE_MS = 2000

/** stdio is ['ignore','pipe','pipe'] -> stdin null, stdout/stderr readable. */
type AgentChild = ChildProcessByStdio<null, Readable, Readable>

interface ManagedAgent {
  id: string
  child: AgentChild
  state: AgentState
  stdout: LineBuffer
  killTimer?: NodeJS.Timeout
  /**
   * True once the process has actually exited ('close' or spawn 'error').
   * NOTE: do not use child.killed for this — Node sets child.killed=true the
   * instant a signal is *delivered*, not when the process exits, which would
   * make SIGKILL escalation dead code.
   */
  exited: boolean
  /** The cwd the agent was spawned in (for clearer spawn-error messages). */
  cwd: string
}

/**
 * Owns the lifecycle of headless Claude Code child processes.
 *
 * Deliberately free of any Electron dependency: it emits 'event' and 'state'
 * which the IPC layer forwards to the renderer. That keeps the hardest plumbing
 * (spawn / stream-json parsing / kill) unit-testable in plain Node.
 *
 * Emits:
 *   'event' -> AgentEventMsg   (every stdout line + stderr chunk)
 *   'state' -> AgentStateMsg   (lifecycle transitions)
 */
/** Per-agent retained events, so a (re)mounted terminal pane can backfill. */
const LOG_RING_MAX = 2000
/** Max number of agents whose logs we keep after they exit (oldest evicted). */
const LOG_AGENTS_MAX = 100

export class AgentManager extends EventEmitter {
  private agents = new Map<string, ManagedAgent>()
  // Logs live separately from `agents` so they survive after the process exits
  // (and the live ManagedAgent is deleted). Insertion-ordered for LRU eviction.
  private logs = new Map<string, AgentEventMsg[]>()
  // Monotonic per-agent event sequence (parallel lifetime to `logs`).
  private seqByAgent = new Map<string, number>()

  /** Buffered events for an agent (for pane backfill on mount). */
  getLog(id: string): AgentEventMsg[] {
    return this.logs.get(id) ?? []
  }

  /**
   * Inject an orchestrator note into an agent's stream (e.g. push/MR progress).
   * Goes through the same ring + seq + 'event' path so it backfills and renders
   * in the pane. Safe to call after the process has exited (logs outlive it).
   */
  appendNote(id: string, text: string): void {
    if (!this.logs.has(id)) return
    this.emitEvent({ agentId: id, raw: `» ${text}`, stream: 'stdout', parsed: null })
  }

  /** OS pid of a live agent, or null. */
  pidOf(id: string): number | null {
    return this.agents.get(id)?.child.pid ?? null
  }

  /**
   * Spawn a headless Claude Code agent isolated to `req.cwd`.
   * Returns the generated agent id immediately; output arrives via 'event'.
   */
  spawnAgent(req: SpawnAgentRequest): string {
    const id = randomUUID()

    const args = ['-p', req.prompt]
    if (req.systemPrompt) args.push('--append-system-prompt', req.systemPrompt)
    args.push(
      '--allowedTools',
      req.allowedTools ?? 'Read',
      '--output-format',
      'stream-json',
      '--verbose'
    )

    // stdin: 'ignore' gives the child an immediate EOF so `claude` doesn't wait
    // ~3s for piped stdin. Inherit env so Claude Code's existing auth is used —
    // we never inject or manage API keys.
    const child: AgentChild = spawn('claude', args, {
      cwd: req.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const agent: ManagedAgent = {
      id,
      child,
      state: 'working',
      stdout: createLineBuffer(),
      exited: false,
      cwd: req.cwd
    }
    this.agents.set(id, agent)

    // Start a fresh log ring; evict the oldest *terminated* agent's logs if over
    // the cap. Never evict a live agent (it would reset its seq and drop output).
    this.logs.set(id, [])
    this.seqByAgent.set(id, 0)
    while (this.logs.size > LOG_AGENTS_MAX) {
      let evicted = false
      for (const key of this.logs.keys()) {
        if (!this.agents.has(key)) {
          this.logs.delete(key)
          this.seqByAgent.delete(key)
          evicted = true
          break
        }
      }
      if (!evicted) break // all remaining logs belong to live agents
    }

    this.setState(id, 'working')

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onStdout(agent, chunk))

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      // stderr is forwarded raw (warnings, tracebacks) — never parsed as JSON.
      this.emitEvent({ agentId: id, raw: chunk, stream: 'stderr', parsed: null })
    })

    child.on('error', (err: NodeJS.ErrnoException) => this.onSpawnError(agent, err))
    child.on('close', (code) => this.onClose(agent, code))

    return id
  }

  /** Kill an agent (SIGTERM, then SIGKILL after a grace period). */
  killAgent(id: string): void {
    const agent = this.agents.get(id)
    if (!agent) return
    if (agent.state === 'killed' || this.isTerminal(agent.state)) return

    this.setState(id, 'killed')
    agent.child.kill('SIGTERM')
    // Escalate to SIGKILL if the process hasn't actually exited within the grace
    // window. Gate on our own `exited` flag, NOT child.killed (see ManagedAgent).
    agent.killTimer = setTimeout(() => {
      if (!agent.exited) agent.child.kill('SIGKILL')
    }, KILL_GRACE_MS)
  }

  /** Force-kill every tracked process. Call on app quit. */
  killAll(): void {
    for (const agent of this.agents.values()) {
      if (agent.killTimer) clearTimeout(agent.killTimer)
      if (!agent.exited) agent.child.kill('SIGKILL')
    }
  }

  // ---- internals ------------------------------------------------------------

  private onStdout(agent: ManagedAgent, chunk: string): void {
    for (const line of agent.stdout.push(chunk)) {
      this.handleLine(agent, line)
    }
  }

  private handleLine(agent: ManagedAgent, line: string): void {
    if (line.trim().length === 0) return
    const parsed = parseEventLine(line)
    // Always forward the event to the pane, even after a kill (useful context).
    this.emitEvent({ agentId: agent.id, raw: line, stream: 'stdout', parsed })

    if (parsed && isTerminalEvent(parsed)) {
      // First terminal transition wins: a late `result` line that arrives after
      // the user killed the agent (or after another terminal state) must not
      // overwrite it.
      if (agent.state === 'killed' || this.isTerminal(agent.state)) return
      const errored = isErrorResult(parsed)
      this.setState(agent.id, errored ? 'error' : 'done', {
        result: parsed.result,
        error: errored ? (parsed.result ?? 'agent reported an error') : undefined
      })
    }
  }

  private onSpawnError(agent: ManagedAgent, err: NodeJS.ErrnoException): void {
    agent.exited = true
    // ENOENT can mean either the cwd is gone or `claude` isn't on PATH.
    let detail: string
    if (err.code === 'ENOENT' && !existsSync(agent.cwd)) {
      detail = `Repo path no longer exists: ${agent.cwd}`
    } else if (err.code === 'ENOENT') {
      detail =
        '`claude` was not found on PATH. Install Claude Code and ensure `claude` is runnable from a terminal.'
    } else {
      detail = `Failed to spawn agent: ${err.message}`
    }
    this.setState(agent.id, 'error', { error: detail })
    // ENOENT/spawn failures may emit 'error' without a following 'close', so
    // clean up here to avoid leaking the agent record.
    this.agents.delete(agent.id)
  }

  private onClose(agent: ManagedAgent, code: number | null): void {
    agent.exited = true
    if (agent.killTimer) {
      clearTimeout(agent.killTimer)
      agent.killTimer = undefined
    }

    // Flush any trailing partial line that never got a newline. handleLine has
    // its own terminal guard, so a flushed `result` won't override 'killed'.
    const tail = agent.stdout.flush()
    if (tail) this.handleLine(agent, tail)

    const current = this.agents.get(agent.id)
    // Finalize state unless a terminal/kill state already won.
    if (current && current.state !== 'killed' && !this.isTerminal(current.state)) {
      if (code === 0) {
        this.setState(agent.id, 'done', { exitCode: code })
      } else {
        this.setState(agent.id, 'error', {
          exitCode: code,
          error: `agent exited with code ${code ?? 'null'}`
        })
      }
    }

    // Release the process + stream handles; final state was already emitted.
    this.agents.delete(agent.id)
  }

  private isTerminal(state: AgentState): boolean {
    return state === 'done' || state === 'error' || state === 'mr_open'
  }

  private setState(
    id: string,
    state: AgentState,
    extra: Omit<AgentStateMsg, 'agentId' | 'state'> = {}
  ): void {
    const agent = this.agents.get(id)
    if (agent) agent.state = state
    this.emit('state', { agentId: id, state, ...extra } satisfies AgentStateMsg)
  }

  private emitEvent(partial: Omit<AgentEventMsg, 'seq'>): void {
    const seq = (this.seqByAgent.get(partial.agentId) ?? 0) + 1
    this.seqByAgent.set(partial.agentId, seq)
    const msg: AgentEventMsg = { ...partial, seq }

    const ring = this.logs.get(msg.agentId)
    if (ring) {
      ring.push(msg)
      if (ring.length > LOG_RING_MAX) ring.shift()
    }
    this.emit('event', msg)
  }
}
