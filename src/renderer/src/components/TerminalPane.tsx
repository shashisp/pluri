import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { AgentEventMsg } from '@shared/types'
import { formatEvent } from '../lib/format'

interface TerminalPaneProps {
  /** Only events for this agent are written to the pane. */
  agentId: string | null
}

/**
 * A live xterm.js terminal for one agent. On (re)mount or agent switch it
 * backfills from the agent's retained log, then streams live events — using the
 * per-event `seq` to dedup the overlap between backfill and live, and queuing
 * live events until backfill completes so ordering is preserved.
 */
export function TerminalPane({ agentId }: TerminalPaneProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)

  // Create the terminal once.
  useEffect(() => {
    if (!containerRef.current) return
    const term = new Terminal({
      convertEol: false,
      cursorBlink: false,
      disableStdin: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      scrollback: 8000,
      theme: { background: '#0a0a0a', foreground: '#e5e5e5', cursor: '#0a0a0a' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()
    termRef.current = term

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* ignore fit errors during teardown */
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      term.dispose()
      termRef.current = null
    }
  }, [])

  // Backfill + live stream for the current agent.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.clear()
    term.reset()
    if (!agentId) return

    let cancelled = false
    let ready = false
    let lastSeq = -1
    const pending: AgentEventMsg[] = []

    const writeMsg = (m: AgentEventMsg): void => {
      if (m.seq <= lastSeq) return // already shown via backfill
      const text = formatEvent(m)
      if (text) term.write(text)
      lastSeq = m.seq
    }

    const unsubscribe = window.api.onAgentEvent((m: AgentEventMsg) => {
      if (cancelled || m.agentId !== agentId) return
      if (ready) writeMsg(m)
      else pending.push(m)
    })

    void window.api.getAgentLog(agentId).then((log) => {
      if (cancelled) return
      for (const m of log) writeMsg(m)
      ready = true
      for (const m of pending) writeMsg(m)
      pending.length = 0
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [agentId])

  return (
    <div className="h-full w-full overflow-hidden bg-[#0a0a0a] p-2">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}
