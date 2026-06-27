# Pluri — Multi-Repo Agent Orchestrator

A desktop app that orchestrates parallel headless **Claude Code** agents across
multiple *independent* git repositories grouped into **workspaces**, with work
organized by **ticket** (a ticket spans a chosen subset of a workspace's repos).
Isolation is by repo folder (`cwd`) — no git worktrees, no cross-repo merge logic.

> Status: **Phase 1** — single agent spawn & live stream. See [Build phases](#build-phases).

## Prerequisites

- **Node.js ≥ 22** (uses `node --experimental-strip-types` for the parser test).
- **Claude Code** on `PATH` — verify with `claude --version`. The app inherits
  Claude Code's existing auth (Pro/Max or API key). **Pluri never stores or
  transmits API keys.**
- For later phases (Git/MR): **`gh`** (GitHub) and/or **`glab`** (GitLab) on `PATH`.

## Run

```bash
npm install
npm run dev        # launches Electron with HMR
```

Other scripts:

```bash
npm run build        # build main + preload + renderer into out/
npm run typecheck    # tsc --noEmit for node + web targets
npm run test:parser  # unit-test the stream-json line buffer (no deps)
npm run test:e2e     # drive the real AgentManager against a live `claude`
                     # (spawn->stream->done, and spawn->kill->killed)
```

> `test:e2e` spawns real Claude Code processes, so it consumes a little usage
> and needs `claude` authenticated.

## How an agent is invoked

Each agent is a headless Claude Code process:

```
claude -p "<prompt>" \
  --append-system-prompt "<repo scope prompt>" \
  --allowedTools "Read[,Edit,Write,Bash]" \
  --output-format stream-json \
  --verbose
```

- `cwd` is set to the repo folder — this is how agents are isolated.
- stdout is **newline-delimited JSON**; lines may split across chunks, so
  `src/shared/streamParser.ts` buffers across boundaries.
- Observed event types: `system` (`init`, `hook_started`, `hook_response`,
  `thinking_tokens`), `assistant`, `user`, `rate_limit_event`, and a terminal
  `result`. `tool_use` / `tool_result` arrive as *content blocks* inside
  `assistant` / `user` messages, not as top-level events. The parser tolerates
  unknown types.
- The `result` event (`{type:"result", subtype, is_error, result}`) means the
  agent finished.

## Architecture

```
src/
  shared/            types + pure stream-json helpers (no runtime deps)
    types.ts
    streamParser.ts  createLineBuffer / parseEventLine / terminal detection
  main/              Electron main process (all privileged work)
    index.ts         window + lifecycle + kill-all-on-quit
    ipc.ts           ipcMain handlers, forwards manager events to renderer
    services/
      AgentManager.ts  spawn / parse / state / kill  (Electron-free, testable)
  preload/
    index.ts         typed contextBridge -> window.api
    index.d.ts       window.api typings for the renderer
  renderer/          Vite + React + Tailwind UI
    src/
      App.tsx
      components/TerminalPane.tsx   one live xterm.js pane
      lib/format.ts                 stream-json event -> colored terminal text
scripts/
  test-parser.ts     line-buffer unit test
```

Security guardrails: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, a CSP meta tag, and `setWindowOpenHandler` routing external
links to the OS browser. All process/git/file work lives in main behind IPC.

## Build phases

| Phase | Scope | Status |
|------|-------|--------|
| **1** | Electron+Vite+React skeleton; spawn one headless agent in a repo, parse stream-json, render live xterm output, Kill button. | ✅ this build |
| 2 | SQLite data model; add workspaces/repos; persistence across restarts. | ⬜ |
| 3 | Tickets + multi-repo fan-out; N panes; status dots. | ⬜ |
| 4 | Auto-branch on spawn; push + open MR/PR via `gh`/`glab`; ticket roll-up. | ⬜ |
| 5 | Shared `.orchestrator/tickets/<id>/` contract folder; `producer_first` ordering; live Contract tab. | ⬜ |
| 6 | View Diff, board grouping, restart restore, multi-ticket parallelism, settings. | ⬜ |

## Verifying Phase 1

1. `npm run dev`.
2. The repo path is pre-filled with this project; the prompt is read-only
   (`allowedTools = Read`).
3. Click **Spawn agent** → the status dot goes 🟡 *working*; the xterm pane shows
   the session start, the agent's thinking/tool calls, and a final ✔ summary
   (dot turns 🟢 *done*).
4. Click **Kill** mid-run → the process dies and the dot turns 🔴 *killed*.
