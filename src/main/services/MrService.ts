import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitHost } from '@shared/types'

const execFileAsync = promisify(execFile)

export interface OpenMrOptions {
  repoPath: string
  gitHost: GitHost
  branch: string
  defaultBranch: string
  title: string
  body: string
}

/** Extract the first http(s) URL from CLI output (the created PR/MR link). */
export function extractUrl(output: string): string {
  const match = output.match(/https?:\/\/\S+/)
  if (!match) throw new Error('Could not parse MR/PR URL from CLI output')
  return match[0]
}

/**
 * Opens a merge/pull request by shelling out to the host CLI:
 *   GitHub -> `gh pr create`
 *   GitLab -> `glab mr create`
 * The branch must already be pushed. Returns the PR/MR URL.
 */
export class MrService {
  async openMr(opts: OpenMrOptions): Promise<string> {
    const { repoPath, gitHost, branch, defaultBranch, title, body } = opts
    const cli = gitHost === 'github' ? 'gh' : 'glab'

    const args =
      gitHost === 'github'
        ? ['pr', 'create', '--base', defaultBranch, '--head', branch, '--title', title, '--body', body]
        : ['mr', 'create', '--source-branch', branch, '--target-branch', defaultBranch, '--title', title, '--description', body, '--yes']

    // Fail fast and never block on an interactive prompt; strip color so it
    // doesn't pollute URL parsing.
    const options = {
      cwd: repoPath,
      timeout: 60_000,
      env: {
        ...process.env,
        NO_COLOR: '1',
        GH_PROMPT_DISABLED: '1',
        GIT_TERMINAL_PROMPT: '0'
      }
    }

    try {
      const { stdout, stderr } = await execFileAsync(cli, args, options)
      return extractUrl(`${stdout}\n${stderr}`)
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
      if (err.code === 'ENOENT') {
        throw new Error(
          `\`${cli}\` was not found on PATH. Install the ${gitHost === 'github' ? 'GitHub' : 'GitLab'} CLI and authenticate it.`
        )
      }
      const detail = (err.stderr || err.stdout || err.message || '').trim()
      // Both CLIs exit non-zero but print the existing URL when a PR/MR already
      // exists for the branch — recover it instead of failing.
      if (/already exists/i.test(detail)) {
        try {
          return extractUrl(detail)
        } catch {
          /* fall through to the generic error */
        }
      }
      throw new Error(`${cli} failed: ${detail}`)
    }
  }
}
