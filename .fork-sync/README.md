# Fork sync

Keeps this fork current with upstream (`stablyai/orca`) without a human watching
the upstream commit feed.

## What a run does

1. Fetches `origin/main` (upstream) and `fork/main`. If upstream's SHA matches
   the cursor from the last run, it exits immediately — no agent, no tokens.
2. Computes the **fork footprint** (files the fork changed since its base) and
   intersects it with the files upstream touched. That overlap is the only place
   upstream churn can collide with us, and it scopes everything below.
3. Runs a trial merge in a persistent worktree. git answers the textual-conflict
   question by itself — no agent involved in deciding *whether* there's a conflict.

**Clean merge** → `pnpm install` / `typecheck` / `test` / `lint`. If those pass
and upstream touched at least one fork file, an agent reviews the overlap for
semantic breakage a clean merge hides: a renamed symbol the fork calls, a changed
signature or type contract, a moved file, an i18n key collision. Green on all of
that → branch is pushed, PR opened and merged automatically. Anything short of
green → PR is left open with the report attached.

**Conflict** → an agent resolves what it is confident about, leaves markers where
it is not, and writes a per-file report: what upstream changed, what the fork
changed, why they collided, what a human must still decide. Branch is pushed and
the PR is labelled `needs-human`. Never auto-merged.

## Layout

- `sync.mjs` — the pipeline. Lives here, not in `config/scripts/`, because
  upstream never touches this path, so the tooling itself is never a conflict.
- `~/.cache/orca-fork-sync/worktree` — persistent worktree, so `node_modules`
  survives between runs and `pnpm install` stays incremental.
- `~/.cache/orca-fork-sync/state.json` — last-processed upstream SHA.
- `~/.cache/orca-fork-sync/reports/` — every report, also posted to the PR body.

Mutable state deliberately lives outside the repo so nightly runs never dirty it.

## Running by hand

```sh
node .fork-sync/sync.mjs --dry-run   # everything except push/PR/merge
node .fork-sync/sync.mjs --force     # ignore the cursor and re-run
node .fork-sync/sync.mjs
```

## Intent manifest

The agent reads `CLAUDE.md` — its "Fork Context" section is what tells it what
the fork deliberately adds and why. **Keep that section current**: it is the only
thing standing between an agent and a plausible-looking resolution that quietly
discards a fork behaviour.

## Node version

The gates run under **node 24** (`package.json` engines), pinned explicitly in the
systemd unit via `mise x node@24`. This is not cosmetic: on node 26 about 40 unit
tests fail with `window.localStorage` undefined — unrelated to any fork change
(they fail identically on the pristine fork base), but enough to keep the test gate
permanently red and block every auto-merge.

If your own shell defaults to node 26, `pnpm test` will fail locally for the same
reason. Run it as `mise x node@24 -- pnpm test`, or pin the repo.

## Cadence

Daily. Upstream moves fast, and small diffs conflict far less than large ones.
Requires the machine to be awake; a missed night is harmless — the next run picks
up every commit since the cursor.
