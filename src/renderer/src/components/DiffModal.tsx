import { Button, Dialog } from './ui'

interface DiffModalProps {
  title: string
  diff: string
  onClose: () => void
}

export function DiffModal({ title, diff, onClose }: DiffModalProps): JSX.Element {
  return (
    <Dialog
      title={`Diff · ${title}`}
      onClose={onClose}
      width={820}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="pk-diff">
        <pre className="pk-diff__pre">{diff}</pre>
      </div>
    </Dialog>
  )
}
