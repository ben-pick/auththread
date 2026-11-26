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

The Worker routes a request to the Durable Object named by `?tenant=`. See ADR-0005 for why
v0.1 uses one object per tenant rather than one per journey.
