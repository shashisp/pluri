import { useState } from 'react'
import type { AddRepoInput, GitHost, WorkspaceWithRepos } from '@shared/types'

interface SidebarProps {
  workspaces: WorkspaceWithRepos[]
  selectedWsId: string | null
  onSelect: (id: string) => void
  onChanged: () => void | Promise<void>
}

export function Sidebar({
  workspaces,
  selectedWsId,
  onSelect,
  onChanged
}: SidebarProps): JSX.Element {
  const [newWs, setNewWs] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [addingRepoFor, setAddingRepoFor] = useState<string | null>(null)
  const [error, setError] = useState<string>('')

  async function createWorkspace(): Promise<void> {
    setError('')
    const name = newWs.trim()
    if (!name) return
    try {
      const ws = await window.api.createWorkspace({ name })
      setNewWs('')
      setExpanded((e) => ({ ...e, [ws.id]: true }))
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function toggle(id: string): void {
    setExpanded((e) => ({ ...e, [id]: !e[id] }))
  }

  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Workspaces
      </div>

      {/* New workspace */}
      <div className="flex gap-1 px-2 pb-2">
        <input
          className="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-neutral-600"
          placeholder="New workspace name…"
          value={newWs}
          onChange={(e) => setNewWs(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createWorkspace()}
          spellCheck={false}
        />
        <button
          className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
          onClick={createWorkspace}
          disabled={!newWs.trim()}
        >
          +
        </button>
      </div>

      {error && <div className="px-3 pb-2 text-xs text-red-400">{error}</div>}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-1 pb-2">
        {workspaces.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-neutral-600">
            No workspaces yet. Add one above.
          </div>
        )}

        {workspaces.map((ws) => {
          const isOpen = expanded[ws.id] ?? false
          const isSel = ws.id === selectedWsId
          return (
            <div key={ws.id} className="mb-1">
              <button
                className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-neutral-900 ${
                  isSel ? 'bg-neutral-900' : ''
                }`}
                onClick={() => {
                  onSelect(ws.id)
                  toggle(ws.id)
                }}
              >
                <span className="text-neutral-500">{isOpen ? '▾' : '▸'}</span>
                <span className="truncate font-medium">{ws.name}</span>
                <span className="ml-auto text-[10px] text-neutral-600">
                  {ws.repos.length}
                </span>
              </button>

              {isOpen && (
                <div className="ml-4 border-l border-neutral-800 pl-2">
                  {ws.repos.map((repo) => (
                    <div
                      key={repo.id}
                      className="flex items-center gap-1.5 px-2 py-1 text-xs text-neutral-300"
                      title={repo.path}
                    >
                      <span className="truncate">{repo.name}</span>
                      {repo.isContractProducer && (
                        <span
                          className="rounded bg-amber-900/50 px-1 text-[9px] text-amber-300"
                          title="contract producer"
                        >
                          producer
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-neutral-600">
                        {repo.gitHost}
                      </span>
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
                    <button
                      className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
                      onClick={() => setAddingRepoFor(ws.id)}
                    >
                      + Add repo
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
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
  // Once the user toggles the checkbox, stop auto-deriving from the name.
  const [producerTouched, setProducerTouched] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Convention from spec: a repo named "backend" defaults to contract producer.
  // Re-derived on every name change (until the user overrides it), so renaming
  // away from "backend" also clears the default.
  function applyName(v: string): void {
    setName(v)
    if (!producerTouched) setIsProducer(v.trim().toLowerCase() === 'backend')
  }

  function toggleProducer(checked: boolean): void {
    setProducerTouched(true)
    setIsProducer(checked)
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

  const inputCls =
    'w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-neutral-600'

  return (
    <div className="mt-1 flex flex-col gap-1.5 rounded border border-neutral-800 bg-neutral-900/60 p-2">
      <input
        className={inputCls}
        placeholder="name (e.g. backend)"
        value={name}
        onChange={(e) => applyName(e.target.value)}
        spellCheck={false}
      />
      <div className="flex gap-1">
        <input
          className={inputCls}
          placeholder="/abs/path/to/repo"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          spellCheck={false}
        />
        <button
          className="shrink-0 rounded bg-neutral-800 px-2 text-xs hover:bg-neutral-700"
          onClick={browse}
          type="button"
        >
          Browse
        </button>
      </div>
      <div className="flex gap-1">
        <select
          className={inputCls}
          value={gitHost}
          onChange={(e) => setGitHost(e.target.value as GitHost)}
        >
          <option value="github">github</option>
          <option value="gitlab">gitlab</option>
        </select>
        <input
          className={inputCls}
          placeholder="default branch"
          value={defaultBranch}
          onChange={(e) => setDefaultBranch(e.target.value)}
          spellCheck={false}
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-neutral-400">
        <input
          type="checkbox"
          checked={isProducer}
          onChange={(e) => toggleProducer(e.target.checked)}
        />
        Contract producer
      </label>
      {error && <div className="text-xs text-red-400">{error}</div>}
      <div className="flex gap-1">
        <button
          className="flex-1 rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          onClick={submit}
          disabled={busy || !name.trim() || !path.trim()}
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button
          className="rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
