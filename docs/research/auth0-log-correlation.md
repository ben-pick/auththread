# Auth0 log correlation research

Date: 26 November 2026. Researched with the Auth0 Docs MCP server, which is now configured
globally in `~/.config/opencode/opencode.json` as `auth0-docs`.

Sources: the tenant log OpenAPI schema, the Management API reference, the custom log stream
docs, and the post-login event object.

## Question

Can a customer attach a value such as the auththread trace ID to an Auth0 login log event, so
a Log Stream item carries the same trace ID as the browser and the Action?

## Short answer

No customer-supplied metadata is supported on login events. There is no custom field and no
header that `/authorize` echoes into the stream.

There is one customer-supplied correlation field, but it applies only to Management API
operations. The Management API accepts `X-Correlation-ID` on `POST`, `PUT`, `PATCH` and
`DELETE`, up to 64 characters, and shows it as `references.correlation_id` in that operation's
log event. Login events do not go through the Management API.

The login event is not hint-only, though. The log schema and the post-login Action object share
two server-generated identifiers, and one of them looks like an exact join.

## The likely exact join: transaction ID

| Side | Field | Documentation |
| --- | --- | --- |
| Post-login Action | `event.transaction.id` | "Unique identifier for the transaction. Populated for all browser-based login flows." |
| Tenant log event | `details.transaction_id` | "Transaction ID to correlate log events that belong to the same authentication transaction." |

The transaction is per login attempt, which matches one journey per attempt. If the two values
are equal, the Action can emit a salted hash and the stitcher can join the feed event exactly
on tenant plus transaction hash. No `ext-` parameter is involved.

The docs do not state that the values are identical. That needs one real-tenant measurement.

## The second candidate: session ID

| Side | Field | Documentation |
| --- | --- | --- |
| Post-login Action | `event.session.id` | "The ID of the current session." |
| Tenant log event | `details.session_id` | Present in the schema, no description |

A session can span several logins, so a session join is weaker than a transaction join for
one-journey-per-attempt. Use it as a fallback, not the primary key.

## What about Action execution IDs

Login events can include `details.actions.executions[]`, a list of execution IDs. The
Management API get-execution endpoint retrieves one, for 10 days. Its response contains, per
action:

- `action_name`
- `error`
- `started_at`
- `ended_at`

It does not include the Action input event, so it cannot recover `event.request.query.ext_trace_id`.
It is useful for enriching a hook's name, error and duration without our wrapper, but it is not
a correlation path to our trace.

This does revise an older assumption. Action execution IDs are in Log Streams. Full execution
details are one Management API call away. Neither carries the trace ID.

## What about references.trace_id

The schema describes `references.trace_id` as a W3C trace ID (32 hex) for distributed traces.
Nothing documents how it is populated or how to supply one. `traceparent` appears in the
MyAccount API docs, not in the login or log stream docs. The browser cannot send a `traceparent`
header on a top-level redirect. Treat this as Auth0's internal trace until proven otherwise.

## What this means for auththread

`ext-trace_id` remains the only customer-controlled value that survives `/authorize` into the
page and the post-login Action. It still does not appear in the log event.

The feed can become exact without it:

1. On a real tenant, log in once with an Action that records `event.transaction.id`.
2. Capture the streamed event and compare `details.transaction_id`.
3. If equal, add `auth.transaction.hash` (salted, never raw) to the hook span and the feed
   event, and join on it.
4. If they differ, repeat for `event.session.id` and `details.session_id`.
5. If both fail, the tenant's events predate these fields and hints remain.

Until that measurement runs, the hint join stays. It is correct, but it is probabilistic where
an exact join may exist.

## Sources

- Tenant log schema: https://auth0.com/docs/oas/tenant-logs/logs-schema.json
- Management API request correlation: https://auth0.com/docs/api/management/v2
- Get an execution: https://auth0.com/docs/api/management/v2/actions/get-execution
- Custom log streams: https://auth0.com/docs/customize/log-streams/custom-log-streams
- Post-login event object: https://auth0.com/docs/actions/reference/post-login/post-login-event-object
