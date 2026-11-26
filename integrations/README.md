# Dashboards

`grafana/auththread-journeys.json` imports into Grafana and reads the wide event from Loki.
Pick your Loki data source in the dashboard variable. The same panels work for every
provider because they only use neutral fields: `outcome`, `provider`, `tenant`,
`durationMs`.

Queries behind the panels:

```logql
# every outcome over time
sum by (outcome) (count_over_time({service_name="auththread"} | json [5m]))

# one failed journey, readable
{service_name="auththread"} | json | outcome="failed" | line_format "{{.traceId}} {{.provider}} {{.tenant}}"

# slowest journeys
topk(10, avg_over_time({service_name="auththread"} | json | unwrap durationMs [5m]) by (tenant))
```

The Tempo equivalent for a single journey is a TraceQL query on the root span:

```
{ name = "auth.journey" && span.auth.outcome = "denied" }
```

Datadog needs its own export format. Until the native sink exists, send OTLP to the Datadog
Agent or Collector and build the same five panels on `auth.*` attributes.
