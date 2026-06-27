# Pluri — Multi-Repo Agent Orchestrator

A desktop app that orchestrates parallel headless **Claude Code** agents across
multiple *independent* git repositories grouped into **workspaces**, with work
organized by **ticket** (a ticket spans a chosen subset of a workspace's repos).
Isolation is by repo folder (`cwd`) — no git worktrees, no cross-repo merge logic.

> Status: **Phase 3** — tickets + multi-repo fan-out (one agent per targeted
> repo, N live panes, status dots). See [Build phases](#build-phases).

## Prerequisites

- **Node.js ≥ 22** (uses `node --experimental-strip-types` for the parser test).
- **Claude Code** on `PATH` — verify with `claude --version`. The app inherits
  Claude Code's existing auth (Pro/Max or API key). **Pluri never stores or
  transmits API keys.**
- For later phases (Git/MR): **`gh`** (GitHub) and/or **`glab`** (GitLab) on `PATH`.

> **Native module note:** `better-sqlite3` is compiled against Electron's ABI.
> `npm install` runs `electron-rebuild` automatically (postinstall); if you ever
> see a `NODE_MODULE_VERSION` error, run `npm run rebuild`.

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
npm run test:db      # SQLite persistence + ticket/agent CRUD (under Electron ABI)
npm run test:fanout  # real fan-out: launch a ticket across 2 temp repos,
                     # 2 agents spawn, both finish, ticket rolls up
npm run rebuild      # rebuild better-sqlite3 for Electron (if ABI mismatch)
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
    index.ts         window + lifecycle + CSP + DB init + kill-all-on-quit
    ipc.ts           ipcMain handlers (agents + workspaces/repos + dialog)
    services/
      AgentManager.ts  spawn / parse / state / kill + log ring  (Electron-free)
      db.ts            SQLite persistence (Electron-free, path injected)
      TicketLauncher.ts fan-out: agent per repo, persist, roll ticket up
      prompts.ts        slug / branch name / per-repo scope prompt
  preload/
    index.ts         typed contextBridge -> window.api
    index.d.ts       window.api typings for the renderer
  renderer/          Vite + React + Tailwind UI
    src/
      App.tsx                       shell + board/detail/sandbox + live overlays
      components/
        Sidebar.tsx                 workspaces/repos tree + add forms
        TicketBoard.tsx             columns by state + cards + status dots
        NewTicketForm.tsx           title/spec/repo checkboxes/ordering
        TicketDetail.tsx            N-pane grid for a ticket's agents
        AgentPane.tsx               one agent: terminal + footer (branch/state/kill)
        AgentSandbox.tsx            Phase 1 single-agent harness (dev view)
        TerminalPane.tsx            live xterm.js pane w/ backfill + seq-dedup
        StatusDot.tsx               agent state indicator
      lib/format.ts                 stream-json event -> colored terminal text
scripts/
  test-parser.ts     line-buffer unit test
  test-db.ts         SQLite + ticket/agent CRUD test (Electron ABI)
  test-fanout.ts     real multi-repo fan-out e2e
  e2e-agent.ts       real AgentManager vs live claude
```

Security guardrails: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, a CSP meta tag, and `setWindowOpenHandler` routing external
links to the OS browser. All process/git/file work lives in main behind IPC.

## Build phases

| Phase | Scope | Status |
|------|-------|--------|
| **1** | Electron+Vite+React skeleton; spawn one headless agent in a repo, parse stream-json, render live xterm output, Kill button. | ✅ |
| **2** | SQLite data model; add workspaces/repos; persistence across restarts. | ✅ |
| **3** | Tickets + multi-repo fan-out; N panes; status dots. | ✅ this build |
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
