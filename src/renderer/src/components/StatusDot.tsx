import type { AgentState } from '@shared/types'

const STATE_META: Record<AgentState, { dot: string; label: string }> = {
  idle: { dot: 'bg-neutral-500', label: 'idle' },
  working: { dot: 'bg-yellow-400 animate-pulse', label: 'working' },
  awaiting_mr: { dot: 'bg-blue-400', label: 'awaiting MR' },
  mr_open: { dot: 'bg-green-500', label: 'MR open' },
  done: { dot: 'bg-green-500', label: 'done' },
  killed: { dot: 'bg-red-500', label: 'killed' },
  error: { dot: 'bg-red-500', label: 'error' }
}

export function StatusDot({ state }: { state: AgentState }): JSX.Element {
  const meta = STATE_META[state]
  return (
    <span className="inline-flex items-center gap-2 text-xs text-neutral-300">
      <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  )
}
