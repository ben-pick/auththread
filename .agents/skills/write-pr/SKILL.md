---
name: write-pr
description: Use when opening or updating a pull request or writing a PR description. Fills the AI-native template from the diff against the base branch, choosing review-worthy hunks and recording decisions, evidence and human follow-ups.
---

# Write a PR description

The reviewer has five minutes. Describe intent, risk and where to look. Never restate the diff.

## When to use

- Opening a pull request, or updating its description after new commits.
- Writing a PR body for a human to paste or for `gh pr edit --body-file`.
- Reviewing whether an existing description still matches the branch.

## 1. Establish the range

Use the merge base, not the current base tip, so unrelated main commits stay out:

```bash
BASE="${BASE:-main}"
git fetch origin "$BASE" --quiet
git log --oneline "origin/$BASE...HEAD"
git diff --stat "origin/$BASE...HEAD"
git diff --name-status "origin/$BASE...HEAD"
git diff "origin/$BASE...HEAD"
```

Read the commits and the diff, not only the file list. If the branch is huge, use
`git diff --stat` to rank files, then read the highest-risk ones in full.

## 2. Fill the template

Copy the headings from `.github/pull_request_template.md` verbatim and in order. Do not keep
the guidance comments in the final body.

### TL;DR

- One or two sentences of intent and outcome.
- `Behaviour change:` says what a user or system now does differently, or `none`.
- Link the central ADR or issue instead of explaining the whole design.

### Risk

Pick `low`, `medium` or `high`, then one line on blast radius and reversibility. Raise it for
deploy configuration, data formats, auth, irreversible data changes, cross-package breakage or
anything that changes the browser SDK or page snippet budget. Lower it for docs, tests and
additions behind a new import.

### Review here

This is the section that earns the review. Order 3-5 items, most important first, as
`path:line — why it matters`. Get line numbers from the new side of the diff:

```bash
git diff -U0 "origin/$BASE...HEAD" -- path/to/file.ts
```

Select changes that are:

- **Logic-bearing** — control flow, error handling, decoders and parsing, concurrency,
  retries, timeouts, caching, state transitions and join logic.
- **Boundary or contract** — public exports, HTTP request and response shapes, generated
  provider config, dependency direction, workspace wiring and the `Fetch` port.
- **Security-relevant** — auth, input validation, tenant hashing, secret handling, egress,
  isolation, filesystem or network access. No raw identifier may survive any path.
- **Hard to reverse** — deploy paths, persisted formats, data resets, renames that change
  identity.

When the `dep-graph` CI comment exists, link it from the first item and say which added
package or edge needs judgement. Its Added packages and Added edges sections list the
workspace changes, so cite them instead of re-reading `package.json` files. A boundary
violation line always belongs in Risk. Do not copy the comment into the body.

Exclude lockfiles, generated indexes, scaffolded template output, renames, formatting and
tests that only follow an implementation, unless a test is the clearest statement of intended
behaviour. Do not pad to five; three strong items beat five weak ones.

Put mechanical files in the collapsed **Safe to skim** block with the command that produced
them, for example `pnpm install` or `pnpm agents:index`.

### Decisions made without asking

Collect choices a reviewer might have expected to be asked about:

```bash
git diff --name-status "origin/$BASE...HEAD" -- docs/decisions .agents/learnings/inbox.md
git diff "origin/$BASE...HEAD" -- docs/decisions .agents/learnings/inbox.md
```

- Link the ADR added in this diff.
- Write `inbox` when the decision is only a learning in `.agents/learnings/inbox.md`.
- Fill `decision | chosen | alternative rejected | ADR`.
- Write `none` when there is genuinely nothing.

### Evidence

List commands you ran and their real result, including counts when the tool prints them:

- `mise exec -- pnpm check` — pass, with the test total. A cached turbo replay is not proof:
  for large or test-affecting changes also run the affected package suite with `--force` and
  cite that result.
- `mise exec -- pnpm demo` — pass when the corpus, join logic or a wide event changed.
- `mise exec -- pnpm smoke` — pass when the Node HTTP surface, auth, feed signature, join or
  sink changed.
- `mise exec -- pnpm budget` — pass with the reported browser SDK and page snippet sizes when
  either changed.
- `mise exec -- pnpm agents:check` — pass when agent files, ADRs, rules or skills changed.
- `review-against-rules: N findings` (or `no findings`) — run the `review-against-rules` skill
  on the range and state the count; list any finding you leave unfixed under Needs a human.
- Focused package test or typecheck when that is the only relevant proof.

Always add **Not verified:** for real deploys, live auth provider calls, credentials, manual UI
checks or anything else you could not run. Never claim a command you did not run.

### Knowledge changes

Scan the diff for agent knowledge and label each change `ADD | NARROW | REPLACE | RETIRE`:

```bash
git diff --name-status "origin/$BASE...HEAD" -- .agents AGENTS.md
```

- `ADD` — a new learning, rule, skill or ADR.
- `NARROW` — existing guidance scoped more tightly.
- `REPLACE` — better guidance in the same home.
- `RETIRE` — guidance or a learning deleted because it is untrue.

Write `none` when nothing changed.

### Needs a human

Keep this separate and concrete: open questions, secrets or accounts to create, approvals,
environment setup, manual verification and follow-up issues. Write `none` when empty.

### Footer

Keep `<!-- Generated by <agent/model>; human reviewer: … -->` at the end. Name the model that
wrote the body and leave the reviewer blank for the human.

## 3. Update an existing PR

```bash
gh pr view <number> --json baseRefName,body
gh pr edit <number> --body-file pr-body.md
```

Rewrite the body instead of appending a status comment. Re-run the range and evidence steps
after new commits so the description stays true.

## Rules

- Write for a reviewer with five minutes; keep under ~60 rendered lines.
- No restating the diff and no pasted code blocks longer than a line or two.
- Link to files, ADRs and issues instead of duplicating their content.
- Prefer tables and short lists.
- The required headings must survive verbatim.
- Never include secret values; name where a secret lives.
- Never claim checks, review or approval that did not happen.

## Done when

- The body follows `.github/pull_request_template.md` with all seven headings present.
- `Review here` names 3-5 real `path:line` locations and why they matter.
- Evidence contains only commands actually run, plus explicit `Not verified` items.
- Decisions and knowledge changes are linked or marked `none`.
- `mise exec -- pnpm agents:check` passes when the diff touches agent files.
