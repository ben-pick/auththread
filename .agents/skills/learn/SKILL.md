---
name: learn
description: Use when a user corrects you, a task only works after several tries, you discover a non-obvious fact, or you notice a recurring workflow. Captures a dated entry in .agents/learnings/inbox.md and promotes it to the narrowest durable home.
---

# Learn

Maintain the repository's self-improving loop. Capture cheaply, promote deliberately.

## Capture

Append one entry to `.agents/learnings/inbox.md` when any of these happens:

- The user corrects you or rejects an approach.
- Something only worked after several tries.
- You learn a non-obvious fact about the repo, toolchain or provider.
- You repeat a multi-step workflow that should be scripted or documented.

The inbox uses one dated bullet per lesson:

```text
- YYYY-MM-DD: what was surprising or went wrong; the action that worked.
```

- Keep the date as `YYYY-MM-DD` at the start of the bullet.
- Write one or two sentences. For a long entry, wrap with two-space indentation under the
  same bullet, as the existing entries in the inbox do.
- Put the evidence inline: a command, test name, file or failure that proves the lesson.
  Keep identifiers, commands and paths in backticks.
- Never record secret values. Record only where the secret lives.
- When the same lesson appears again, add a fresh dated bullet instead of editing the old
  one. The promotion threshold counts matching entries.

## Promote

Promote an entry when it has three matching dated bullets in the inbox, or when a test or
script proves it (the rule stated at the top of the inbox). Remove the bullets from the
inbox when you promote them.

Choose the narrowest durable home, in this order:

1. **Mechanical check** — a Biome rule, dependency-cruiser rule or test. Best: the next
   agent cannot forget it. State the `enforced-by` file, test or command.
2. **Path-scoped rule** in `.agents/rules/` — for guidance that cannot be checked
   mechanically. Give it a `description` and the narrowest `paths` globs.
3. **Nearest `AGENTS.md`** — the root `AGENTS.md` today. Put the lesson in the section that
   owns the affected paths.
4. **Skill** in `.agents/skills/` — when the lesson is a procedure with steps, inputs and
   outputs.
5. **ADR** in `docs/decisions/` — when the lesson is a cross-cutting outcome with rules and
   a reason. Use the `write-adr` skill.

Label every promotion in your change description with one of:

- `ADD` — new entry, section or rule.
- `NARROW` — the existing guidance was too broad; scope it.
- `REPLACE` — better text in the same home.
- `RETIRE` — the guidance is untrue; delete it.

## Policy

- Agents may write entries and promote them freely. Humans review the PR diff.
- An ADR records what is true now. Edit it in place when reality changes; delete it when it
  stops being true. Never keep a second ADR for the change.
- Always tell the user what you saved, where you saved it and which promotion label
  applies.

## Workflow

1. Read `.agents/learnings/inbox.md` before adding.
2. Add the dated bullet, or add a new one for a repeated lesson.
3. Decide whether it is promotion-ready.
4. Promote to one home, run the relevant check, and remove the promoted inbox bullets.
5. Delete a retired entry; git holds the text.
6. Run `mise exec -- pnpm agents:check`.
