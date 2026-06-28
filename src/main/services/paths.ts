import { dirname, join, sep } from 'node:path'
import type { Db } from './db'

/**
 * Longest common directory of a set of absolute paths. The orchestrator places
 * `.pluri/` here (the "workspace root"), so sibling repos share one folder for
 * memory, tickets, and contracts.
 */
export function commonAncestor(paths: string[]): string {
  if (paths.length === 0) throw new Error('no paths')
  if (paths.length === 1) return dirname(paths[0])
  const parts = paths.map((p) => p.split(sep))
  const first = parts[0]
  let i = 0
  for (; i < first.length; i++) {
    if (!parts.every((p) => p[i] === first[i])) break
  }
  return parts[0].slice(0, i).join(sep) || sep
}

/**
 * Workspace root = common ancestor of ALL the workspace's repo paths. Returns
 * null when there are no repos, or when the root coincides with a repo path
 * (nested repos — `.pluri/` would land inside a repo and get committed).
 */
export function workspaceRoot(db: Db, workspaceId: string): string | null {
  const repos = db.listRepos(workspaceId)
  if (repos.length === 0) return null
  const paths = repos.map((r) => r.path.replace(/[/\\]+$/, ''))
  const root = commonAncestor(paths)
  if (paths.includes(root)) return null
  return root
}

export function pluriDir(root: string): string {
  return join(root, '.pluri')
}

export function workspaceMemoryFile(root: string): string {
  return join(root, '.pluri', 'memory', 'workspace.md')
}

export function ticketDir(root: string, ticketId: string): string {
  return join(root, '.pluri', 'tickets', ticketId)
}
