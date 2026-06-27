import { useState } from 'react'
import type { AppSettings, OrderingMode } from '@shared/types'
import { Button, Dialog, Input, Select } from './ui'

interface SettingsModalProps {
  settings: AppSettings
  onClose: () => void
  onSave: (patch: Partial<AppSettings>) => void | Promise<void>
}

export function SettingsModal({ settings, onClose, onSave }: SettingsModalProps): JSX.Element {
  const [maxConcurrent, setMaxConcurrent] = useState(String(settings.maxConcurrentAgents))
  const [ordering, setOrdering] = useState<OrderingMode>(settings.defaultOrderingMode)
  const [tools, setTools] = useState(settings.agentTools)
  const [busy, setBusy] = useState(false)

  async function save(): Promise<void> {
    setBusy(true)
    const n = Math.max(1, Math.min(64, Number.parseInt(maxConcurrent, 10) || 1))
    await onSave({
      maxConcurrentAgents: n,
      defaultOrderingMode: ordering,
      agentTools: tools.trim() || 'Bash,Edit,Read,Write'
    })
    onClose()
  }

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" onClick={save} disabled={busy}>
        Save
      </Button>
    </>
  )

  return (
    <Dialog title="Settings" onClose={onClose} width={460} footer={footer}>
      <div className="pk-form">
        <div className="pk-form__field">
          <Input
            label="Max concurrent agents"
            type="number"
            min={1}
            max={64}
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(e.target.value)}
          />
          <span className="pk-form__hint">
            Agents beyond this run queued; tune for your machine &amp; rate limits.
          </span>
        </div>

        <div className="pk-form__field">
          <span className="pk-form__label">Default ordering for new tickets</span>
          <Select
            value={ordering}
            onChange={(e) => setOrdering(e.target.value as OrderingMode)}
            options={[
              { value: 'concurrent', label: 'Concurrent' },
              { value: 'producer_first', label: 'Producer first' }
            ]}
          />
        </div>

        <div className="pk-form__field">
          <Input
            label="Agent tools"
            value={tools}
            onChange={(e) => setTools(e.target.value)}
            mono
          />
          <span className="pk-form__hint">
            Comma-separated Claude Code tools agents may use to implement a ticket.
          </span>
        </div>
      </div>
    </Dialog>
  )
}
