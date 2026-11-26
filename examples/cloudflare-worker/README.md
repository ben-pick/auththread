# Cloudflare Worker example

```sh
pnpm --filter @auththread/example-cloudflare-worker exec wrangler dev
pnpm --filter @auththread/example-cloudflare-worker exec wrangler deploy
```

Regenerate the checked-in `worker-configuration.d.ts` after changing `wrangler.jsonc`:

```sh
pnpm --filter @auththread/example-cloudflare-worker run types
```

That script runs the project-local Wrangler, generates binding types only, and formats
the result. Runtime platform types come from `@cloudflare/workers-types`, which Wrangler
also uses.

Set `AUTHTHREAD_TENANTS` as a secret with `wrangler secret put AUTHTHREAD_TENANTS`.
The value is the same shape as the Node config:

```json
{
  "tenants": [
    {
      "tenant": "acme",
      "provider": "auth0",
      "apiKey": "at_live_...",
      "salt": "a long per tenant salt",
      "providerSettings": { "feedSecret": "the log stream header" }
    }
  ]
}
```

Set `OTLP_ENDPOINT` to send spans to a collector. Without it, journeys go to the wide
event sink, which writes one JSON line per journey to the Worker log. If the collector
needs auth headers, set `OTLP_HEADERS` as a secret containing a JSON object of strings.

The Worker resolves the API key through an in-process key directory and forwards the
request to the Durable Object named after that tenant. Routing happens before any object
state is touched, so each tenant's journeys live in their own object. See ADR-0005.
