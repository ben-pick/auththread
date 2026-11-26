# Install contract

Every deployment artifact targets the same server contract. If a platform cannot
provide one of these, it needs an adapter rather than a new server.

## HTTP surface

The server exposes `fetch(Request): Promise<Response>`.

| Route | Method | Purpose |
| --- | --- | --- |
| `/healthz` | GET | Liveness and readiness. Returns `{ "ok": true }`. |
| `/v1/spans` | POST | OTLP/HTTP JSON spans. |
| `/v1/compact-spans` | POST | The browser SDK's compact span array. |
| `/v1/events` | POST | A provider event or `{ events: [] }` batch. |
| `/v1/providers/<provider>/<feed path>` | POST | A verified provider feed. |

Authentication is `Authorization: Bearer <tenant key>` or
`X-Auththread-Key: <tenant key>`. CORS is permissive for the browser SDK; the
key is write-only.

## Configuration

`AUTHTHREAD_CONFIG` is either a path to a JSON file or the JSON document itself.
The schema is shared by every runtime:

```json
{
  "tenants": [
    {
      "tenant": "acme",
      "provider": "auth0",
      "apiKey": "at_live_...",
      "salt": "a long random tenant salt",
      "providerSettings": {}
    }
  ],
  "quietMs": 600000,
  "correlationWindowMs": 120000,
  "ttlMs": 7200000
}
```

A tenant needs `apiKey` or `apiKeyHash` (64 lowercase hex characters), and a
`salt` of at least 8 characters. The raw key is hashed in memory and never
stored. Use `apiKeyHash` when the platform can compute the hash before deploy.

## Environment

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `AUTHTHREAD_CONFIG` | yes | `/etc/auththread/config.json` | Config path or inline JSON. |
| `AUTHTHREAD_DB` | no | memory | SQLite path. Set it for restart recovery. |
| `AUTHTHREAD_QUIET_MS` | no | `600000` | Finalise a journey after this quiet period. |
| `AUTHTHREAD_CORRELATION_WINDOW_MS` | no | `120000` | Hint/transaction join window. |
| `AUTHTHREAD_TTL_MS` | no | `7200000` | Prune items older than this. |
| `AUTHTHREAD_SAMPLE_SUCCESS` | no | `0.1` | Share of successful journeys kept. |
| `PORT` | no | `8787` | HTTP port. |
| `OTLP_ENDPOINT` | no | unset | OTLP/HTTP traces endpoint. |
| `OTLP_HEADERS` | no | `{}` | JSON headers for OTLP. |
| `OTEL_SERVICE_NAME` | no | `auththread` | OTLP service name. |
| `WEBHOOK_URL` | no | unset | Signed journey webhook. |
| `WEBHOOK_SECRET` | with webhook | unset | HMAC secret. |
| `AUTHTHREAD_S3_ENDPOINT` | no | unset | S3/R2/MinIO endpoint. Enables the object-store sink when all S3 values are set. |
| `AUTHTHREAD_S3_REGION` | with S3 | unset | S3 region, or `auto` for R2. |
| `AUTHTHREAD_S3_BUCKET` | with S3 | unset | Bucket name. |
| `AUTHTHREAD_S3_ACCESS_KEY_ID` | with S3 | unset | Access key. |
| `AUTHTHREAD_S3_SECRET_ACCESS_KEY` | with S3 | unset | Secret key. |
| `AUTHTHREAD_S3_FORCE_PATH_STYLE` | no | unset | `true` for MinIO and many R2 setups. |
| `AUTHTHREAD_S3_PREFIX` | no | `auththread` | Object key prefix. |

Cloudflare uses the same tenant JSON in the `AUTHTHREAD_TENANTS` secret, plus
the `JOURNEY` Durable Object binding.

## Storage and lifecycle

- SQLite is the durable Node store. One writer per database until a shared
  Redis/Postgres buffer exists.
- The Cloudflare runtime uses one Durable Object per tenant, with SQLite-backed
  Durable Object storage and alarms.
- On shutdown, the Node runtime drains in-flight journeys, flushes sinks, and
  closes the store.
- In-memory buffers are for development and single-process demos only.

## Signals

The wide-event sink writes one JSON line per journey to stdout. OTLP writes
spans to any OTLP/HTTP endpoint. Both use the neutral `auth.*` attributes and
the redaction rules in `@auththread/schema`.
