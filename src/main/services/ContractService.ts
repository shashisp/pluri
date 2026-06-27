import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import type { Db } from './db'
import type { Ticket } from '@shared/types'

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Longest common directory of a set of absolute paths. The orchestrator places
 * `.orchestrator/` here (the "workspace root" the spec refers to), so agents in
 * sibling repos share one contract folder.
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

export interface ContractInitResult {
  contractPath: string | null
  warnings: string[]
}

/**
 * Owns the per-ticket shared folder:
 *   <workspaceRoot>/.orchestrator/tickets/<ticketId>/
 *     ticket.md     (spec, written at launch)
 *     contract.md   (producer writes, consumers read)
 *     status/       (optional per-agent status)
 *
 * Agents reference contract.md by ABSOLUTE path (robust regardless of repo
 * nesting). The Contract tab reads + live-watches contract.md.
 */
export class ContractService {
  private watchers = new Map<string, FSWatcher>()

  constructor(private db: Db) {}

  /** Workspace root for a ticket = common ancestor of its target repos. */
  private rootFor(ticketId: string): string | null {
    const ticket = this.db.getTicket(ticketId)
    if (!ticket) return null
    const repos = this.db
      .listRepos(ticket.workspaceId)
      .filter((r) => ticket.targetRepoIds.includes(r.id))
    if (repos.length === 0) return null
    const paths = repos.map((r) => r.path.replace(/[/\\]+$/, ''))
    const root = commonAncestor(paths)
    // If the root coincides with one of the repos (nested repos), `.orchestrator`
    // would land INSIDE a repo where an agent could commit it — disable instead.
    if (paths.includes(root)) return null
    return root
  }

  dir(ticketId: string): string | null {
    const root = this.rootFor(ticketId)
    return root ? join(root, '.orchestrator', 'tickets', ticketId) : null
  }

  contractPath(ticketId: string): string | null {
    const d = this.dir(ticketId)
    return d ? join(d, 'contract.md') : null
  }

  /** Create the folder structure and write ticket.md. Returns contract path. */
  async init(ticketId: string, ticket: Ticket): Promise<ContractInitResult> {
    const d = this.dir(ticketId)
    if (!d) {
      return {
        contractPath: null,
        warnings: [
          'No safe shared directory for the target repos (none, or repos are nested); contract sharing disabled.'
        ]
      }
    }
    try {
      await mkdir(join(d, 'status'), { recursive: true })
      await writeFile(
        join(d, 'ticket.md'),
        `# ${ticket.title}\n\n${ticket.spec || '(no spec)'}\n`,
        'utf8'
      )
      // Reset the contract so a relaunch's producer_first gate doesn't trip on a
      // stale contract.md from a previous run.
      await writeFile(join(d, 'contract.md'), '', 'utf8')
      return { contractPath: join(d, 'contract.md'), warnings: [] }
    } catch (e) {
      return {
        contractPath: null,
        warnings: [`Could not create contract folder: ${msg(e)}`]
      }
    }
  }

  /** Current contract.md content (empty string if absent). */
  async read(ticketId: string): Promise<string> {
    const p = this.contractPath(ticketId)
    if (!p) return ''
    try {
      return await readFile(p, 'utf8')
    } catch {
      return ''
    }
  }

  /** True once contract.md has non-whitespace content (producer_first gate). */
  async hasContract(ticketId: string): Promise<boolean> {
    return (await this.read(ticketId)).trim().length > 0
  }

  /**
   * Watch ONLY this ticket's contract folder (stopping any other watcher first —
   * the UI views one ticket at a time). Calls onChange with contract.md content,
   * filtered to that file and debounced against fs.watch's duplicate events.
   */
  watchOnly(ticketId: string, onChange: (content: string) => void): () => void {
    for (const id of [...this.watchers.keys()]) {
      if (id !== ticketId) this.stopWatch(id)
    }
    if (this.watchers.has(ticketId)) return () => this.stopWatch(ticketId)

    const d = this.dir(ticketId)
    if (!d) return () => {}

    let timer: NodeJS.Timeout | null = null
    const fire = (): void => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        void this.read(ticketId).then(onChange)
      }, 150)
    }
    try {
      const w = watch(d, (_event, filename) => {
        // Only react to contract.md (ignore ticket.md / status/ churn).
        if (!filename || filename === 'contract.md') fire()
      })
      this.watchers.set(ticketId, w)
    } catch {
      /* dir may not exist yet; caller can retry after launch */
    }
    return () => this.stopWatch(ticketId)
  }

  private stopWatch(ticketId: string): void {
    const w = this.watchers.get(ticketId)
    if (w) {
      try {
        w.close()
      } catch {
        /* ignore */
      }
      this.watchers.delete(ticketId)
    }
  }

  closeAll(): void {
    for (const id of [...this.watchers.keys()]) this.stopWatch(id)
  }
}
