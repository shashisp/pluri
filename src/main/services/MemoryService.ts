import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Db } from './db'
import type { MemoryScope } from '@shared/types'
import { workspaceMemoryFile, workspaceRoot } from './paths'

/**
 * Owns the layered context-memory files:
 *  - workspace memory  → <workspaceRoot>/.pluri/memory/workspace.md
 *  - repo memory / map → <repo>/CLAUDE.md  (Claude Code reads it natively)
 *
 * All writes are atomic (temp file + rename in the same dir) and main-process
 * only, so edits never race with agents reading the files or with each other.
 * Files are watched; changes emit `memory:update` to the renderer.
 */
export class MemoryService {
  private watchers = new Map<string, FSWatcher>()

  constructor(
    private db: Db,
    private emit: (channel: string, payload: unknown) => void
  ) {}

  private scopeKey(scope: MemoryScope): string {
    return `${scope.type}:${scope.id}`
  }

  /** Absolute path of a scope's memory file, or null if it can't be resolved. */
  filePath(scope: MemoryScope): string | null {
    if (scope.type === 'workspace') {
      const root = workspaceRoot(this.db, scope.id)
      return root ? workspaceMemoryFile(root) : null
    }
    const repo = this.db.getRepo(scope.id)
    if (!repo) return null
    return repo.claudeMdPath ?? join(repo.path, 'CLAUDE.md')
  }

  /** Current content of a scope's memory file (empty string if absent). */
  async read(scope: MemoryScope): Promise<string> {
    const p = this.filePath(scope)
    if (!p) return ''
    try {
      return await readFile(p, 'utf8')
    } catch {
      return ''
    }
  }

  /** Atomically write a scope's memory file (temp + rename). */
  async write(scope: MemoryScope, content: string): Promise<void> {
    const p = this.filePath(scope)
    if (!p) {
      throw new Error(
        scope.type === 'workspace'
          ? 'No workspace root (add repos under a shared parent first).'
          : 'Repo not found.'
      )
    }
    await this.atomicWrite(p, content)
    if (scope.type === 'workspace') this.db.setWorkspaceMemoryPath(scope.id, p)
    this.emit('memory:update', { scope, content })
  }

  private async atomicWrite(file: string, content: string): Promise<void> {
    const dir = dirname(file)
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, `.${randomUUID()}.tmp`)
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, file) // atomic on the same filesystem
  }

  /**
   * Watch a scope's memory file (idempotent per scope). The watch is on the
   * containing directory (non-recursive) but only reacts to the target file,
   * debounced against fs.watch's duplicate events.
   */
  ensureWatch(scope: MemoryScope): () => void {
    const key = this.scopeKey(scope)
    if (this.watchers.has(key)) return () => this.stop(key)
    const p = this.filePath(scope)
    if (!p) return () => {}

    const dir = dirname(p)
    const base = basename(p)
    let timer: NodeJS.Timeout | null = null
    const fire = (): void => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        void this.read(scope).then((content) =>
          this.emit('memory:update', { scope, content })
        )
      }, 150)
    }
    try {
      const w = watch(dir, (_event, filename) => {
        if (!filename || filename === base) fire()
      })
      this.watchers.set(key, w)
    } catch {
      /* dir may not exist yet; caller retries after first write */
    }
    return () => this.stop(key)
  }

  private stop(key: string): void {
    const w = this.watchers.get(key)
    if (w) {
      try {
        w.close()
      } catch {
        /* ignore */
      }
      this.watchers.delete(key)
    }
  }

  closeAll(): void {
    for (const key of [...this.watchers.keys()]) this.stop(key)
  }
}
