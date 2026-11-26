# auththread server

The canonical bundled server entrypoint. It composes the Node runtime, the
shared config parser, OTLP/wide-event/webhook/object-store sinks, and the
environment contract in [`docs/install-contract.md`](../../docs/install-contract.md).

The root [`Dockerfile`](../../Dockerfile) builds this with esbuild into a single
ESM file, so the runtime image needs no `node_modules`.

```sh
pnpm --filter @auththread/server bundle
node apps/server/dist/server.mjs
```
