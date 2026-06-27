interface DiffModalProps {
  title: string
  diff: string
  onClose: () => void
}

export function DiffModal({ title, diff, onClose }: DiffModalProps): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-[820px] flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
          <span className="text-sm font-semibold">Diff · {title}</span>
          <button
            className="text-neutral-500 hover:text-neutral-300"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <pre className="m-0 flex-1 overflow-auto bg-[#0a0a0a] p-3 text-[11px] leading-relaxed text-neutral-300">
          {diff}
        </pre>
      </div>
    </div>
  )
}
