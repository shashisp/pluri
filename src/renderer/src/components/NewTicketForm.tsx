import { useState } from 'react'
import { GitBranch, Play, TriangleAlert } from 'lucide-react'
import type { OrderingMode, WorkspaceWithRepos } from '@shared/types'
import { Badge, Button, Checkbox, Dialog, Input, Select, Textarea } from './ui'

interface NewTicketFormProps {
  workspace: WorkspaceWithRepos
  defaultOrderingMode: OrderingMode
  onClose: () => void
  onDone: (ticketId: string, launched: boolean) => void | Promise<void>
}

export function NewTicketForm({
  workspace,
  defaultOrderingMode,
  onClose,
  onDone
}: NewTicketFormProps): JSX.Element {
  const [title, setTitle] = useState('')
  const [spec, setSpec] = useState('')
  const [targetRepoIds, setTargetRepoIds] = useState<string[]>(
    workspace.repos.map((r) => r.id)
  )
  const [orderingMode, setOrderingMode] = useState<OrderingMode>(defaultOrderingMode)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function toggleRepo(id: string): void {
    setTargetRepoIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    )
  }

  const producerTargeted = workspace.repos.some(
    (r) => targetRepoIds.includes(r.id) && r.isContractProducer
  )
  const canSubmit = title.trim().length > 0 && targetRepoIds.length > 0

  async function submit(launch: boolean): Promise<void> {
    setError('')
    if (!canSubmit) return setError('Title and at least one repo are required')
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

  const footer = (
    <>
      <span className="pk-dlg__hint">
        {targetRepoIds.length} repo{targetRepoIds.length === 1 ? '' : 's'} →{' '}
        {targetRepoIds.length} agent{targetRepoIds.length === 1 ? '' : 's'}
      </span>
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="secondary" disabled={busy || !canSubmit} onClick={() => submit(false)}>
        Save draft
      </Button>
      <Button
        variant="primary"
        icon={<Play size={13} />}
        disabled={busy || !canSubmit}
        onClick={() => submit(true)}
      >
        {busy ? 'Launching…' : 'Launch'}
      </Button>
    </>
  )

  return (
    <Dialog title="New ticket" onClose={onClose} width={580} footer={footer}>
      <div className="pk-form">
        <Input
          label="Title"
          placeholder="Add login page"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <Textarea
          label="Spec"
          rows={4}
          placeholder="Describe what every agent should build. The producer defines the contract; consumers read it."
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
        />

        <div className="pk-form__field">
          <span className="pk-form__label">Target repos</span>
          {workspace.repos.length === 0 ? (
            <span className="pk-form__hint">
              This workspace has no repos — add some from the sidebar first.
            </span>
          ) : (
            <div className="pk-repogrid">
              {workspace.repos.map((r) => {
                const on = targetRepoIds.includes(r.id)
                return (
                  <label key={r.id} className={`pk-repopick${on ? ' pk-repopick--on' : ''}`}>
                    <Checkbox checked={on} onChange={() => toggleRepo(r.id)} />
                    <GitBranch size={13} style={{ color: 'var(--text-muted)' }} />
                    <span className="pk-repopick__name">{r.name}</span>
                    {r.isContractProducer && <Badge variant="violet">producer</Badge>}
                    <span className="pk-repopick__host">{r.gitHost === 'github' ? 'GH' : 'GL'}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        <div className="pk-form__field">
          <span className="pk-form__label">Ordering</span>
          <Select
            value={orderingMode}
            onChange={(e) => setOrderingMode(e.target.value as OrderingMode)}
            options={[
              { value: 'producer_first', label: 'Producer first — contract, then consumers' },
              { value: 'concurrent', label: 'Concurrent — all at once' }
            ]}
          />
        </div>

        {orderingMode === 'producer_first' && !producerTargeted && (
          <div className="pk-warn">
            <TriangleAlert size={13} /> No contract producer in the selected repos — agents
            will run concurrently.
          </div>
        )}

        {error && <div className="pk-error">{error}</div>}
      </div>
    </Dialog>
  )
}
