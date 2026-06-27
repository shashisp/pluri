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
 * A single live xterm.js terminal that renders one agent's Claude Code output.
 * Subscribes to `agent:event` for the matching agentId and writes formatted,
 * colored text. Auto-fits on container resize.
 */
export function TerminalPane({ agentId }: TerminalPaneProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  // Keep the active agentId in a ref so the IPC handler (registered once) reads
  // the latest value without re-subscribing on every change.
  const agentIdRef = useRef<string | null>(agentId)
  agentIdRef.current = agentId

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
      scrollback: 5000,
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#0a0a0a'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

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
      fitRef.current = null
    }
  }, [])

  // Subscribe to agent events once; filter by the current agentId.
  useEffect(() => {
    const unsubscribe = window.api.onAgentEvent((msg: AgentEventMsg) => {
      if (msg.agentId !== agentIdRef.current) return
      const text = formatEvent(msg)
      if (text) termRef.current?.write(text)
    })
    return unsubscribe
  }, [])

  // Clear the pane when switching to a different (or no) agent.
  useEffect(() => {
    termRef.current?.clear()
    termRef.current?.reset()
  }, [agentId])

  return (
    <div className="h-full w-full overflow-hidden bg-[#0a0a0a] p-2">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}
