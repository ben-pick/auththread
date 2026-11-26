---
name: write-adr
description: Use when choosing between options, picking a library or infrastructure provider, or setting a cross-package convention. Writes an outcome ADR recording what is true now, the rules that follow and why, plus the generated index.
---

# Write an ADR

An ADR records what is true now, not the discussion that got there. Future agents read it as
current context; git holds the history.

## Trigger

Write an ADR when you:

- Choose between two or more viable options.
- Pick a library, runtime, provider or infrastructure service.
- Establish a convention that spans packages or products.

Do not write an ADR for a local implementation detail or a reversible experiment.

## Steps

1. Read `docs/decisions/INDEX.md` and the ADRs in the affected scope. Use the highest id in
   the index to pick the next number; do not hardcode the range here.
2. If an ADR already owns the area, edit it in place. Otherwise copy
   `.agents/templates/ADR.md` to `docs/decisions/<NNNN>-<short-slug>.md` with the next
   zero-padded number.
3. Fill every required field: `id`, `title` and `scope`. Add `enforced-by` when a config
   file, test or command makes the decision mechanical; omit it otherwise.
4. Write the body in order:
   - `## Outcome` — what is true now, present tense.
   - `## Rules` — what code must and must not do, naming the enforcing file or command.
   - `## Why` — a short reason for the current shape, not a story about the options
     rejected. Omit it only when the rules are self-evident.
   - Another section only for current information that does not fit, such as
     `## Deferred`.
5. If code or a nearby document would be unclear without the decision, reference it with a
   comment such as `// ADR-0005`. Do not add references everywhere.
6. Run `mise exec -- pnpm agents:index` to regenerate `docs/decisions/INDEX.md` and the
   rules index in the root `AGENTS.md`.
7. Run `mise exec -- pnpm agents:check`.

## Rules

- Never add a second ADR for a change to an existing decision. Edit the owning ADR.
- Delete an ADR when its outcome stops being true; fold a fact that still holds into the ADR
  that owns it.
- Frontmatter holds only `id`, `title`, `scope` and optional `enforced-by`. There is no
  status, date, `review-after`, `supersedes` or `superseded-by`.
- The body holds Outcome, Rules and, when needed, Why. Add a section only for current facts
  that do not fit those three. No Context, Alternatives or Consequences.
- Write present tense. State the current shape; do not narrate what was rejected.
- Keep IDs stable for surviving ADRs; gaps are fine.
- `scope` contains path globs. Every glob should match real files.
- `enforced-by` lists the checks that make the decision mechanical (a config file, a test or
  a command). Leave it out when nothing enforces the decision.
- Add relative markdown links only to files that exist.
- `docs/decisions/INDEX.md` and the `AGENTS.md` rules index are generated. Never hand edit
  them.
