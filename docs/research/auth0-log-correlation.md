# Auth0 log correlation research

Date: 26 November 2026. Sources: the Auth0 tenant log OpenAPI schema, custom log stream
docs, and the post-login event object docs.

## Question

Can a customer attach a value such as the auththread trace ID to an Auth0 tenant log event,
so a Log Stream item carries the same trace ID as the browser and the Action?

## Short answer

No customer-supplied metadata is supported. There is no custom field, no extra parameter and
no header that Auth0 echoes into the stream. `ext-trace_id` is readable from the page template
and `event.request.query` in a post-login Action, but it is not part of the log event.

However, the published log schema now carries correlation fields that the plan did not assume.
The feed is not necessarily hint-only.

## What the schema carries

From https://auth0.com/docs/oas/tenant-logs/logs-schema.json, schema `s` (successful login):

| Field | Meaning | Customer controlled |
| --- | --- | --- |
| `references.trace_id` | W3C trace ID, 32 hex, for distributed traces | No documented mechanism |
| `references.request_id` | Per-request identifier from the originating service | No |
| `references.correlation_id` | Correlation ID across services | No |
| `details.transaction_id` | Correlates log events in one authentication transaction | No |
| `details.session_id` | Session identifier | No |
| `details.actions.executions[]` | Action execution IDs, retrievable through the Management API | No |

The same references object appears on every event type. `references` is optional on `s`.

## What this means

- `references.trace_id` is not ours unless Auth0 propagates an inbound W3C trace context. The
  browser cannot set `traceparent` on a top-level redirect. A backend using PAR might be able
  to, but nothing in the docs says Auth0 honours it. Treat this as Auth0's trace, not the
  journey's.
- `details.session_id` is promising. Post-login Actions have `event.session.id`. If the two
  values match, the Action can emit a salted hash of the session ID and the stitcher can join
  the log event exactly, with no `ext-` parameter involved.
- `details.actions.executions[]` is also promising. The Management API get-execution endpoint
  retrieves execution details by ID. If those details include the Action's input event, they
  contain `request.query.ext_trace_id`, which is an exact join at the cost of one Management
  API call per event. This also revises the earlier assumption that Action execution details
  are absent from Log Streams. The IDs are present. The details need a fetch.
- `details.transaction_id` has no matching field in the documented post-login event object.
  `event.transaction.linking_id` exists only for decoupled authorization flows, so it is not a
  general join key.

## Experiment before changing the adapter

On a real tenant, run one successful login and one failed login and capture both sides:

1. Log `event.session.id` in the post-login Action.
2. Capture the streamed log event and read `details.session_id` and
   `details.actions.executions`.
3. Compare the session values. If they match, add `auth.session.hash` (salted, never raw) and
   join on it. That replaces most hint joins for Auth0.
4. If they do not match, call the Management API get-execution endpoint for one execution ID
   and check whether the Action input, including `request.query.ext_trace_id`, is present.

Until that experiment runs, the hint join stays. It is correct, but it joins on user hash and
tenant, and the session path may be exact.

## Sources

- Tenant log schema: https://auth0.com/docs/oas/tenant-logs/logs-schema.json
- Custom log streams: https://auth0.com/docs/customize/log-streams/custom-log-streams
- Post-login event object: https://auth0.com/docs/actions/reference/post-login/post-login-event-object
- Sessions with Actions: https://auth0.com/docs/manage-users/sessions/manage-sessions-actions
