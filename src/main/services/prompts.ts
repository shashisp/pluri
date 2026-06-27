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
 * The per-repo scope prompt passed via `--append-system-prompt`. The
 * orchestrator has already created and checked out the feature branch (Phase 4),
 * so the agent must NOT branch, push, or open a PR — it implements and commits;
 * the app pushes and opens the MR/PR. When a shared contract file is provided
 * (Phase 5), the producer writes it early and consumers read it first.
 */
export function buildScopePrompt(
  repo: Repo,
  ticket: Ticket,
  branch: string,
  contractPath: string | null,
  producerFirst: boolean
): string {
  const lines: string[] = [
    `You are an autonomous engineer. Make CODE CHANGES ONLY inside the current directory, which is the "${repo.name}" repository — never modify code outside it.`,
    ``,
    `Ticket: ${ticket.title}`,
    ``,
    `Process:`,
    `1. You are already on the branch "${branch}" — do NOT create or switch branches.`
  ]

  let step = 2
  if (contractPath && repo.isContractProducer) {
    lines.push(
      `${step}. You are the CONTRACT PRODUCER. EARLY (before deep implementation), write the agreed API/contract for this ticket to the shared file "${contractPath}" so the other repos' agents can build against it. This file lives outside your repo — writing it is expected and allowed; do not commit it to your repo.`
    )
    step++
  } else if (contractPath && producerFirst) {
    // Only consumers in producer_first mode can rely on the contract existing.
    lines.push(
      `${step}. READ the shared contract at "${contractPath}" first and conform your implementation to it. This file lives outside your repo; read it but do not modify it.`
    )
    step++
  }

  lines.push(
    `${step}. Implement the ticket within this repository only.`,
    `${step + 1}. When finished, stage and commit your work with a clear message.`,
    `   Do NOT push and do NOT open a pull request — the orchestrator handles that.`,
    `Then stop.`
  )

  return lines.join('\n')
}
