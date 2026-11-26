# Deployment templates

Templates are standalone and install published `@auththread/*` versions. They
are not part of the pnpm workspace, so they cannot accidentally depend on
unpublished source.

- `cloudflare-worker`: Worker + Durable Object template for `wrangler deploy`
  and the Deploy to Cloudflare button.
