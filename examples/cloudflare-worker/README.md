# Cloudflare Worker example

```sh
pnpm --filter @auththread/example-cloudflare-worker add -D wrangler
pnpm --filter @auththread/example-cloudflare-worker exec wrangler deploy
```

Set `AUTHTHREAD_TENANTS` as a secret. The value is the same shape as the Node config:

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
event sink, which writes one JSON line per journey to the Worker log.

The Worker resolves the API key through an in-process key directory and forwards the
request to the Durable Object named after that tenant. Routing happens before any object
state is touched, so each tenant's journeys live in their own object. See ADR-0005.
