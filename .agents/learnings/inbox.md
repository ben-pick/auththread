# Learnings

Append a dated entry when a correction, a non-obvious fact or a repeated workflow appears.
Promote an entry at count three, or when a test or script proves it.

- 2026-11-26: Auth0 `ext-` params map to `ext-trace_id` on the authorize request. Action
  wrappers must read both `ext-trace_id` and `ext_trace_id` because templates and community
  examples differ.
- 2026-11-26: Auth0 tenant logs now publish `references.trace_id`, `details.transaction_id`,
  `details.session_id` and `details.actions.executions[]`. None is customer settable. Check
  `event.session.id` against `details.session_id` on a real tenant before relying on hints for
  Auth0. Details: `docs/research/auth0-log-correlation.md`.
