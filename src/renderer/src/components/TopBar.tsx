import {
  BookText,
  Boxes,
  ChevronRight,
  ChevronsUpDown,
  LayoutGrid,
  Plus,
  Settings,
  SquareTerminal
} from 'lucide-react'
import { Button, IconButton } from './ui'
import markUrl from '../assets/mark.svg'

type View = 'board' | 'sandbox' | 'memory'

interface TopBarProps {
  workspaceName: string | null
  /** Crumb shown when a ticket is open; clicking goes back to the board. */
  ticketTitle: string | null
  onBack: () => void
  view: View
  onSetView: (v: View) => void
  canNewTicket: boolean
  onNewTicket: () => void
  onOpenSettings: () => void
}

export function TopBar({
  workspaceName,
  ticketTitle,
  onBack,
  view,
  onSetView,
  canNewTicket,
  onNewTicket,
  onOpenSettings
}: TopBarProps): JSX.Element {
  return (
    <header className="pk-top">
      <div className="pk-top__brand">
        <img src={markUrl} width={22} height={22} alt="" />
        <span className="pk-wordmark">
          pluri<span className="pk-wordmark__sh">.sh</span>
        </span>
      </div>

      <div className="pk-divider-v" />

      <button className="pk-ws" type="button">
        <Boxes size={15} />
        <span>{workspaceName ?? 'No workspace'}</span>
        <ChevronsUpDown size={13} style={{ color: 'var(--text-muted)' }} />
      </button>

      {ticketTitle && view === 'board' && (
        <div className="pk-crumb">
          <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
          <button className="pk-crumb__link" onClick={onBack}>
            Board
          </button>
          <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="pk-crumb__cur">{ticketTitle}</span>
        </div>
      )}

      <div className="pk-top__spacer" />

      <div className="pluri-tabs" style={{ border: 'none' }}>
        <button
          className={`pluri-tab${view === 'board' ? ' pluri-tab--active' : ''}`}
          onClick={() => onSetView('board')}
        >
          <LayoutGrid size={14} /> Board
        </button>
        <button
          className={`pluri-tab${view === 'memory' ? ' pluri-tab--active' : ''}`}
          onClick={() => onSetView('memory')}
        >
          <BookText size={14} /> Memory
        </button>
        <button
          className={`pluri-tab${view === 'sandbox' ? ' pluri-tab--active' : ''}`}
          onClick={() => onSetView('sandbox')}
        >
          <SquareTerminal size={14} /> Sandbox
        </button>
      </div>

      <Button
        variant="primary"
        icon={<Plus size={14} />}
        disabled={!canNewTicket}
        onClick={onNewTicket}
      >
        New ticket
      </Button>
      <IconButton label="Settings" onClick={onOpenSettings}>
        <Settings size={16} />
      </IconButton>
    </header>
  )
}
