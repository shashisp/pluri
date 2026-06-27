import { useState } from 'react'
import { Boxes, FileSignature, GitBranch, Plus } from 'lucide-react'
import type {
  AddRepoInput,
  AgentState,
  GitHost,
  TicketState,
  TicketWithAgents,
  WorkspaceWithRepos
} from '@shared/types'
import { Button, Checkbox, Input, Select, StatusDot } from './ui'

interface SidebarProps {
  workspaces: WorkspaceWithRepos[]
  selectedWsId: string | null
  onSelectWorkspace: (id: string) => void
  onChanged: () => void | Promise<void>
  tickets: TicketWithAgents[]
  agentStates: Record<string, AgentState>
  ticketStates: Record<string, TicketState>
  selectedTicketId: string | null
  onSelectTicket: (id: string) => void
}

export function Sidebar({
  workspaces,
  selectedWsId,
  onSelectWorkspace,
  onChanged,
  tickets,
  agentStates,
  ticketStates,
  selectedTicketId,
  onSelectTicket
}: SidebarProps): JSX.Element {
  const [newWs, setNewWs] = useState('')
  const [addingWs, setAddingWs] = useState(false)
  const [addingRepoFor, setAddingRepoFor] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function createWorkspace(): Promise<void> {
    setError('')
    const name = newWs.trim()
    if (!name) return
    try {
      const ws = await window.api.createWorkspace({ name })
      setNewWs('')
      setAddingWs(false)
      onSelectWorkspace(ws.id)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const stateOf = (t: TicketWithAgents): TicketState => ticketStates[t.id] ?? t.state
  const active = tickets.filter((t) => {
    const s = stateOf(t)
    return s === 'running' || s === 'awaiting_review'
  })
  const runningCount = tickets.filter((t) => stateOf(t) === 'running').length
  const reviewCount = tickets.filter((t) => stateOf(t) === 'awaiting_review').length

  return (
    <aside className="pk-side">
      <div className="pk-side__section">
        <div className="pk-side__head">
          <span>Workspaces</span>
          <button className="pk-side__add" onClick={() => setAddingWs((v) => !v)} title="Add workspace">
            <Plus size={13} />
          </button>
        </div>

        {addingWs && (
          <div className="pk-addform">
            <div className="pk-addform__row">
              <Input
                placeholder="Workspace name…"
                value={newWs}
                onChange={(e) => setNewWs(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createWorkspace()}
                autoFocus
              />
              <Button variant="primary" onClick={createWorkspace} disabled={!newWs.trim()}>
                Add
              </Button>
            </div>
          </div>
        )}
        {error && <div className="pk-side__error">{error}</div>}

        {workspaces.length === 0 && !addingWs && (
          <div className="pk-side__error" style={{ color: 'var(--text-muted)' }}>
            No workspaces yet.
          </div>
        )}

        {workspaces.map((ws) => {
          const isSel = ws.id === selectedWsId
          return (
            <div key={ws.id}>
              <button
                className={`pk-ws-row${isSel ? ' pk-ws-row--active' : ''}`}
                onClick={() => onSelectWorkspace(ws.id)}
              >
                <Boxes size={15} style={{ color: 'var(--text-secondary)' }} />
                <span className="pk-ws-row__name">{ws.name}</span>
                <span className="pk-ws-row__count">{ws.repos.length}</span>
              </button>

              {isSel && (
                <div className="pk-repos">
                  {ws.repos.map((repo) => (
                    <div className="pk-repo" key={repo.id} title={repo.path}>
                      <GitBranch size={14} style={{ color: 'var(--text-muted)' }} />
                      <span className="pk-repo__name">{repo.name}</span>
                      {repo.isContractProducer && (
                        <span className="pk-repo__producer" title="Contract producer">
                          <FileSignature size={12} />
                        </span>
                      )}
                      <span className="pk-repo__host">{repo.gitHost === 'github' ? 'GH' : 'GL'}</span>
                    </div>
                  ))}

                  {addingRepoFor === ws.id ? (
                    <AddRepoForm
                      workspaceId={ws.id}
                      onDone={async () => {
                        setAddingRepoFor(null)
                        await onChanged()
                      }}
                      onCancel={() => setAddingRepoFor(null)}
                    />
                  ) : (
                    <button className="pk-addrepo" onClick={() => setAddingRepoFor(ws.id)}>
                      <Plus size={13} /> Add repo
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {selectedWsId && active.length > 0 && (
        <div className="pk-side__section">
          <div className="pk-side__head">
            <span>Active tickets</span>
          </div>
          <div className="pk-navlist">
            {active.map((t) => (
              <button
                key={t.id}
                className={`pk-nav${t.id === selectedTicketId ? ' pk-nav--active' : ''}`}
                onClick={() => onSelectTicket(t.id)}
              >
                <span className="pk-nav__dots">
                  {t.agents.slice(0, 4).map((a) => (
                    <StatusDot key={a.id} state={agentStates[a.id] ?? a.state} />
                  ))}
                </span>
                <span className="pk-nav__title">{t.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="pk-side__spacer" />
      {selectedWsId && (
        <div className="pk-side__foot">
          <div className="pk-stat">
            <span className="pk-stat__n">{runningCount}</span> running
          </div>
          <div className="pk-stat">
            <span className="pk-stat__n">{reviewCount}</span> to review
          </div>
        </div>
      )}
    </aside>
  )
}

interface AddRepoFormProps {
  workspaceId: string
  onDone: () => void | Promise<void>
  onCancel: () => void
}

function AddRepoForm({ workspaceId, onDone, onCancel }: AddRepoFormProps): JSX.Element {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [gitHost, setGitHost] = useState<GitHost>('github')
  const [defaultBranch, setDefaultBranch] = useState('main')
  const [isProducer, setIsProducer] = useState(false)
  const [producerTouched, setProducerTouched] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function applyName(v: string): void {
    setName(v)
    if (!producerTouched) setIsProducer(v.trim().toLowerCase() === 'backend')
  }

  async function browse(): Promise<void> {
    const picked = await window.api.pickDirectory()
    if (picked) {
      setPath(picked)
      if (!name.trim()) applyName(picked.split('/').filter(Boolean).pop() ?? '')
    }
  }

  async function submit(): Promise<void> {
    setError('')
    setBusy(true)
    try {
      const input: AddRepoInput = {
        workspaceId,
        name: name.trim(),
        path: path.trim(),
        gitHost,
        defaultBranch: defaultBranch.trim() || 'main',
        isContractProducer: isProducer
      }
      await window.api.addRepo(input)
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pk-addform">
      <Input placeholder="name (e.g. backend)" value={name} onChange={(e) => applyName(e.target.value)} />
      <div className="pk-addform__row">
        <Input placeholder="/abs/path/to/repo" value={path} onChange={(e) => setPath(e.target.value)} mono />
        <Button onClick={browse}>Browse</Button>
      </div>
      <div className="pk-addform__row">
        <Select
          value={gitHost}
          onChange={(e) => setGitHost(e.target.value as GitHost)}
          options={[
            { value: 'github', label: 'github' },
            { value: 'gitlab', label: 'gitlab' }
          ]}
        />
        <Input placeholder="branch" value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} />
      </div>
      <Checkbox
        checked={isProducer}
        onChange={(c) => {
          setProducerTouched(true)
          setIsProducer(c)
        }}
        label="contract producer"
      />
      {error && <div className="pk-error">{error}</div>}
      <div className="pk-addform__row">
        <Button
          variant="primary"
          block
          onClick={submit}
          disabled={busy || !name.trim() || !path.trim()}
        >
          {busy ? 'Adding…' : 'Add repo'}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
