import { useEffect, useMemo, useState } from 'react'
import type { AgentState, AgentStateMsg } from '@shared/types'
import { TerminalPane } from './components/TerminalPane'

// Phase 1 defaults: a single hardcoded-ish target and a safe, read-only prompt.
const DEFAULT_CWD = '/Users/shashikumarp/sideprojects/pluri'
const DEFAULT_PROMPT =
  'Read the files in this repository and give me a concise summary of what it does, its tech stack, and its entry points. Do not modify anything.'
const DEFAULT_SYSTEM_PROMPT =
  'You are operating ONLY inside the current working directory. Do not touch anything outside it.'

const STATE_META: Record<AgentState, { dot: string; label: string }> = {
  idle: { dot: 'bg-neutral-500', label: 'idle' },
  working: { dot: 'bg-yellow-400 animate-pulse', label: 'working' },
  awaiting_mr: { dot: 'bg-blue-400', label: 'awaiting MR' },
  mr_open: { dot: 'bg-green-500', label: 'MR open' },
  done: { dot: 'bg-green-500', label: 'done' },
  killed: { dot: 'bg-red-500', label: 'killed' },
  error: { dot: 'bg-red-500', label: 'error' }
}

function StatusDot({ state }: { state: AgentState }): JSX.Element {
  const meta = STATE_META[state]
  return (
    <span className="inline-flex items-center gap-2 text-xs text-neutral-300">
      <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  )
}

export default function App(): JSX.Element {
  const [cwd, setCwd] = useState(DEFAULT_CWD)
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [agentId, setAgentId] = useState<string | null>(null)
  const [state, setState] = useState<AgentState>('idle')
  const [detail, setDetail] = useState<string>('')

  const running = state === 'working'

  useEffect(() => {
    const unsubscribe = window.api.onAgentState((msg: AgentStateMsg) => {
      // Only track the agent we spawned from this pane.
      setAgentId((current) => {
        if (msg.agentId !== current) return current
        setState(msg.state)
        if (msg.error) setDetail(msg.error)
        else if (msg.result) setDetail('finished')
        return current
      })
    })
    return unsubscribe
  }, [])

  async function handleSpawn(): Promise<void> {
    setDetail('')
    setState('working')
    try {
      const { agentId: id } = await window.api.spawnAgent({
        cwd,
        prompt,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        allowedTools: 'Read'
      })
      setAgentId(id)
    } catch (err) {
      setState('error')
      setDetail(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleKill(): Promise<void> {
    if (agentId) await window.api.killAgent(agentId)
  }

  const header = useMemo(
    () => (
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tracking-tight">Pluri</span>
          <span className="text-xs text-neutral-500">
            Phase 1 — single agent spawn &amp; stream
          </span>
        </div>
        <StatusDot state={state} />
      </div>
    ),
    [state]
  )

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] text-neutral-200">
      {header}

      <div className="grid grid-cols-[360px_1fr] flex-1 overflow-hidden">
        {/* Controls */}
        <div className="flex flex-col gap-3 overflow-y-auto border-r border-neutral-800 p-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-400">Repo path (cwd)</span>
            <input
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs outline-none focus:border-neutral-500"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              spellCheck={false}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-400">Prompt</span>
            <textarea
              className="h-40 resize-none rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs outline-none focus:border-neutral-500"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              spellCheck={false}
            />
          </label>

          <div className="flex gap-2">
            <button
              className="flex-1 rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={handleSpawn}
              disabled={running || !cwd.trim() || !prompt.trim()}
            >
              {running ? 'Running…' : 'Spawn agent'}
            </button>
            <button
              className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={handleKill}
              disabled={!running}
            >
              Kill
            </button>
          </div>

          <div className="mt-1 text-xs text-neutral-500">
            <div>
              agent: <span className="text-neutral-300">{agentId ?? '—'}</span>
            </div>
            {detail && (
              <div className="mt-1 whitespace-pre-wrap break-words text-neutral-400">
                {detail}
              </div>
            )}
          </div>

          <p className="mt-auto text-[11px] leading-relaxed text-neutral-600">
            Read-only prompt (allowedTools = Read). Spawns{' '}
            <code className="text-neutral-400">claude -p … --output-format stream-json</code>{' '}
            in the repo path and streams events into the pane.
          </p>
        </div>

        {/* Terminal */}
        <div className="min-w-0">
          <TerminalPane agentId={agentId} />
        </div>
      </div>
    </div>
  )
}
