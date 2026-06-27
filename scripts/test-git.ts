// GitService + MrService.extractUrl tests against REAL local git repos with a
// local bare remote (no network). Pure Node (simple-git), runs with `node`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitService } from '../src/main/services/GitService'
import { extractUrl } from '../src/main/services/MrService'

let fail = 0
const assert = (c: boolean, m: string): void => {
  console.log(`${c ? '  ok   ' : '  FAIL '}${m}`)
  if (!c) fail++
}

const root = mkdtempSync(join(tmpdir(), 'pluri-git-'))
const git = (cwd: string, ...a: string[]): string =>
  execFileSync('git', a, { cwd }).toString()

// Bare "remote" + a work repo whose origin points at it.
const remote = join(root, 'remote.git')
mkdirSync(remote, { recursive: true })
git(remote, 'init', '--bare', '-q')

const work = join(root, 'work')
mkdirSync(work, { recursive: true })
git(work, 'init', '-q', '-b', 'main')
git(work, 'config', 'user.email', 't@t.t')
git(work, 'config', 'user.name', 'test')
writeFileSync(join(work, 'README.md'), '# work\n')
git(work, 'add', '-A')
git(work, 'commit', '-qm', 'init')
git(work, 'remote', 'add', 'origin', remote)

const svc = new GitService()

// prepareBranch creates + checks out the feature branch.
const prep = await svc.prepareBranch(work, 'main', 'ticket-abc-feature')
assert(prep.warnings.length === 0, 'prepareBranch clean tree -> no warnings')
assert(
  git(work, 'rev-parse', '--abbrev-ref', 'HEAD').trim() === 'ticket-abc-feature',
  'on the feature branch after prepareBranch'
)

// No commits yet -> 0 ahead.
assert(
  (await svc.commitsAhead(work, 'main', 'ticket-abc-feature')) === 0,
  'commitsAhead is 0 before any work'
)

// Make a commit on the branch.
writeFileSync(join(work, 'HELLO.txt'), 'PONG\n')
git(work, 'add', '-A')
git(work, 'commit', '-qm', 'add hello')
assert(
  (await svc.commitsAhead(work, 'main', 'ticket-abc-feature')) === 1,
  'commitsAhead is 1 after a commit'
)

// Remote detection + push.
assert(await svc.hasOrigin(work), 'hasOrigin true when origin configured')
await svc.push(work, 'ticket-abc-feature')
const remoteRefs = git(work, 'ls-remote', '--heads', 'origin')
assert(/ticket-abc-feature/.test(remoteRefs), 'branch pushed to origin')

// Diff shows the new file.
const diff = await svc.diff(work, 'main', 'ticket-abc-feature')
assert(/HELLO\.txt/.test(diff) && /PONG/.test(diff), 'diff contains the change')

// Re-preparing an existing branch resets it to default (fresh run) and warns.
git(work, 'checkout', '-q', 'main')
const prep2 = await svc.prepareBranch(work, 'main', 'ticket-abc-feature')
assert(
  prep2.warnings.some((w) => /already existed/i.test(w)),
  'prepareBranch warns when resetting an existing branch'
)
assert(
  (await svc.commitsAhead(work, 'main', 'ticket-abc-feature')) === 0,
  'reset branch has 0 commits ahead (fresh from default)'
)

// Dirty tree warns but proceeds.
git(work, 'checkout', '-q', 'main')
writeFileSync(join(work, 'README.md'), '# work changed\n')
const prep3 = await svc.prepareBranch(work, 'main', 'ticket-def-other')
assert(prep3.warnings.some((w) => /not clean/i.test(w)), 'dirty tree produces a warning')

// hasOrigin false for a repo without a remote.
const noremote = join(root, 'noremote')
mkdirSync(noremote, { recursive: true })
git(noremote, 'init', '-q', '-b', 'main')
assert(!(await svc.hasOrigin(noremote)), 'hasOrigin false without a remote')

// extractUrl.
assert(
  extractUrl('Created PR\nhttps://github.com/o/r/pull/7\n') ===
    'https://github.com/o/r/pull/7',
  'extractUrl pulls the PR URL from gh output'
)
assert(
  extractUrl('https://gitlab.com/o/r/-/merge_requests/3 some trailing') ===
    'https://gitlab.com/o/r/-/merge_requests/3',
  'extractUrl pulls the MR URL from glab output'
)
let threw = false
try {
  extractUrl('no url here')
} catch {
  threw = true
}
assert(threw, 'extractUrl throws when no URL present')

rmSync(root, { recursive: true, force: true })
console.log(fail === 0 ? '\nGit tests passed ✔' : `\n${fail} git test(s) failed ✖`)
process.exit(fail ? 1 : 0)
