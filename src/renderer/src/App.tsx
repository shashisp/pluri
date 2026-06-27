import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WorkspaceWithRepos } from '@shared/types'
import { Sidebar } from './components/Sidebar'
import { AgentSandbox } from './components/AgentSandbox'

type View = 'board' | 'sandbox'

export default function App(): JSX.Element {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRepos[]>([])
  const [selectedWsId, setSelectedWsId] = useState<string | null>(null)
  const [view, setView] = useState<View>('board')

  const refresh = useCallback(async (): Promise<void> => {
    setWorkspaces(await window.api.listWorkspaces())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selectedWs = useMemo(
    () => workspaces.find((w) => w.id === selectedWsId) ?? null,
    [workspaces, selectedWsId]
  )

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] text-neutral-200">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tracking-tight">Pluri</span>
          <span className="text-xs text-neutral-500">
            Phase 2 — workspaces &amp; repos
          </span>
        </div>
        <div className="flex gap-1 text-xs">
          {(['board', 'sandbox'] as View[]).map((v) => (
            <button
              key={v}
              className={`rounded px-2 py-1 ${
                view === v
                  ? 'bg-neutral-800 text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
              onClick={() => setView(v)}
            >
              {v === 'board' ? 'Board' : 'Agent sandbox'}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr]">
        <Sidebar
          workspaces={workspaces}
          selectedWsId={selectedWsId}
          onSelect={setSelectedWsId}
          onChanged={refresh}
        />

        <div className="min-w-0 overflow-hidden">
          {view === 'sandbox' ? (
            <AgentSandbox />
          ) : (
            <BoardPlaceholder workspace={selectedWs} />
          )}
        </div>
      </div>
    </div>
  )
}

function BoardPlaceholder({
  workspace
}: {
  workspace: WorkspaceWithRepos | null
}): JSX.Element {
  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-600">
        Select or create a workspace to begin.
      </div>
    )
  }
  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-lg font-semibold">{workspace.name}</h1>
      <p className="mt-1 text-xs text-neutral-500">
        {workspace.repos.length} repo{workspace.repos.length === 1 ? '' : 's'}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {workspace.repos.map((repo) => (
          <div
            key={repo.id}
            className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{repo.name}</span>
              {repo.isContractProducer && (
                <span className="rounded bg-amber-900/50 px-1 text-[9px] text-amber-300">
                  producer
                </span>
              )}
            </div>
            <div className="mt-1 truncate text-xs text-neutral-500" title={repo.path}>
              {repo.path}
            </div>
            <div className="mt-2 flex gap-2 text-[10px] text-neutral-600">
              <span>{repo.gitHost}</span>
              <span>·</span>
              <span>{repo.defaultBranch}</span>
            </div>
          </div>
        ))}
        {workspace.repos.length === 0 && (
          <div className="text-sm text-neutral-600">
            No repos yet — add one from the sidebar.
          </div>
        )}
      </div>

      <div className="mt-8 rounded-lg border border-dashed border-neutral-800 p-6 text-center text-sm text-neutral-600">
        Ticket board arrives in Phase 3.
      </div>
    </div>
  )
}
