// Shared types used across main, preload, and renderer.
// Keep this file free of runtime imports so it can be type-stripped/erased anywhere.

/**
 * Lifecycle of a single agent.
 *  idle        -> created, not yet running
 *  working     -> claude process running
 *  awaiting_mr -> finished, branch pushed, MR not yet opened   (Phase 4)
 *  mr_open     -> MR/PR created                                 (Phase 4)
 *  done        -> finished cleanly (Phase 1 terminal state before git wiring)
 *  killed      -> killed by the user
 *  error       -> spawn failure / non-zero exit / result error
 */
export type AgentState =
  | 'idle'
  | 'working'
  | 'awaiting_mr'
  | 'mr_open'
  | 'done'
  | 'killed'
  | 'error'

/** One content block inside an assistant/user message in stream-json. */
export interface ClaudeContentBlock {
  type: string // 'text' | 'thinking' | 'tool_use' | 'tool_result' | ...
  text?: string
  thinking?: string
  name?: string // tool_use
  input?: unknown // tool_use
  content?: unknown // tool_result
  is_error?: boolean // tool_result
  [k: string]: unknown
}

/**
 * A single parsed line of `claude --output-format stream-json --verbose`.
 * The schema is intentionally loose — the CLI emits more event types than are
 * documented (rate_limit_event, system/hook_*, system/thinking_tokens, ...),
 * so consumers must tolerate unknown shapes.
 */
export interface ClaudeStreamEvent {
  type: string // 'system' | 'assistant' | 'user' | 'result' | 'rate_limit_event' | ...
  subtype?: string // 'init' | 'success' | 'error' | 'hook_started' | ...
  message?: { role?: string; content?: ClaudeContentBlock[] }
  // result event fields
  result?: string
  is_error?: boolean
  session_id?: string
  total_cost_usd?: number
  duration_ms?: number
  num_turns?: number
  // system/init fields we care about
  model?: string
  cwd?: string
  [k: string]: unknown
}

// ---- IPC payloads -----------------------------------------------------------

export interface SpawnAgentRequest {
  /** Absolute path to the repo folder; the agent is isolated to this cwd. */
  cwd: string
  /** The ticket spec / prompt passed to `claude -p`. */
  prompt: string
  /** Optional per-repo scope prompt for `--append-system-prompt`. */
  systemPrompt?: string
  /** Comma-separated allowed tools; defaults to a read-only set in Phase 1. */
  allowedTools?: string
  /** Extra directories the agent may read/write (`--add-dir`), e.g. the contract folder. */
  addDirs?: string[]
}

export interface SpawnAgentResult {
  agentId: string
}

/** Raw + parsed line streamed to the renderer for a terminal pane. */
export interface AgentEventMsg {
  agentId: string
  /** Monotonic per-agent sequence — lets a remounted pane dedup backfill vs live. */
  seq: number
  /** The original line (stdout) or chunk (stderr); never JSON-mangled. */
  raw: string
  /** Source stream. */
  stream: 'stdout' | 'stderr'
  /** Parsed event if the line was valid JSON, else null. */
  parsed: ClaudeStreamEvent | null
}

export interface AgentStateMsg {
  agentId: string
  state: AgentState
  /** Final assistant text from the `result` event, when available. */
  result?: string
  /** Human-readable error detail when state === 'error'. */
  error?: string
  /** Exit code when the process closed. */
  exitCode?: number | null
  /** MR/PR URL once opened (Phase 4). */
  mrUrl?: string | null
}

// ---- Persisted data model (Phase 2+) ---------------------------------------

export type GitHost = 'github' | 'gitlab'
export type TicketState = 'draft' | 'running' | 'awaiting_review' | 'done'

/**
 * How agents in a ticket are spawned.
 *  concurrent     — all at once (Phase 3).
 *  producer_first — spawn the contract producer first, consumers after the
 *                   contract exists (Phase 5).
 */
export type OrderingMode = 'concurrent' | 'producer_first'

export interface Workspace {
  id: string
  name: string
  createdAt: number
}

export interface Repo {
  id: string
  workspaceId: string
  name: string // "backend", "frontend", "ios"
  path: string // absolute path on disk
  gitHost: GitHost
  defaultBranch: string // e.g. "main"
  isContractProducer: boolean
}

/** A workspace with its repos eagerly loaded — what the sidebar renders. */
export interface WorkspaceWithRepos extends Workspace {
  repos: Repo[]
}

export interface Ticket {
  id: string
  workspaceId: string
  title: string
  spec: string
  /** Repo.id values this ticket targets. */
  targetRepoIds: string[]
  state: TicketState
  orderingMode: OrderingMode
  createdAt: number
}

/** Persisted agent record (distinct from the live process in AgentManager). */
export interface AgentRecord {
  id: string
  ticketId: string
  repoId: string
  branch: string | null
  pid: number | null
  state: AgentState
  mrUrl: string | null
  startedAt: number | null
  endedAt: number | null
}

// ---- Data-model IPC payloads -----------------------------------------------

export interface CreateWorkspaceInput {
  name: string
}

export interface AddRepoInput {
  workspaceId: string
  name: string
  path: string
  gitHost: GitHost
  defaultBranch: string
  isContractProducer: boolean
}

export interface CreateTicketInput {
  workspaceId: string
  title: string
  spec: string
  targetRepoIds: string[]
  orderingMode: OrderingMode
}

/** An agent record joined with its repo, for panes and status dots. */
export interface AgentWithRepo extends AgentRecord {
  repoName: string
  repoPath: string
  gitHost: GitHost
  defaultBranch: string
}

/** A ticket with its agents (live + persisted) — what the board/detail render. */
export interface TicketWithAgents extends Ticket {
  agents: AgentWithRepo[]
}

export interface LaunchResult {
  ticketId: string
  agents: AgentWithRepo[]
}

/** main -> renderer ticket lifecycle event. */
export interface TicketStateMsg {
  ticketId: string
  state: TicketState
}

/** main -> renderer: a ticket's agent list changed (e.g. producer_first consumers). */
export interface TicketAgentsMsg {
  ticketId: string
  agents: AgentWithRepo[]
}

/** main -> renderer: live contract.md content for a ticket. */
export interface ContractUpdateMsg {
  ticketId: string
  content: string
}

// ---- Settings (Phase 6) ----------------------------------------------------

export interface AppSettings {
  /** Max agents running at once; the rest queue. */
  maxConcurrentAgents: number
  /** Pre-selected ordering mode in the new-ticket form. */
  defaultOrderingMode: OrderingMode
  /** Comma-separated tools agents may use when implementing a ticket. */
  agentTools: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  maxConcurrentAgents: 6,
  defaultOrderingMode: 'concurrent',
  agentTools: 'Bash,Edit,Read,Write'
}
