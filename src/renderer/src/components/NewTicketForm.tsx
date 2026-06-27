import { useState } from 'react'
import type { OrderingMode, WorkspaceWithRepos } from '@shared/types'

interface NewTicketFormProps {
  workspace: WorkspaceWithRepos
  onClose: () => void
  /** Called after create (and optional launch). */
  onDone: (ticketId: string, launched: boolean) => void | Promise<void>
}

export function NewTicketForm({
  workspace,
  onClose,
  onDone
}: NewTicketFormProps): JSX.Element {
  const [title, setTitle] = useState('')
  const [spec, setSpec] = useState('')
  const [targetRepoIds, setTargetRepoIds] = useState<string[]>(
    workspace.repos.map((r) => r.id) // default: target all repos
  )
  const [orderingMode, setOrderingMode] = useState<OrderingMode>('concurrent')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function toggleRepo(id: string): void {
    setTargetRepoIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    )
  }

  async function submit(launch: boolean): Promise<void> {
    setError('')
    if (!title.trim()) return setError('Title is required')
    if (targetRepoIds.length === 0) return setError('Select at least one repo')
    setBusy(true)
    try {
      const ticket = await window.api.createTicket({
        workspaceId: workspace.id,
        title: title.trim(),
        spec,
        targetRepoIds,
        orderingMode
      })
      if (launch) await window.api.launchTicket(ticket.id)
      await onDone(ticket.id, launch)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const inputCls =
    'w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-neutral-500'

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-6">
      <div className="flex max-h-full w-[560px] flex-col gap-3 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">New ticket · {workspace.name}</h2>
          <button
            className="text-neutral-500 hover:text-neutral-300"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-400">Title</span>
          <input
            className={inputCls}
            placeholder="e.g. Add login page"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-400">Spec</span>
          <textarea
            className={`${inputCls} h-32 resize-none`}
            placeholder="What should the agents build? This is the prompt each agent receives."
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-400">Target repos</span>
          {workspace.repos.length === 0 ? (
            <div className="text-xs text-neutral-600">
              This workspace has no repos. Add some from the sidebar first.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1">
              {workspace.repos.map((repo) => (
                <label
                  key={repo.id}
                  className="flex items-center gap-2 rounded border border-neutral-800 px-2 py-1 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={targetRepoIds.includes(repo.id)}
                    onChange={() => toggleRepo(repo.id)}
                  />
                  <span className="truncate">{repo.name}</span>
                  {repo.isContractProducer && (
                    <span className="ml-auto rounded bg-amber-900/50 px-1 text-[9px] text-amber-300">
                      producer
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-400">Ordering</span>
          <div className="flex gap-4 text-sm">
            {(['concurrent', 'producer_first'] as OrderingMode[]).map((m) => (
              <label key={m} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="ordering"
                  checked={orderingMode === m}
                  onChange={() => setOrderingMode(m)}
                />
                {m === 'concurrent' ? 'Concurrent' : 'Producer first'}
              </label>
            ))}
          </div>
          <span className="text-[11px] text-neutral-600">
            Producer-first ordering takes effect in Phase 5; Phase 3 launches
            concurrently.
          </span>
        </div>

        {error && <div className="text-xs text-red-400">{error}</div>}

        <div className="mt-1 flex justify-end gap-2">
          <button
            className="rounded bg-neutral-800 px-3 py-1.5 text-xs hover:bg-neutral-700 disabled:opacity-40"
            onClick={() => submit(false)}
            disabled={busy || !title.trim() || targetRepoIds.length === 0}
          >
            Save draft
          </button>
          <button
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            onClick={() => submit(true)}
            disabled={busy || !title.trim() || targetRepoIds.length === 0}
          >
            {busy ? 'Launching…' : 'Launch'}
          </button>
        </div>
      </div>
    </div>
  )
}
