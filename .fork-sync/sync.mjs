#!/usr/bin/env node
// Upstream sync pipeline for this fork. Run by cron; see .fork-sync/README.md.
//
// Why this lives in .fork-sync/ rather than config/scripts/: upstream never
// touches this path, so the sync tooling itself never becomes a merge conflict.
// Mutable state (worktree, cursor, reports) stays under ~/.cache so cron runs
// never dirty the repo.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const REPO = dirname(import.meta.dirname)
const CACHE = join(homedir(), '.cache', 'orca-fork-sync')
const WORKTREE = join(CACHE, 'worktree')
const STATE_FILE = join(CACHE, 'state.json')
const REPORTS = join(CACHE, 'reports')

const UPSTREAM = 'origin' // origin IS upstream here (stablyai/orca)
const FORK = 'fork' // WrittenByAI/orca
const FORK_BRANCH = 'main'

const DRY_RUN = process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')
const SKIP_GATES = process.argv.includes('--skip-gates')

function run(cmd, args, { cwd = REPO, check = true } = {}) {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (check && res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${res.status})\n${res.stderr ?? ''}`)
  }
  return { ok: res.status === 0, out: (res.stdout ?? '').trim(), err: (res.stderr ?? '').trim() }
}

const git = (args, opts) => run('git', args, opts)
const log = (msg) => console.log(`[fork-sync] ${msg}`)

function readState() {
  if (!existsSync(STATE_FILE)) {
    return { lastUpstreamSha: null }
  }
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { lastUpstreamSha: null }
  }
}

function writeState(state) {
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`)
}

// Keeps the worktree persistent across runs so node_modules survives and
// `pnpm install` stays incremental instead of a cold install every night.
function ensureWorktree() {
  if (existsSync(join(WORKTREE, '.git'))) {
    return
  }
  mkdirSync(CACHE, { recursive: true })
  log('creating sync worktree')
  git(['worktree', 'add', '--detach', WORKTREE, `${FORK}/${FORK_BRANCH}`])
}

