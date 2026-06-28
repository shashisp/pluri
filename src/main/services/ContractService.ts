import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Db } from './db'
import type { Ticket } from '@shared/types'
import { commonAncestor, ticketDir, workspaceRoot } from './paths'

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export { commonAncestor }

export interface ContractInitResult {
  contractPath: string | null
  warnings: string[]
}

/**
 * Owns the per-ticket shared folder:
 *   <workspaceRoot>/.pluri/tickets/<ticketId>/
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

  dir(ticketId: string): string | null {
    const ticket = this.db.getTicket(ticketId)
    if (!ticket) return null
    // Use the workspace-wide root so memory, tickets, and contracts share one
    // `.pluri/` folder (and it never lands inside a nested repo).
    const root = workspaceRoot(this.db, ticket.workspaceId)
    return root ? ticketDir(root, ticketId) : null
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
