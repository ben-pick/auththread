# Local Docker Compose demo

This is a local development topology: the auththread server, a local
OpenTelemetry collector, Grafana, Tempo and Loki. It is not a production
deployment contract.

```sh
cp config.example.json config.json
# edit config.json with your tenant key and salt
cp .env.example .env
docker compose up -d
```

The server is at http://localhost:8787. `GET /healthz` returns 200. The demo
Grafana is at http://localhost:3000.

`config.json` is mounted read-only. The SQLite database lives in the
`auththread-data` volume, so in-flight journeys survive a restart. For production, run the image directly
and point `OTLP_ENDPOINT` at your own collector; do not treat this compose file
as a supported deployment matrix.

Pin `AUTHTHREAD_IMAGE` to a tag or digest even locally. The image is multi-arch
and runs on amd64 and arm64. Do not run multiple replicas against one SQLite
volume; use one writer until the Redis/Postgres buffer lands.
