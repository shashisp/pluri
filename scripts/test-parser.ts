// Unit test for the stream-json line buffer — the single riskiest piece of
// Phase 1. Run with:  node --experimental-strip-types scripts/test-parser.ts
//
// No test framework; just assertions so it runs with zero dependencies.
import {
  createLineBuffer,
  parseEventLine,
  isErrorResult,
  isTerminalEvent
} from '../src/shared/streamParser.ts'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ok   ${msg}`)
  } else {
    failures++
    console.error(`  FAIL ${msg}`)
  }
}

// 1. Two whole lines in one chunk.
{
  const lb = createLineBuffer()
  const lines = lb.push('{"a":1}\n{"b":2}\n')
  assert(lines.length === 2, 'two complete lines split from one chunk')
  assert(lines[0] === '{"a":1}' && lines[1] === '{"b":2}', 'line contents preserved')
  assert(lb.flush() === null, 'no remainder after complete lines')
}

// 2. A JSON object split across chunk boundaries (the core hazard).
{
  const lb = createLineBuffer()
  const a = lb.push('{"type":"assist')
  assert(a.length === 0, 'partial line yields no output yet')
  const b = lb.push('ant","x":1}\n')
  assert(b.length === 1, 'completing the line yields exactly one line')
  const parsed = parseEventLine(b[0])
  assert(parsed?.type === 'assistant', 'reassembled JSON parses correctly')
}

// 3. Multiple objects + a trailing partial in a single chunk.
{
  const lb = createLineBuffer()
  const lines = lb.push('{"n":1}\n{"n":2}\n{"n":3')
  assert(lines.length === 2, 'two full lines, partial third buffered')
  const tail = lb.flush()
  assert(tail === '{"n":3', 'flush returns the trailing partial')
}

// 4. CRLF line endings are normalized.
{
  const lb = createLineBuffer()
  const lines = lb.push('{"a":1}\r\n')
  assert(lines[0] === '{"a":1}', 'trailing \\r stripped from CRLF lines')
}

// 5. Empty lines and non-JSON garbage are handled gracefully.
{
  assert(parseEventLine('') === null, 'empty line -> null')
  assert(parseEventLine('   ') === null, 'whitespace line -> null')
  assert(parseEventLine('not json') === null, 'garbage line -> null')
  assert(parseEventLine('{"no":"type"}') === null, 'object without type -> null')
}

// 6. Terminal/result detection using the real result shape from the probe.
{
  const ok = parseEventLine('{"type":"result","subtype":"success","is_error":false,"result":"done"}')!
  assert(isTerminalEvent(ok), 'result event is terminal')
  assert(!isErrorResult(ok), 'successful result is not an error')

  const bad = parseEventLine('{"type":"result","subtype":"error","is_error":true}')!
  assert(isErrorResult(bad), 'is_error result flagged as error')

  const mid = parseEventLine('{"type":"assistant"}')!
  assert(!isTerminalEvent(mid), 'assistant event is not terminal')
}

// 7. Byte-by-byte feed of a realistic event still reassembles.
{
  const lb = createLineBuffer()
  const full = '{"type":"system","subtype":"init","model":"opus"}\n'
  let out: string[] = []
  for (const ch of full) out = out.concat(lb.push(ch))
  assert(out.length === 1, 'char-by-char feed produces one line')
  assert(parseEventLine(out[0])?.subtype === 'init', 'char-by-char line parses')
}

console.log('')
if (failures === 0) {
  console.log('All parser tests passed ✔')
} else {
  console.error(`${failures} test(s) failed ✖`)
  process.exit(1)
}
