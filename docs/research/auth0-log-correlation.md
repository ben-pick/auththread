# Auth0 log correlation research

Date: 26 November 2026. Researched with the Auth0 Docs MCP server, then verified on a test
tenant with the probe in `scripts/auth0-probe.ts`.

Sources: the tenant log OpenAPI schema, the Management API reference, the custom log stream
docs, the post-login event object, and one real login.

## Question

Can a customer attach a value such as the auththread trace ID to an Auth0 login log event, so
a Log Stream item carries the same trace ID as the browser and the Action?

## Short answer

No customer-supplied metadata is supported on login events. There is no custom field and no
header that `/authorize` echoes into the stream.

The login event is not hint-only. The post-login Action and the log event share a transaction
ID and a session ID. Both matched exactly on the test tenant.

## Verified on a real tenant

One login through a Regular Web App with a post-login Action produced:

```
ACTION transaction=<tx> session=<sess> ext_trace=<32 hex> client=<client>
STREAM type=s transaction=<tx> session=<sess> refs_trace=- executions=1
MATCH transaction=yes session=yes ext_trace_in_stream=no refs_trace_equals_ext=no
```

What this proves:

- `event.transaction.id` equals `details.transaction_id`. Exact.
- `event.session.id` equals `details.session_id`. Exact.
- `ext-trace_id` reaches the Action but does not appear anywhere in the streamed event.
- `references.trace_id` is absent on this event. It is not our trace.
- `details.actions.executions` is present once the Action is attached. The execution ID is in
  the stream.

The log stream wraps each event as `{ "log_id": "...", "data": { ... } }`. The parser must
unwrap `data`; a flat event from the Management API still works.

## The exact join: transaction ID

| Side | Field | Documentation |
| --- | --- | --- |
| Post-login Action | `event.transaction.id` | "Unique identifier for the transaction. Populated for all browser-based login flows." |
| Tenant log event | `details.transaction_id` | "Transaction ID to correlate log events that belong to the same authentication transaction." |

Use the transaction hash, not the session, as the primary key. A session can span several
logins. A transaction is one authentication transaction.

## A transaction can contain a failed attempt and a successful retry

In the test, a wrong password produced an `fp` event, then the same user succeeded. Both
events carried the same `transaction_id`. The Action only ran for the successful attempt.

That matters for outcome derivation.

- The current rule marks a journey `failed` if any event is a failure. With an exact
  transaction join, a failed attempt followed by a success would be labelled `failed` even
  though the user got in.
- The rule should follow the latest terminal signal: a success event or ok callback after a
  failure makes the journey `success`. A failure after a success makes it `failed`. A deny
  stays terminal.
- The journey should keep both events as steps, so the retry is visible.

A failure event can arrive before the Action's hook span. Pending adoption therefore has to
match on transaction ID, not only on user hash.

## Implemented

The transaction join landed after the tenant test:

- The Action wrapper sends `auth.transaction.id`.
- The Log Stream parser reads `details.transaction_id`.
- The buffer indexes transactions per tenant and exposes `findByTransaction`.
- A transaction match is exact and sets the trace ID on the event.
- Pending events are adopted by transaction as well as user hash.
- Outcome follows the latest terminal signal, so a failed attempt followed by a success is a
  successful journey.

## What this means for auththread

`ext-trace_id` remains the only customer-controlled value that survives `/authorize` into the
page and the post-login Action. It still does not appear in the log event.

The feed join can be exact without it:

1. Add `auth.transaction.id` to the hook span and the provider event.
2. Index the transaction ID as a hint, scoped by tenant.
3. Treat a transaction match as exact, and set the matched trace ID on the event so
   `correlationCounts.exact` is true.
4. Keep the user-hash hint as a fallback for events without a transaction, such as failures
   before any hook runs.
5. Change outcome derivation to use the latest terminal success or failure, with deny still
   terminal.
6. Add tests for failure then success, success then failure, and a denied attempt followed by
   nothing.

## What about Action execution IDs

The stream carries `details.actions.executions[]`, confirmed on the tenant. The Management API
get-execution response contains, per action:

- `action_name`
- `error`
- `started_at`
- `ended_at`

It does not include the Action input, so it cannot recover `ext_trace_id`. It is useful for
enriching hook name, error and duration without our wrapper, not for correlation.

## What about references.trace_id

The schema describes `references.trace_id` as a W3C trace ID (32 hex). It was absent on the
test login event. Nothing documents how it is populated. `traceparent` appears in the
MyAccount API docs, not in the login or log stream docs. Treat it as Auth0's trace.

## Sources

- Tenant log schema: https://auth0.com/docs/oas/tenant-logs/logs-schema.json
- Management API request correlation: https://auth0.com/docs/api/management/v2
- Get an execution: https://auth0.com/docs/api/management/v2/actions/get-execution
- Custom log streams: https://auth0.com/docs/customize/log-streams/custom-log-streams
- Post-login event object: https://auth0.com/docs/actions/reference/post-login/post-login-event-object
