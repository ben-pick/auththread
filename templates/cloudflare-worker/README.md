# Cloudflare Worker template

A thin Worker shell around `@auththread/sdk/cloudflare`. The SDK owns the
stitcher, the Durable Object and the routing; this template owns configuration
and deployment.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ben-pick/auththread/tree/main/templates/cloudflare-worker)

## Local development

```sh
cp .dev.vars.example .dev.vars
# edit .dev.vars
npm install
npx wrangler dev
```

## Deploy

```sh
npx wrangler secret put AUTHTHREAD_TENANTS
npx wrangler deploy
```

The Durable Object binding is `JOURNEY`; the class is `JourneyDurableObject`.
Each tenant gets one object named after the tenant. `AUTHTHREAD_TENANTS` is a
secret and has the same shape as the Node config:

```json
{
  "tenants": [
    {
      "tenant": "demo",
      "provider": "oidc",
      "apiKey": "at_replace_me",
      "salt": "replace-with-a-long-random-salt"
    }
  ]
}
```

Use a custom domain if you later add the Auth0 Universal Login page snippet.
The Worker surface is `/v1/spans`, `/v1/compact-spans`, `/v1/events` and
`/v1/providers/<provider>/...`.

Do not use a monorepo root for the Deploy button: Cloudflare requires the
target subdirectory to be self-contained. This template is.
