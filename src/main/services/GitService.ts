import { simpleGit, type SimpleGit } from 'simple-git'

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export interface PrepareResult {
  warnings: string[]
}

/**
 * Git operations for the orchestrator (simple-git). Pure Node — no Electron, no
 * native modules — so it can be tested headlessly against real repos.
 */
export class GitService {
  private git(repoPath: string): SimpleGit {
    return simpleGit(repoPath)
  }

  /**
   * Put the repo on a FRESH feature branch before an agent runs: (re)create
   * `branch` at the default branch's tip (`checkout -B`), so a relaunch starts
   * clean rather than stacking on a prior run's commits. Dirty trees and a
   * missing default branch are warned about, not blocked.
   */
  async prepareBranch(
    repoPath: string,
    defaultBranch: string,
    branch: string
  ): Promise<PrepareResult> {
    const git = this.git(repoPath)
    const warnings: string[] = []

    const status = await git.status()
    if (!status.isClean()) {
      warnings.push(
        `Working tree not clean (${status.files.length} changed file(s)); branching from current state.`
      )
    }

    const local = await git.branchLocal()
    const baseExists = local.all.includes(defaultBranch)
    if (!baseExists) {
      warnings.push(
        `Default branch "${defaultBranch}" not found locally; branching off current HEAD (${local.current || 'detached'}).`
      )
    }
    if (local.all.includes(branch)) {
      warnings.push(
        `Branch "${branch}" already existed; resetting it to ${baseExists ? defaultBranch : 'current HEAD'} for a fresh run.`
      )
    }

    // `checkout -B` creates or resets `branch` to the base and checks it out.
    const base = baseExists ? defaultBranch : 'HEAD'
    await git.checkout(['-B', branch, base])

    return { warnings }
  }

  /**
   * Number of commits `branch` is ahead of `defaultBranch`. Throws if either ref
   * cannot be resolved — callers must NOT treat that as "0 commits" (which would
   * silently discard the agent's work).
   */
  async commitsAhead(
    repoPath: string,
    defaultBranch: string,
    branch: string
  ): Promise<number> {
    const git = this.git(repoPath)
    // Verify both refs resolve; rev-parse throws with a clear message otherwise.
    await git.raw(['rev-parse', '--verify', '--quiet', `${defaultBranch}^{commit}`])
    await git.raw(['rev-parse', '--verify', '--quiet', `${branch}^{commit}`])
    const out = await git.raw(['rev-list', '--count', `${defaultBranch}..${branch}`])
    return Number.parseInt(out.trim(), 10) || 0
  }

  /** Whether the repo has an `origin` remote to push to. */
  async hasOrigin(repoPath: string): Promise<boolean> {
    try {
      const remotes = await this.git(repoPath).getRemotes()
      return remotes.some((r) => r.name === 'origin')
    } catch {
      return false
    }
  }

  /** Push `branch` to origin, setting upstream. Throws on failure. */
  async push(repoPath: string, branch: string): Promise<void> {
    await this.git(repoPath).push(['-u', 'origin', branch])
  }

  /** Unified diff of `branch` since it diverged from `defaultBranch` (size-capped). */
  async diff(
    repoPath: string,
    defaultBranch: string,
    branch: string
  ): Promise<string> {
    const MAX = 400_000 // ~400KB is plenty for review; avoids giant payloads/render hangs
    try {
      const out = await this.git(repoPath).diff([`${defaultBranch}...${branch}`])
      if (!out) return '(no differences)'
      if (out.length > MAX) {
        return `${out.slice(0, MAX)}\n\n… diff truncated (${out.length - MAX} more characters).`
      }
      return out
    } catch (e) {
      return `Could not compute diff: ${msg(e)}`
    }
  }
}
