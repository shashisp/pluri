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

export interface ScopePromptInput {
  repo: Repo
  ticket: Ticket
  branch: string
  contractPath: string | null
  producerFirst: boolean
  /** Tier 1: workspace.md content (product/domain context). */
  workspaceMemory: string
  /** Tier 3: contract.md content, if already written. */
  contractContent: string
  /** Whether the repo has a CLAUDE.md to trust (tier 2). */
  hasClaudeMd: boolean
}

/**
 * Compose the per-repo scope prompt (passed via `--append-system-prompt`) from
 * the layered context tiers, in order:
 *   1. workspace memory (product/domain context, shared across all repos)
 *   2. a REFERENCE to the repo's CLAUDE.md (read natively by Claude Code; never
 *      inlined — that would double the tokens) + "don't re-explore" guidance
 *   3. the shared contract (producer writes it; consumers get it injected)
 *   4. the task itself is the `-p` prompt (the ticket spec), not part of this.
 *
 * The orchestrator already created/checked out the feature branch (Phase 4), so
 * the agent implements + commits but does NOT branch, push, or open a PR.
 */
export function buildScopePrompt(input: ScopePromptInput): string {
  const {
    repo,
    ticket,
    branch,
    contractPath,
    producerFirst,
    workspaceMemory,
    contractContent,
    hasClaudeMd
  } = input

  const lines: string[] = []

  // Tier 1 — workspace/product context.
  if (workspaceMemory.trim()) {
    lines.push(
      '## Product & domain context (shared across this workspace)',
      workspaceMemory.trim(),
      ''
    )
  }

  // Scope.
  lines.push(
    `You are an autonomous engineer working on the "${repo.name}" repository. Make CODE CHANGES ONLY inside the current directory — never modify code outside it.`,
    ``,
    `Ticket: ${ticket.title}`,
    ``
  )

  // Tier 2 — repo CLAUDE.md reference + the core efficiency instruction.
  if (hasClaudeMd) {
    lines.push(
      `This repo has a CLAUDE.md describing its stack, structure (codebase map), and conventions. TRUST it: go straight to the relevant files. Do NOT re-explore the whole repo to orient yourself.`,
      ``
    )
  }

  lines.push(`Process:`, `1. You are already on the branch "${branch}" — do NOT create or switch branches.`)
  let step = 2

  // Tier 3 — the shared contract.
  if (contractPath && repo.isContractProducer) {
    lines.push(
      `${step}. You are the CONTRACT PRODUCER. EARLY (before deep implementation), write the agreed API/contract for this ticket to the shared file "${contractPath}" so the other repos' agents can build against it. This file lives outside your repo — writing it is expected and allowed; do not commit it to your repo.`
    )
    step++
  } else if (contractContent.trim()) {
    lines.push(
      `${step}. A shared contract has already been defined for this ticket — conform to it and do NOT re-investigate the API:`,
      ``,
      '```',
      contractContent.trim(),
      '```'
    )
    step++
  } else if (contractPath && producerFirst) {
    lines.push(
      `${step}. READ the shared contract at "${contractPath}" first and conform your implementation to it; do not modify it.`
    )
    step++
  }

  lines.push(
    `${step}. Implement the ticket within this repository only.`,
    `${step + 1}. Verify your change ONCE (build/test as appropriate), then STOP. Do not loop re-reviewing your own work.`,
    `${step + 2}. Stage and commit your work with a clear message. Do NOT push and do NOT open a pull request — the orchestrator handles that.`
  )

  return lines.join('\n')
}
