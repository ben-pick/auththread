# Node and Docker example

> The canonical image entrypoint is now [`apps/server`](../../apps/server). The root
> [`Dockerfile`](../../Dockerfile) builds and bundles it. This example remains a lower-level
> composition demo using `createNodeServer`.

Build from the repository root:

```sh
docker build -f examples/node-docker/Dockerfile -t auththread .
```

Run with a config file mounted from a secret store, never from the image. Set
`AUTHTHREAD_DB` to a path on a persistent volume so in-flight journeys survive a restart:

```sh
docker run -p 8787:8787 \
  -e AUTHTHREAD_CONFIG=/etc/auththread/config.json \
  -e AUTHTHREAD_DB=/var/lib/auththread/state.db \
  -e OTLP_ENDPOINT=http://collector:4318/v1/traces \
  -v "$PWD/config.json:/etc/auththread/config.json:ro" \
  -v auththread-data:/var/lib/auththread \
  auththread
```

Without `AUTHTHREAD_DB` the runtime buffers in memory and loses anything in flight when the
process stops. With it, SQLite in WAL mode stores items, hints, transactions and finalise
deadlines. On startup the store rebuilds missing deadlines from the last item, so a journey
that was waiting when the process died finalises on the next poll.

The image is multi-arch. The same image runs on ECS, Cloud Run, Container Apps, Fly or a
plain VM. Point the browser SDK and provider feeds at the public URL. A single volume is one
writer: run one replica per database until the Redis buffer lands.

Configuration is validated at startup. A tenant needs `salt` and either `apiKey` or
`apiKeyHash`. An empty key is rejected. The raw key is hashed in memory and never stored.

For local testing, set `AUTHTHREAD_QUIET_MS=1000` so a journey finalises a second after the
last item instead of ten minutes.
