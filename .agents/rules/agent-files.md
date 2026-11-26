---
description: ADRs, AGENTS.md files and generated indexes.
paths:
  - "**/AGENTS.md"
  - ".agents/**/*.md"
  - "docs/decisions/**/*.md"
---

# Agent files

- An ADR records what is true now, the rules that follow and why. It has frontmatter with
  `id`, `title`, `scope` and optional `enforced-by`.
- Edit an ADR in place when reality changes. Delete it when it stops being true.
- `docs/decisions/INDEX.md` and the rules index in `AGENTS.md` are generated. Never hand
  edit them. Run `pnpm agents:index`.
- `pnpm agents:check` fails on a stale index, a broken relative link, an ADR without a
  title, or a tracked file that looks like it contains a secret.
