import { useEffect, useState } from 'react'
import type { AgentState, AgentStateMsg } from '@shared/types'
import { TerminalPane } from './TerminalPane'
import { StatusDot } from './StatusDot'

// Phase 1 harness: spawn a single agent and watch it stream. Kept as a dev
// sandbox now that the real flow (tickets -> N agents) arrives in Phase 3.
const DEFAULT_CWD = '/Users/shashikumarp/sideprojects/pluri'
const DEFAULT_PROMPT =
  'Read the files in this repository and give me a concise summary of what it does, its tech stack, and its entry points. Do not modify anything.'
const DEFAULT_SYSTEM_PROMPT =
  'You are operating ONLY inside the current working directory. Do not touch anything outside it.'

export function AgentSandbox(): JSX.Element {
  const [cwd, setCwd] = useState(DEFAULT_CWD)
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [agentId, setAgentId] = useState<string | null>(null)
  const [state, setState] = useState<AgentState>('idle')
  const [detail, setDetail] = useState<string>('')

  const running = state === 'working'

  useEffect(() => {
    const unsubscribe = window.api.onAgentState((msg: AgentStateMsg) => {
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

  return (
    <div className="grid h-full grid-cols-[340px_1fr] overflow-hidden">
      <div className="flex flex-col gap-3 overflow-y-auto border-r border-neutral-800 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Agent sandbox
          </span>
          <StatusDot state={state} />
        </div>

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
      </div>

      <div className="min-w-0">
        <TerminalPane agentId={agentId} />
      </div>
    </div>
  )
}
