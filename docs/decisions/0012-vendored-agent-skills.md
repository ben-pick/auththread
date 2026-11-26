---
id: "0012"
title: "Vendored agent skills are pinned copies with a lock and an offline check"
scope:
  - ".agents/skills/**"
  - "AGENTS.md"
enforced-by:
  - ".agents/skills/vendor.lock.json"
  - "pnpm agents:check"
  - "pnpm skills:update --check"
---

# 0012. Vendored agent skills are pinned copies with a lock and an offline check

## Outcome

- Third-party agent skills are copied into `.agents/skills/<name>/` at a pinned commit, with
  their upstream `LICENSE`. They are never installed live from a marketplace or installer.
- `.agents/skills/vendor.lock.json` records each vendored skill: its source repository, path,
  full commit, license, license file, vendoring date and a SHA-256 hash of the copied files.
- `pnpm skills:update` refreshes the copies from their sources. `pnpm skills:update --check`
  verifies the recorded hashes offline.
- Repo-authored workflow skills, such as `learn`, `write-adr`, `review-against-rules`,
  `write-pr` and `add-vendor-skill`, live in `.agents/skills/` beside the vendored ones. They
  describe this repository and are edited here.
- The vendored set is `cloudflare`, `workers-best-practices`, `durable-objects`, `wrangler`,
  `workers-profiling` and `turborepo`.

## Rules

- Never install a skill live with `npx skills add`, a marketplace command or a postinstall
  script. Copy it and record the commit.
- A vendored skill's text is not edited. If it conflicts with this repo, a rule, an ADR or
  `AGENTS.md` wins; add repo guidance instead of patching the copy.
- A new vendored skill updates `vendor.lock.json` and the `## Skills` section of the root
  `AGENTS.md`, and the lock and copied files are committed together.
- `pnpm agents:check` covers agent files and verifies the vendored hashes, so `pnpm check`
  enforces both in CI. `pnpm skills:update --check` verifies the copies offline on their own.
- Each `SKILL.md` stays under 200 lines. Links in repo-authored skill files are relative and
  resolve; vendored copies are exempt from link checks and still scanned for secrets.
- Vendored skills that ship feedback workflows (`gh issue create`) never run without explicit
  user approval. They are review context, not an automatic network write.

## Why

A live skill install puts unreviewed text and network behaviour in the path of every agent
run. A pinned copy with a hash and a license is reviewable, reproducible and removable. The
workflow skills need the same reviewable home, so they sit beside the vendored set with the
opposite rule: they are ours to edit.
