---
id: "0010"
title: "The dependency graph and its PR diff are generated, not hand-drawn"
scope:
  - ".github/workflows/ci.yml"
  - "packages/tooling/dep-graph/**"
  - "package.json"
enforced-by:
  - "packages/tooling/dep-graph/src/dep-graph.test.ts"
  - "pnpm graph"
---

# 0010. The dependency graph and its PR diff are generated, not hand-drawn

## Outcome

- `pnpm graph` runs dependency-cruiser with the repository config and collapses the file
  graph to workspace packages: core, providers, runtimes, sinks, tooling and examples.
- The output is a Mermaid `flowchart LR` with one subgraph per tier. Edges that break a rule
  are red. Added edges are green and removed edges are dashed grey.
- `pnpm graph --base <ref> --format markdown` checks the base ref out into a detached
  worktree and diffs packages and edges. It prints a PR comment with counts, added and
  removed rows, violations and the graph.
- The base is cruised with the head's `.dependency-cruiser.cjs`. A PR cannot loosen the rules
  and compare itself under the looser set.
- CI builds the markdown in a read-only job, uploads it, then a separate job with
  `pull-requests: write` validates the marker and size and posts one sticky comment.

## Rules

- The graph is informational. `pnpm boundaries` is what fails the build.
- The build job runs PR code and holds no write token. The comment job holds the token and
  never checks out PR code.
- Fork PRs skip the comment; the step summary and artifact still carry the graph.
- A workspace package is discovered from the directory layout and its `package.json`, not
  from a hand-maintained list.
- The tool only reads dependency-cruiser output. It never imports product code.

## Why

The boundaries were enforced but invisible. A reviewer had to open the config and reason
about the diff by hand. The graph package makes the shape of the change part of the review:
a new edge from core to a provider is red in the comment before the rule fails in CI.

The per-package conformance matrix already showed that separate jobs are expensive when the
work is small. The graph needs one dependency-cruiser run, so it is one job, and the comment
step is split only because of the token, not because the work needs a second runner.
