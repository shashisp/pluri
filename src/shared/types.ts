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
}

export interface SpawnAgentResult {
  agentId: string
}

/** Raw + parsed line streamed to the renderer for a terminal pane. */
export interface AgentEventMsg {
  agentId: string
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
}
