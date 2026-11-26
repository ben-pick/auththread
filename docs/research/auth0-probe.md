# Auth0 correlation probe

The point of this probe is to answer one question: does the ID in a post-login Action match
the ID in the streamed log event?

Two candidates:

- `event.transaction.id` in the Action, against `details.transaction_id` in the log.
- `event.session.id` in the Action, against `details.session_id` in the log.

The probe prints both sides and a match line.

## 1. Start the probe

```sh
PROBE_SECRET=probe-secret pnpm probe:auth0
```

It listens on `:8788` and prints the stream and Action payloads.

## 2. Expose it

```sh
cloudflared tunnel --url http://localhost:8788
```

Use the printed `https://...trycloudflare.com` URL in the next two steps. `ngrok http 8788`
works the same way.

## 3. Create a Log Stream

Auth0 Dashboard, Monitoring, Streams, Create Stream, Custom Webhook.

- Payload URL: `https://<tunnel>/log-stream`
- Content format: JSON lines
- Authorization Token: `probe-secret`

The probe accepts the secret as `Authorization: <secret>`, `Authorization: Bearer <secret>`,
or `x-probe-secret: <secret>`.

## 4. Create a post-login Action

Actions, Library, Build Custom, Login / Post Login. Paste this, replacing the tunnel URL and
secret:

```js
exports.onExecutePostLogin = async (event, api) => {
  const payload = {
    ext_trace_id:
      (event.request && event.request.query && event.request.query["ext-trace_id"]) ||
      (event.request && event.request.query && event.request.query.ext_trace_id),
    transaction_id: event.transaction && event.transaction.id,
    session_id: event.session && event.session.id,
    client_id: event.client && event.client.client_id,
    user_id: event.user && event.user.user_id,
  };

  try {
    await fetch("https://<tunnel>/action", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-probe-secret": "probe-secret",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    // The probe being down must not fail the login.
  }
};
```

Deploy it and attach it to the Login flow.

## 5. Log in with a known trace ID

Create an SPA or Regular Web App, and a test user on a database connection. Then open:

```
https://<tenant>/authorize?client_id=<client_id>&redirect_uri=http://localhost:3000/callback&response_type=code&scope=openid%20profile&state=probe&ext-trace_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

Log in. The callback page can 404. The event still happens.

## 6. Read the probe output

```
ACTION transaction=... session=... ext_trace=aaaa... client=...
STREAM type=s log=... transaction=... session=... refs_trace=... executions=2
MATCH transaction=yes session=yes ext_trace_in_stream=no refs_trace_equals_ext=no
```

What each line decides:

| Outcome | What to do |
| --- | --- |
| `transaction=yes` | Join Auth0 feeds exactly on a salted transaction hash |
| `transaction=no`, `session=yes` | Join on session, accepting that a session spans logins |
| Both no | Keep the hint join for this tenant |
| `ext_trace_in_stream=yes` | Our trace ID already reaches the feed, so no join key is needed |
| `refs_trace_equals_ext=yes` | Auth0 propagates our W3C trace, the strongest result |

`ext_trace_in_stream` searches the whole raw event, not just `references`, so it catches the
trace if Auth0 puts it anywhere.

## 7. Try a denied Action

Add `api.access.deny("probe", "denied by probe");` to the Action, repeat the login, and compare
the failure event. This tells you whether the failure path keeps the transaction ID.

## 8. Try a wrong password

The post-login Action does not run, so there is no Action payload to match. The log event may
still carry a transaction ID. That is the case where a page snippet, not a hook, has to report
the failure. Record what the event contains.

## 9. Check the execution endpoint

Copy an ID from `details.actions.executions` and fetch it with a Management API token that has
`read:actions`:

```sh
curl -s -H "Authorization: Bearer $MGMT_TOKEN" \
  "https://<tenant>/api/v2/actions/executions/<execution_id>" | jq
```

Expect `action_name`, `error`, `started_at`, `ended_at`. If the input event is also there, the
execution path can recover `ext_trace_id`. If not, it cannot.

## 10. Record the result

Put the four lines in `docs/research/auth0-log-correlation.md` with the tenant date. That
decides whether the Auth0 adapter moves from hints to an exact join.
