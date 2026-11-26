---
name: add-vendor-skill
description: Use when adding, reviewing or updating a third-party agent skill (Cloudflare Workers, Wrangler, Durable Objects, Turborepo and similar). Evaluates the source, vendors a pinned copy, records it in the lock file and checks it.
---

# Add or update a vendored skill

Third-party skills are pinned copies, never live installs (ADR-0012). Repo rules, ADRs and
`AGENTS.md` win over them.

## Evaluate

Accept a skill only if all hold:

- It comes from the maintainer of the technology (official org repository). Prefer these.
- It has a license that permits copying (Apache-2.0, MIT, BSD) and a `LICENSE` file.
- It matches the versions we pin in `pnpm-workspace.yaml` (`catalog:`). Prefer skills that
  point at docs shipped inside the installed package over skills that embed API snippets.
- It is tracked in git at a commit you can pin.

Reject: unpinned installers (`npx skills add`, marketplaces), community packs that duplicate
an official one, skills that conflict with an ADR, or anything you have not read in full. If
the technology ships its own skills in `node_modules`, do not vendor; use that mechanism.

## Vendor set

auththread vendors exactly these skills today:

- `cloudflare`
- `workers-best-practices`
- `durable-objects`
- `wrangler`
- `workers-profiling`
- `turborepo`

Add a name here and to the `## Skills` section in the root `AGENTS.md` when you vendor
another one.

## Vendor

1. Shallow-clone the source outside the repo, for example
   `git clone --depth 1 https://github.com/<owner>/<repo>.git "$SCRATCH/<repo>"`. Never run
   scripts or installs from it.
2. Find the skill directory (it holds `SKILL.md`). Note the license file at the repo root.
3. Add an entry to `.agents/skills/vendor.lock.json` with `name`, `dir`
   (`.agents/skills/<name>`), `repo`, `path`, the full `commit`, `license`, `licenseFile`,
   `vendoredAt` and a placeholder hash `sha256:` + 64 zeros.
4. Run `mise exec -- pnpm skills:update --repo <owner/repo> --sha <commit>`. It copies the
   directory, adds `LICENSE` and writes the real hash.

The directory name must equal the `name` in `SKILL.md`; do not edit upstream text.

## Review

Read every vendored file. Look for:

- network installs, `curl | sh`, downloads of binaries, telemetry or feedback posts
- commands that conflict with the toolchain (`mise exec`, pnpm catalog versions, `wrangler`
  rather than an alternative CLI, `turbo run` rather than ad hoc scripts)
- advice that conflicts with an ADR, a rule or `AGENTS.md` (for example a framework or
  schema library for the edge zone, a live skill install, or a provider outside the allowed
  set)
- references to skills we do not vendor

Record each finding in the PR under "Decisions made without asking" or "Needs a human". Do
not edit the copy to fix it; if it matters, add a repo rule or `AGENTS.md` line instead.

## Update

- `mise exec -- pnpm skills:update` re-fetches every source at its latest commit;
  `--repo`/`--skill`/`--sha` narrow or pin it. `--dry-run` previews.
- Read the printed diff summary and `git diff .agents/skills`, then re-review changed files.
- `mise exec -- pnpm skills:update --check` verifies the lock and hashes offline.

## Finish

Add the skill name to the Vendored list in the `## Skills` section of root `AGENTS.md` (keep
it under 80 lines), run `mise exec -- pnpm agents:check`, and commit the lock file and the
copied files together.
