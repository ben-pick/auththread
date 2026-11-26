# Dogfood auththread with a real Auth0 tenant

This is the first end-to-end path: a real browser login, a real Auth0 Log
Stream and a real Auth0 Action, all landing in one auththread journey.

Start with L1 + L2. Add the Action (L3) once the browser and feed are working.
The Universal Login page snippet (L4) needs a custom domain and can wait.

## Prerequisites

- The `@auththread/*` packages are published at `0.1.0`.
- Node 24 and pnpm 12 through mise, or Docker.
- Auth0 tenant with the application you want to trace.
- Auth0 **Actions** enabled for L3.
- Auth0 **Log Streams** enabled for L2. This may require a paid plan.
- A public HTTPS URL for the local server: Cloudflare Tunnel, ngrok, or a
  deployed host. Auth0 cannot call `localhost`.
- Auth0 custom domain only for the page snippet (L4).

## 1. Generate the server config and start it

The repository includes the setup script:

```sh
./scripts/dogfood-auth0.sh
```

It prompts for your Auth0 tenant domain and generates a tenant key, salt and
Log Stream feed secret. It writes them, mode 600, to:

```text
~/.auththread/dogfood.json
~/.auththread/dogfood.env
```

It prints the tenant key and feed secret to copy into Auth0. The salt stays
server-side. Re-running the script reuses the existing config.

To only generate the config, without starting the server:

```sh
./scripts/dogfood-auth0.sh --config-only
```

The generated config has the same shape as:

```json
{
  "tenants": [
    {
      "tenant": "dogfood",
      "provider": "auth0",
      "apiKey": "PASTE_TENANT_KEY",
      "salt": "PASTE_TENANT_SALT",
      "providerSettings": {
        "feedSecret": "PASTE_FEED_SECRET",
        "domain": "YOUR_TENANT.eu.auth0.com"
      }
    }
  ]
}
```

The server reads that file because the script sets:

```sh
AUTHTHREAD_CONFIG="$HOME/.auththread/dogfood.json"
AUTHTHREAD_DB="$HOME/.auththread/state.db"
```

To run the Docker image instead:

```sh
docker build -t auththread:dogfood .
docker run --rm -p 8787:8787 \
  -v "$HOME/.auththread/dogfood.json:/etc/auththread/config.json:ro" \
  -v "$HOME/.auththread:/var/lib/auththread" \
  -e AUTHTHREAD_DB=/var/lib/auththread/state.db \
  -e AUTHTHREAD_QUIET_MS=10000 \
  -e AUTHTHREAD_SAMPLE_SUCCESS=1 \
  auththread:dogfood
```

Start a tunnel in another terminal:

```sh
cloudflared tunnel --url http://localhost:8787
# or: ngrok http 8787
```

Use the resulting `https://...` URL as `YOUR_TUNNEL` below.

Without `OTLP_ENDPOINT`, the server writes one wide event per journey to
stdout. Set `OTLP_ENDPOINT` to send spans to your collector.

## 3. Add the Auth0 Log Stream

Auth0 Dashboard → **Monitoring → Log Streams → Create Log Stream → Custom
Webhook** (naming varies by tenant).

- Endpoint: `https://YOUR_TUNNEL/v1/providers/auth0/log-stream`
- **Authorization Token**: `Bearer PASTE_FEED_SECRET`
- Content Type: `application/json`

Auth0 calls this field “Authorization Token”; the feed accepts either the
`Authorization: Bearer <feedSecret>` value or the older
`x-auththread-feed-secret` header.

Trigger a login, then check the server log for a `provider event` step. Log
Stream delivery can lag by a few seconds.

## 4. Add the browser SDK

Install the published packages:

```sh
pnpm add @auththread/browser@0.1.0 @auththread/auth0@0.1.0
```

With `auth0-spa-js`:

```ts
import { init } from "@auththread/browser";
import { auth0 } from "@auththread/auth0/browser";
import { createAuth0Client } from "@auth0/auth0-spa-js";

const thread = init({
  endpoint: "https://YOUR_TUNNEL",
  key: "PASTE_TENANT_KEY",
  tenant: "dogfood",
  provider: auth0(),
});

const client = await createAuth0Client({
  domain: "YOUR_TENANT.eu.auth0.com",
  clientId: "YOUR_CLIENT_ID",
  cacheLocation: "localstorage",
  useRefreshTokens: true,
});

await client.loginWithRedirect({
  authorizationParams: {
    ...thread.authorizeParams(),
    redirect_uri: window.location.origin + "/callback",
  },
});

// On the callback route:
try {
  await client.handleRedirectCallback();
  thread.callback(window.location);
} catch {
  thread.abandon("identifier");
}
```

Use the same `endpoint`, `key` and `tenant` in the Action and Log Stream.

## 5. Add the Auth0 Action (L3)

Add the dependency in **Actions → Library → your Login Action → Modules**:

```text
@auththread/auth0-actions  0.1.0
```

Add an Action secret `AUTHTHREAD_KEY` containing the same tenant key.

Auth0 Actions expose secrets only on `event.secrets`, so create the wrapper
inside the handler:

```js
const { withTrace } = require("@auththread/auth0-actions");

exports.onExecutePostLogin = async (event, api) => {
  const traced = withTrace(
    {
      name: "auththread-dogfood",
      version: "1",
      transport: "http",
      endpoint: "https://YOUR_TUNNEL",
      token: event.secrets.AUTHTHREAD_KEY,
      // Local tunnels can add latency; keep 250 ms in production.
      // timeoutMs: 750,
    },
    async (event, api) => {
      // your existing Action body
    },
  );

  return traced(event, api);
};
```

The HTTP transport has a 250 ms hard timeout and never throws from the tracing
path. A failed stitcher must not fail the login.

## 6. Verify one journey

1. Start a login and complete it.
2. Check the server stdout for one wide event with:
   - `auth.app.login_start`
   - `auth.ui.screen` only if the page snippet is installed
   - `auth.hook.execute` from the Action
   - `auth.app.callback`
   - `auth.provider.event` from the Log Stream
3. Confirm the outcome is `success` or `denied` as expected.
4. Try one wrong-password login and confirm a `failed` journey.
5. Confirm no raw user identifier or email appears in the output.

## Debugging checklist

- **No hook span:** the Action did not reach the server. Check the Auth0 Action
  logs, the tunnel URL, the `AUTHTHREAD_KEY` secret, and the 250 ms timeout.
- **No provider event:** check the Log Stream endpoint and the
  `x-auththread-feed-secret` header. Auth0 may retry or delay delivery.
- **No browser spans:** check the endpoint, tenant key, CORS, and that
  `authorizeParams()` was spread into `loginWithRedirect`.
- **Different trace IDs:** the `ext-trace_id` authorize parameter may be
  stripped, or the callback did not run `thread.callback`. Check the browser
  network request body and the Auth0 Action event.
- **Page snippet does nothing:** it requires a custom domain; skip L4 until
  that is enabled.
