import { useEffect, useState } from 'react'
import { Play, Square } from 'lucide-react'
import type { AgentState, AgentStateMsg } from '@shared/types'
import { TerminalPane } from './TerminalPane'
import { AGENT_STATE_LABEL, Button, Input, StatusDot, Textarea } from './ui'

// Dev sandbox: spawn a single read-only agent and watch it stream.
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
    <div className="pk-detail">
      <div className="pk-detail__bar">
        <div className="pk-detail__title">
          <h1>Agent sandbox</h1>
        </div>
        <div className="pk-pane__state">
          <StatusDot state={state} />
          <span className="pk-pane__statelbl">{AGENT_STATE_LABEL[state]}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', flex: 1, minHeight: 0 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            padding: 16,
            borderRight: '1px solid var(--border-subtle)',
            overflowY: 'auto'
          }}
        >
          <Input label="Repo path (cwd)" value={cwd} onChange={(e) => setCwd(e.target.value)} mono />
          <Textarea
            label="Prompt"
            rows={7}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="pk-addform__row">
            <Button
              variant="primary"
              block
              icon={<Play size={13} />}
              onClick={handleSpawn}
              disabled={running || !cwd.trim() || !prompt.trim()}
            >
              {running ? 'Running…' : 'Spawn agent'}
            </Button>
            <Button
              variant="danger"
              icon={<Square size={13} />}
              onClick={handleKill}
              disabled={!running}
            >
              Kill
            </Button>
          </div>
          <div className="pk-form__hint">
            agent: <span style={{ color: 'var(--text-secondary)' }}>{agentId ?? '—'}</span>
          </div>
          {detail && (
            <div className="pk-form__hint" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {detail}
            </div>
          )}
        </div>

        <div className="pk-term" style={{ borderRadius: 0 }}>
          <TerminalPane agentId={agentId} />
        </div>
      </div>
    </div>
  )
}
