// Pure, dependency-free helpers for consuming `claude --output-format stream-json`.
//
// stream-json is newline-delimited JSON: one JSON object per line. The catch is
// that a single `data` chunk from a child process can split a JSON object across
// chunk boundaries (and conversely pack several objects into one chunk). These
// helpers buffer correctly across chunks. Kept import-free (types are erased) so
// they run under `node --experimental-strip-types` for fast unit testing.

import type { ClaudeStreamEvent } from './types'

export interface LineBuffer {
  /** Feed a chunk; returns any complete lines (without trailing '\n'). */
  push(chunk: string): string[]
  /** Return whatever bytes remain unterminated (e.g. on stream close), or null. */
  flush(): string | null
}

/** Stateful newline splitter that survives chunk boundaries. */
export function createLineBuffer(): LineBuffer {
  let buf = ''
  return {
    push(chunk: string): string[] {
      buf += chunk
      const lines: string[] = []
      let idx: number
      // Split on '\n'; handle '\r\n' by trimming a trailing '\r'.
      while ((idx = buf.indexOf('\n')) >= 0) {
        let line = buf.slice(0, idx)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        lines.push(line)
        buf = buf.slice(idx + 1)
      }
      return lines
    },
    flush(): string | null {
      const remaining = buf
      buf = ''
      return remaining.length > 0 ? remaining : null
    }
  }
}

/** Parse one line as a stream-json event, or null if it is not valid JSON. */
export function parseEventLine(line: string): ClaudeStreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const obj = JSON.parse(trimmed)
    if (obj && typeof obj === 'object' && typeof obj.type === 'string') {
      return obj as ClaudeStreamEvent
    }
    return null
  } catch {
    return null
  }
}

/** True when an event marks the agent as finished. */
export function isTerminalEvent(ev: ClaudeStreamEvent): boolean {
  return ev.type === 'result'
}

/** Whether a terminal `result` event represents a failure. */
export function isErrorResult(ev: ClaudeStreamEvent): boolean {
  return ev.is_error === true || ev.subtype === 'error'
}
