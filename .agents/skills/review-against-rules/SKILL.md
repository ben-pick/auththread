---
name: review-against-rules
description: Use when reviewing a diff (base..head), before merging or opening a pull request, or as a reviewer subagent. Lists changed files, finds the rules, AGENTS.md files and skills that apply to each, checks the change against them and reports findings as path:line — rule — problem — fix.
---

# Review against rules

Check a diff against the repository's written rules. Rules that nobody checks are silently
ignored, and conflicting rules are ignored too; this skill is the check.

## Inputs

- `BASE` (default `origin/main`; use the PR base) and `HEAD` (default `HEAD`).
- Work read-only. Do not edit files while reviewing.

## 1. List the change

```bash
git fetch origin --quiet
git diff --name-status "$BASE...$HEAD"
git diff -U0 "$BASE...$HEAD"
```

## 2. Find the applicable guidance, per changed file

- **Rules**: the Rules index table in the root `AGENTS.md` lists path globs; a rule applies
  to a file when any glob in its `paths` matches. Read each matching rule:
  `.agents/rules/typescript.md`, `boundaries.md`, `testing.md` and `agent-files.md`.
- **AGENTS.md**: the nearest `AGENTS.md` above the file, then its parents. auththread has one
  at the repository root; read its Repo map, Verify, Invariants and Skills sections.
- **Skills**: any skill whose description matches the kind of change. For example:
  `write-adr` for `docs/decisions/**`, `learn` for `.agents/learnings/**`, `write-pr` for a
  PR description, `add-vendor-skill` for `.agents/skills/**`, and `review-against-rules`
  itself for a review. Vendored skills (`cloudflare`, `workers-best-practices`,
  `durable-objects`, `wrangler`, `workers-profiling`, `turborepo`) are advice only; repo
  rules, ADRs and `AGENTS.md` win over them.
- **ADRs**: `docs/decisions/INDEX.md` lists the decisions and their scopes. Read every ADR
  whose scope touches the changed paths.
- **Contradictions**: if two applicable texts disagree, report that as a finding on the
  later-written or more general one instead of picking silently.

## 3. Check

Walk each changed hunk against each applicable rule. Prefer mechanical evidence:

```bash
mise exec -- pnpm lint
mise exec -- pnpm agents:check
mise exec -- pnpm boundaries
mise exec -- pnpm test
```

Only report what you can point at: a line in the diff and the rule text it breaks. Skip
style the formatter owns. Do not restate the diff.

## 4. Report

One finding per line, most severe first:

```text
path:line — rule — problem — fix
```

`rule` is the file and heading (`.agents/rules/typescript.md § TypeScript`) or the mechanical
check. End with the count: `N findings`, or exactly `no findings` when clean.

## Using it from a PR

`write-pr` records the result under Evidence as `review-against-rules: N findings` (or
`no findings`) with the range it covered. A reviewer subagent runs this skill on
`origin/<base>...HEAD` and returns the report unchanged.