function agent(prompt) {
  const res = spawnSync(
    'claude',
    [
      '-p',
      prompt,
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      'Read,Edit,Write,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(git status:*)'
    ],
    { cwd: WORKTREE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  const out = (res.stdout ?? '').trim()
  const verdict = out.match(/^VERDICT:\s*(clean|risky|needs-human)\s*$/m)?.[1] ?? 'needs-human'
  return { out, verdict }
}

// Vitest prints one ` FAIL  <file> > <suite> > <test>` line per failing test.
function parseFailures(output) {
  return new Set(
    output
      .split('\n')
      .filter((line) => line.startsWith(' FAIL '))
      .map((line) => line.slice(6).trim())
  )
}

function runStep(label, cmd, args) {
  log(`gate: ${label}`)
  const res = run(cmd, args, { cwd: WORKTREE, check: false })
  return { ...res, combined: `${res.out}\n${res.err}` }
}

// Why a differential test gate: some suites fail for reasons that have nothing to
// do with the fork (host shell integration, git boundaries, cross-file state
// pollution) and fail identically on pristine upstream. Demanding a fully green
// run would keep the gate permanently red and block every auto-merge, so a test
// only counts against us if it does NOT already fail on the fork before the merge.
// The baseline is measured, not stored, so it cannot rot — and the second run is
// only paid for when the first one is red.
function runTestGate(branch) {
  const merged = runStep('pnpm run test', 'pnpm', ['run', 'test'])
  if (merged.ok) {
    return { ok: true }
  }

  const mergedFailures = parseFailures(merged.combined)
  log(`${mergedFailures.size} failing test(s) — measuring the pre-merge baseline`)
  git(['switch', '--detach', `${FORK}/${FORK_BRANCH}`], { cwd: WORKTREE })
  run('pnpm', ['install', '--prefer-offline', '--frozen-lockfile'], { cwd: WORKTREE, check: false })
  const baseline = runStep('pnpm run test (baseline)', 'pnpm', ['run', 'test'])
  const baselineFailures = parseFailures(baseline.combined)
  git(['switch', branch], { cwd: WORKTREE })
  run('pnpm', ['install', '--prefer-offline', '--frozen-lockfile'], { cwd: WORKTREE, check: false })

  const regressions = [...mergedFailures].filter((f) => !baselineFailures.has(f))
  if (regressions.length === 0) {
    log(`all ${mergedFailures.size} failure(s) already fail pre-merge — not a regression`)
    return { ok: true, preExisting: mergedFailures.size }
  }
  return {
    ok: false,
    failed: 'pnpm run test',
    output: `${regressions.length} test(s) fail after the merge but pass before it:\n\n${regressions.join('\n')}`
  }
}

function runGates(branch) {
  if (SKIP_GATES) {
    log('gates skipped (--skip-gates)')
    return { ok: true }
  }
  for (const [cmd, args] of [
    ['pnpm', ['install', '--prefer-offline', '--frozen-lockfile']],
    ['pnpm', ['run', 'typecheck']]
  ]) {
    const label = `${cmd} ${args.join(' ')}`
    const res = runStep(label, cmd, args)
    if (!res.ok) {
      return { ok: false, failed: label, output: res.combined.slice(-6000) }
    }
  }

  const tests = runTestGate(branch)
  if (!tests.ok) {
    return tests
  }

  const lint = runStep('pnpm run lint', 'pnpm', ['run', 'lint'])
  if (!lint.ok) {
    return { ok: false, failed: 'pnpm run lint', output: lint.combined.slice(-6000) }
  }
  return { ok: true, preExisting: tests.preExisting }
}

function publish(branch, title, body, { autoMerge }) {
  if (DRY_RUN) {
    log(`dry-run: would push ${branch} (autoMerge=${autoMerge})`)
    return null
  }
  git(['push', '-f', FORK, `HEAD:refs/heads/${branch}`], { cwd: WORKTREE })
  const pr = run(
    'gh',
    [
      'pr',
      'create',
      '--repo',
      'WrittenByAI/orca',
      '--base',
      FORK_BRANCH,
      '--head',
      branch,
      '--title',
      title,
      '--body',
      body
    ],
    { cwd: WORKTREE, check: false }
  )
  // `gh pr create` fails when a PR for this branch already exists (a re-run after
  // a partial failure); fall back to the existing one rather than losing the merge.
  let url = pr.out.split('\n').findLast(Boolean) ?? ''
  if (!url.startsWith('http')) {
    const existing = run(
      'gh',
      ['pr', 'view', branch, '--repo', 'WrittenByAI/orca', '--json', 'url', '--jq', '.url'],
      { check: false }
    )
    url = existing.ok ? existing.out.trim() : ''
  }
  if (!url) {
    throw new Error(`could not open or find a PR for ${branch}:\n${pr.err}`)
  }
  if (autoMerge && url) {
    const merged = run('gh', ['pr', 'merge', url, '--merge', '--delete-branch'], { check: false })
    log(merged.ok ? `merged ${url}` : `merge failed, PR left open: ${url}`)
  } else if (url) {
    run('gh', ['pr', 'edit', url, '--add-label', 'needs-human'], { check: false })
    log(`PR needs review: ${url}`)
  }
  return url
}

function saveReport(name, contents) {
  mkdirSync(REPORTS, { recursive: true })
  const path = join(REPORTS, name)
  writeFileSync(path, contents)
  return path
}

function main() {
  log('fetching')
  git(['fetch', UPSTREAM, 'main'])
  git(['fetch', FORK, FORK_BRANCH])

  const upstreamSha = git(['rev-parse', `${UPSTREAM}/main`]).out
  const state = readState()
  if (!FORCE && state.lastUpstreamSha === upstreamSha) {
    log(`up to date at ${upstreamSha.slice(0, 9)} — nothing to do`)
    return
  }

  const short = upstreamSha.slice(0, 9)
  const base = git(['merge-base', `${UPSTREAM}/main`, `${FORK}/${FORK_BRANCH}`]).out
  const newCommits = git(['rev-list', '--count', `${base}..${UPSTREAM}/main`]).out
  log(`upstream at ${short}, ${newCommits} new commit(s) since fork base`)

  // The fork's own footprint — the only files where upstream churn can collide
  // with us, textually or semantically. Scopes the agent review to what matters.
  const footprint = new Set(
    git(['diff', '--name-only', base, `${FORK}/${FORK_BRANCH}`])
      .out.split('\n')
      .filter(Boolean)
  )
  const upstreamTouched = git(['diff', '--name-only', base, `${UPSTREAM}/main`])
    .out.split('\n')
    .filter(Boolean)
  const overlap = upstreamTouched.filter((f) => footprint.has(f))
  log(`fork footprint: ${footprint.size} files, upstream overlap: ${overlap.length}`)

  ensureWorktree()
  const branch = `sync/upstream-${short}`
  git(['switch', '-C', branch, `${FORK}/${FORK_BRANCH}`], { cwd: WORKTREE })

  // git answers the textual-conflict question deterministically — no agent needed.
  const merge = git(['merge', '--no-commit', '--no-ff', `${UPSTREAM}/main`], {
    cwd: WORKTREE,
    check: false
  })
  const conflicted = git(['diff', '--name-only', '--diff-filter=U'], { cwd: WORKTREE })
    .out.split('\n')
    .filter(Boolean)

  const stamp = `${short}`
  if (!merge.ok || conflicted.length > 0) {
    handleConflict({ branch, short, stamp, conflicted, overlap })
  } else {
    handleClean({ branch, short, stamp, base, overlap, newCommits })
  }

  // Only advance the cursor on a run that actually published, and never on a dry
  // run — a poisoned cursor would silently skip a whole batch of upstream commits.
  // Anything that threw above leaves the cursor alone, so the next run retries.
  if (DRY_RUN) {
    log('dry-run: cursor left untouched')
    return
  }
  writeState({ lastUpstreamSha: upstreamSha, lastRunBranch: branch })
}

function handleConflict({ branch, short, stamp, conflicted, overlap }) {
  log(`CONFLICT in ${conflicted.length} file(s): ${conflicted.join(', ')}`)
  const reportPath = join(REPORTS, `${stamp}-conflict.md`)
  mkdirSync(REPORTS, { recursive: true })

  const { out, verdict } = agent(
    `You are resolving an upstream merge into a fork. A merge of upstream/main is IN PROGRESS in this worktree with conflicts.\n\n` +
      `Read CLAUDE.md first — its "Fork Context" section states what this fork deliberately adds and why. Preserve that intent.\n\n` +
      `Conflicted files:\n${conflicted.map((f) => `- ${f}`).join('\n')}\n\n` +
      `Your job:\n` +
      `1. Resolve each conflict where you are confident, keeping BOTH upstream's change and the fork's intent. Remove the markers you resolve.\n` +
      `2. Where you are NOT confident, leave the conflict markers in place. Do not guess.\n` +
      `3. Write a report to ${reportPath} with, per file: what upstream changed, what the fork changed, why they collided, what you did, and what a human must still decide.\n\n` +
      `Do not run git add, git commit, or git merge. Do not push.\n\n` +
      `Finish your reply with exactly one line: "VERDICT: clean" if you resolved every conflict confidently, otherwise "VERDICT: needs-human".`
  )

  const report = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : out.slice(-8000)
  const stillConflicted = git(['diff', '--name-only', '--diff-filter=U'], {
    cwd: WORKTREE
  })
    .out.split('\n')
    .filter(Boolean)

  git(['add', '-A'], { cwd: WORKTREE })
  git(
    [
      'commit',
      '-m',
      `merge upstream ${short} (conflicts)\n\nResolved by fork-sync agent; see report.`
    ],
    {
      cwd: WORKTREE,
      check: false
    }
  )

  const resolvedAll = stillConflicted.length === 0 && verdict === 'clean'
  const status = resolvedAll
    ? 'The agent resolved all conflicts, but this was a conflicting merge — review before merging.'
    : `Unresolved markers remain in: ${stillConflicted.join(', ') || '(none, but agent was unsure)'}`
  const body = `Upstream \`${short}\` merged into the fork with **conflicts**.\n\n${status}\n\nFork files upstream also touched: ${overlap.join(', ') || 'none'}\n\n---\n\n${report}`

  saveReport(`${stamp}-conflict.md`, body)
  publish(branch, `Sync upstream ${short} (conflicts)`, body, { autoMerge: false })
}

function handleClean({ branch, short, stamp, overlap, newCommits }) {
  log('merge is textually clean — committing and running gates')
  git(['commit', '-m', `merge upstream ${short}\n\n${newCommits} upstream commit(s).`], {
    cwd: WORKTREE
  })

  const gates = runGates(branch)
  if (!gates.ok) {
    const body =
      `Upstream \`${short}\` merged cleanly, but **${gates.failed} failed**.\n\n` +
      `Fork files upstream also touched: ${overlap.join(', ') || 'none'}\n\n` +
      `<details><summary>Output</summary>\n\n\`\`\`\n${gates.output}\n\`\`\`\n\n</details>`
    saveReport(`${stamp}-gates-failed.md`, body)
    publish(branch, `Sync upstream ${short} (gates failed)`, body, { autoMerge: false })
    return
  }
  const gateNote = gates.preExisting
    ? `\n\n${gates.preExisting} test(s) fail, but fail identically before the merge — not a regression.`
    : ''

  // A clean merge that compiles can still be wrong: upstream may have renamed a
  // symbol or changed a contract the fork depends on. This is the part git and
  // the gates cannot answer.
  if (overlap.length === 0) {
    const body = `Upstream \`${short}\` merged cleanly, gates green, and upstream touched none of the fork's files.${gateNote}`
    publish(branch, `Sync upstream ${short}`, body, { autoMerge: true })
    return
  }

  const reportPath = join(REPORTS, `${stamp}-review.md`)
  mkdirSync(REPORTS, { recursive: true })
  const { out, verdict } = agent(
    `You are reviewing an upstream merge into a fork. The merge is already committed here and is textually clean${
      SKIP_GATES ? '. Gates were NOT run for this review.' : '; typecheck, tests and lint all pass.'
    }\n\n` +
      `Read CLAUDE.md first — its "Fork Context" section states what this fork deliberately adds and why.\n\n` +
      `These files are BOTH changed by the fork AND changed by upstream in this batch:\n${overlap.map((f) => `- ${f}`).join('\n')}\n\n` +
      `Use \`git show\`/\`git diff\` to inspect. Look for SEMANTIC breakage that a clean merge hides: a renamed or removed symbol the fork calls, a changed function signature or type contract, a moved file, a changed convention the fork mirrors, an i18n key collision.\n\n` +
      `Do not fix anything. Write findings to ${reportPath} (empty findings = say so explicitly).\n\n` +
      `Finish your reply with exactly one line: "VERDICT: clean" if the fork is safe, otherwise "VERDICT: risky".`
  )

  const report = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : out.slice(-8000)
  const safe = verdict === 'clean'
  const body =
    `Upstream \`${short}\` (${newCommits} commits) merged cleanly; gates green.\n\n` +
    `Fork files upstream also touched: ${overlap.join(', ')}\n\n` +
    `Semantic review verdict: **${verdict}**\n\n---\n\n${report}`

  saveReport(`${stamp}-review.md`, body)
  publish(branch, `Sync upstream ${short}`, body, { autoMerge: safe })
}

try {
  main()
} catch (err) {
  console.error(`[fork-sync] failed: ${err.message}`)
  process.exit(1)
}
