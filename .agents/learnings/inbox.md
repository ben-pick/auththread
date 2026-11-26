# Learnings

Append a dated entry when a correction, a non-obvious fact or a repeated workflow appears.
Promote an entry at count three, or when a test or script proves it.

- 2026-11-26: Auth0 `ext-` params map to `ext-trace_id` on the authorize request. Action
  wrappers must read both `ext-trace_id` and `ext_trace_id` because templates and community
  examples differ.
- 2026-11-26: Turbo's `test` task cached a stale pass after a workspace dependency's source
  changed, because packages export `./src/index.ts` and `test` had `dependsOn: []`. A one-line
  edit to `packages/core/otlp/src/index.ts` replayed FULL TURBO for downstream tests; `^test`
  makes the dependency hash part of the graph. Prove with `turbo run test --force`.
- 2026-11-26: Wrangler binding types belong in a small checked-in file generated with
  `wrangler types --no-include-runtime`; the default runtime-inclusive output is a ~638 KB
  generated file that swamps lint. Runtime globals come from the pinned
  `@cloudflare/workers-types` instead. Scope: `examples/cloudflare-worker/**`.
- 2026-11-26: A Durable Object alarm must delete its per-trace deadline only after the handler
  succeeds. Deleting first loses the journey when a sink throws, because the platform retries
  the alarm but has nothing left to reschedule. Covered by the runtime-cloudflare test
  "keeps a deadline when its handler throws so the alarm can retry".
- 2026-11-26: Auth0 tenant logs publish `references.trace_id`, `details.transaction_id`,
  `details.session_id` and `details.actions.executions[]`. None is customer settable on login
  events. Verified on a test tenant: `event.transaction.id` equals `details.transaction_id`
  and `event.session.id` equals `details.session_id`. A transaction can contain a failed
  attempt and a successful retry. The log stream wraps events as `{log_id, data}`. Details:
  `docs/research/auth0-log-correlation.md`.
