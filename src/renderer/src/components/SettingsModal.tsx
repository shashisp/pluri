import { useState } from 'react'
import type { AppSettings, OrderingMode } from '@shared/types'

interface SettingsModalProps {
  settings: AppSettings
  onClose: () => void
  onSave: (patch: Partial<AppSettings>) => void | Promise<void>
}

export function SettingsModal({
  settings,
  onClose,
  onSave
}: SettingsModalProps): JSX.Element {
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

  const inputCls =
    'w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-neutral-500'

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-6">
      <div className="flex w-[460px] flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Settings</h2>
          <button className="text-neutral-500 hover:text-neutral-300" onClick={onClose}>
            ✕
          </button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-400">
            Max concurrent agents
          </span>
          <input
            type="number"
            min={1}
            max={64}
            className={inputCls}
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(e.target.value)}
          />
          <span className="text-[11px] text-neutral-600">
            Agents beyond this run queued; raise/lower for your machine &amp; rate limits.
          </span>
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-400">
            Default ordering for new tickets
          </span>
          <div className="flex gap-4 text-sm">
            {(['concurrent', 'producer_first'] as OrderingMode[]).map((m) => (
              <label key={m} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="defaultOrdering"
                  checked={ordering === m}
                  onChange={() => setOrdering(m)}
                />
                {m === 'concurrent' ? 'Concurrent' : 'Producer first'}
              </label>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-400">Agent tools</span>
          <input
            className={inputCls}
            value={tools}
            onChange={(e) => setTools(e.target.value)}
            spellCheck={false}
          />
          <span className="text-[11px] text-neutral-600">
            Comma-separated Claude Code tools agents may use to implement a ticket.
          </span>
        </label>

        <div className="mt-1 flex justify-end gap-2">
          <button
            className="rounded bg-neutral-800 px-3 py-1.5 text-xs hover:bg-neutral-700"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            onClick={save}
            disabled={busy}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
