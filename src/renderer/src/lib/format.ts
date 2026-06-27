import type { AgentEventMsg, ClaudeContentBlock, ClaudeStreamEvent } from '@shared/types'

// Minimal ANSI helpers for the xterm pane.
const ESC = '\x1b['
const c = {
  reset: `${ESC}0m`,
  dim: `${ESC}2m`,
  bold: `${ESC}1m`,
  gray: `${ESC}90m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`
}

/** xterm needs CRLF line endings. */
function nl(s: string): string {
  return s.replace(/\r?\n/g, '\r\n') + '\r\n'
}

function truncate(s: string, max = 160): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

function summarizeInput(input: unknown): string {
  if (input == null) return ''
  try {
    return truncate(typeof input === 'string' ? input : JSON.stringify(input))
  } catch {
    return ''
  }
}

function formatBlock(block: ClaudeContentBlock): string | null {
  switch (block.type) {
    case 'text':
      return block.text ? `${c.white}${block.text}${c.reset}` : null
    case 'thinking':
      return block.thinking
        ? `${c.gray}${c.dim}💭 ${truncate(block.thinking, 400)}${c.reset}`
        : null
    case 'tool_use':
      return `${c.cyan}🔧 ${block.name ?? 'tool'}${c.reset}${c.dim}(${summarizeInput(block.input)})${c.reset}`
    case 'tool_result': {
      const color = block.is_error ? c.red : c.green
      const label = block.is_error ? 'error' : 'ok'
      return `${color}  ↳ ${label}${c.reset}`
    }
    default:
      return null
  }
}

/**
 * Convert a streamed agent message into human-readable, colored terminal text.
 * Returns '' when the event carries nothing worth showing.
 */
export function formatEvent(msg: AgentEventMsg): string {
  // stderr or unparseable stdout: show raw (stderr in red).
  if (!msg.parsed) {
    if (!msg.raw.trim()) return ''
    const color = msg.stream === 'stderr' ? c.red : c.gray
    return nl(`${color}${msg.raw.replace(/\r?\n$/, '')}${c.reset}`)
  }

  const ev: ClaudeStreamEvent = msg.parsed

  switch (ev.type) {
    case 'system':
      if (ev.subtype === 'init') {
        return nl(
          `${c.magenta}● session started${c.reset}${c.dim}  model=${ev.model ?? '?'}  cwd=${ev.cwd ?? '?'}${c.reset}`
        )
      }
      // hook_*, thinking_tokens, etc. — keep the pane quiet.
      return ''

    case 'assistant':
    case 'user': {
      const blocks = ev.message?.content ?? []
      const out = blocks
        .map(formatBlock)
        .filter((s): s is string => Boolean(s))
        .map(nl)
        .join('')
      return out
    }

    case 'result': {
      const failed = ev.is_error || ev.subtype === 'error'
      const head = failed
        ? `${c.red}${c.bold}✖ agent finished with an error${c.reset}`
        : `${c.green}${c.bold}✔ agent finished${c.reset}`
      const cost =
        typeof ev.total_cost_usd === 'number'
          ? `${c.dim}  $${ev.total_cost_usd.toFixed(4)}  ${ev.num_turns ?? '?'} turns${c.reset}`
          : ''
      const body = ev.result ? nl(`${c.white}${ev.result}${c.reset}`) : ''
      return nl('') + body + nl(`${head}${cost}`)
    }

    case 'rate_limit_event':
      return nl(`${c.yellow}⏳ rate limit event${c.reset}`)

    default:
      return ''
  }
}
