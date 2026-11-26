# Deployment artifacts

The server is distributed as a library, an OCI image and a Worker template.
The image and templates are thin; the SDK owns the behavior.

## Docker

```sh
docker build -t auththread .
docker run -p 8787:8787 \
  -e AUTHTHREAD_CONFIG=/etc/auththread/config.json \
  -e AUTHTHREAD_DB=/var/lib/auththread/state.db \
  -v "$PWD/config.json:/etc/auththread/config.json:ro" \
  -v auththread-data:/var/lib/auththread \
  auththread
```

The image is multi-stage, runs as a non-root user, and contains one bundled ESM
entrypoint. It does not need `node_modules` at runtime. Publish it to GHCR by
tag and deploy by digest. `.github/workflows/container.yml` builds and pushes
multi-arch images on `v*` tags or manual dispatch, with SBOM, provenance and a
cosign signature.

## Local compose

`examples/local-compose` runs the server, Grafana, Tempo, Loki and an
OpenTelemetry collector for local development. See its README and `versions.md`.
It is a demo topology, not a production deployment contract.

## Cloudflare

`templates/cloudflare-worker` is a standalone Worker template. It uses
`@auththread/sdk/cloudflare`, exports `JourneyDurableObject`, and declares the
`JOURNEY` binding plus `AUTHTHREAD_TENANTS`. Use the Deploy to Cloudflare button
or `wrangler deploy`.

Terraform is not the first Cloudflare path: the Cloudflare provider does not
bundle a Worker, and Durable Object lifecycle changes have a two-step apply
problem. Use Wrangler or a Pulumi/SST component that bundles; use Terraform for
surrounding resources.

## Future IaC

Terraform and Pulumi packages should consume the image and this install
contract, not import `packages/*` source. Public Terraform modules must live in
`terraform-<provider>-<name>` repositories; Pulumi packages in `pulumi-<name>`.
Add them only when a named user needs them.
