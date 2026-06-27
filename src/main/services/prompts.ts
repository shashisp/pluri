import type { Repo, Ticket } from '@shared/types'

/** URL/branch-safe slug from arbitrary text. */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'ticket'
  )
}

/** Deterministic feature-branch name for a ticket. */
export function branchName(ticket: Ticket): string {
  return `ticket-${ticket.id.slice(0, 8)}-${slug(ticket.title)}`
}

/**
 * The per-repo scope prompt passed via `--append-system-prompt`. Each agent is
 * isolated to its repo's `cwd`; the prompt tells it to self-branch so the
 * working tree stays clean (Phase 4 will move branch creation to the app and
 * add push + MR/PR; Phase 5 adds the shared contract file).
 */
export function buildScopePrompt(
  repo: Repo,
  ticket: Ticket,
  branch: string
): string {
  const role = repo.isContractProducer
    ? 'You are the CONTRACT PRODUCER for this ticket: define the shared API/contract early.'
    : 'You are a consumer for this ticket.'

  return [
    `You are an autonomous engineer working ONLY inside the current directory, which is the "${repo.name}" repository. Never touch anything outside it.`,
    role,
    ``,
    `Ticket: ${ticket.title}`,
    ``,
    `Process:`,
    `1. Create and check out a new git branch named "${branch}" (e.g. \`git checkout -b ${branch}\`). Do all work on that branch.`,
    `2. If a file exists at ../.orchestrator/tickets/${ticket.id}/contract.md, read it first and conform to it.`,
    `3. Implement the ticket within this repository only.`,
    `4. When finished, stage and commit your work on the branch with a clear message.`,
    `   Do NOT push and do NOT open a pull request — the orchestrator handles that.`,
    `Then stop.`
  ].join('\n')
}
