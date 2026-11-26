# Learnings

Append a dated entry when a correction, a non-obvious fact or a repeated workflow appears.
Promote an entry at count three, or when a test or script proves it.

- 2026-11-26: Auth0 `ext-` params map to `ext-trace_id` on the authorize request. Action
  wrappers must read both `ext-trace_id` and `ext_trace_id` because templates and community
  examples differ.
- 2026-11-26: Auth0 tenant logs publish `references.trace_id`, `details.transaction_id`,
  `details.session_id` and `details.actions.executions[]`. None is customer settable on login
  events. Verified on a test tenant: `event.transaction.id` equals `details.transaction_id`
  and `event.session.id` equals `details.session_id`. A transaction can contain a failed
  attempt and a successful retry. The log stream wraps events as `{log_id, data}`. Details:
  `docs/research/auth0-log-correlation.md`.
