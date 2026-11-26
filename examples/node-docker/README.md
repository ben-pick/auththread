# Node and Docker example

Build from the repository root:

```sh
docker build -f examples/node-docker/Dockerfile -t auththread .
```

Run with a config file mounted from a secret store, never from the image:

```sh
docker run -p 8787:8787 \
  -e AUTHTHREAD_CONFIG=/etc/auththread/config.json \
  -e OTLP_ENDPOINT=http://collector:4318/v1/traces \
  -v "$PWD/config.json:/etc/auththread/config.json:ro" \
  auththread
```

The image is multi-arch. The same image runs on ECS, Cloud Run, Container Apps, Fly or a
plain VM. Point the browser SDK and provider feeds at the public URL.

Configuration is validated at startup. A tenant needs `salt` and either `apiKey` or
`apiKeyHash`. The raw key is hashed in memory and never stored.
