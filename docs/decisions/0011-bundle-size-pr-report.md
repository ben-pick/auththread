---
id: "0011"
title: "The bundle size PR report is part of the budget tool, not BundleMon"
scope:
  - ".github/workflows/ci.yml"
  - "packages/tooling/budget/**"
  - "package.json"
enforced-by:
  - "packages/tooling/budget/src/render.test.ts"
  - "pnpm budget"
---

# 0011. The bundle size PR report is part of the budget tool, not BundleMon

## Outcome

- `pnpm budget` still measures the browser SDK, the page snippet and the Keycloak example
  app with esbuild, and still fails `pnpm check` when an enforced bundle is over budget.
- `pnpm budget --base <ref> --format markdown` measures the base ref in a detached worktree
  and prints a table of gzipped, minified, budget and change per bundle.
- CI measures the PR head against the base in a read-only job, uploads the markdown, then a
  separate job with `pull-requests: write` validates the marker and size and posts one sticky
  comment.
- The markdown mode reports over-budget rows but exits zero. The check job is the gate, so
  the comment still posts on the PR that broke a budget.

## Rules

- One set of budget numbers. The PR report and `pnpm check` call the same `measureAll`, so a
  reviewer cannot see a different size from the one that blocked the merge.
- The report measures source the same way a customer bundles it. It does not read a committed
  artifact or a vendor dashboard.
- The build job runs PR code and holds no write token. The comment job holds the token and
  never checks out PR code.
- Fork PRs skip the comment; the step summary and artifact still carry the report.
- A base worktree has no `node_modules`, so workspace packages are resolved from their
  `package.json` manifests. The base is bundled from its own source, not from the head's
  installed links.

## Why

The budgets existed but a reviewer could not see them move. BundleMon would add the
comparison and the comment, but it measures files on disk against records kept in its hosted
service or a self-hosted MongoDB. This repository's bundles are produced in memory by the
budget tool, its budgets are already enforced by `pnpm check`, and its PR comment pattern
already separates measuring from posting. Reusing BundleMon would mean writing artifacts to
disk, installing a GitHub App or running a database, and keeping a second definition of what
the budgets are. The delta report is a render function over measurements the repo already
owns.

The alternative was a third-party action and a `.bundlemonrc`. It would have been less code
today, but it would also be a second source of truth for the numbers and a service dependency
for a repository whose telemetry path is deliberately self-contained.
