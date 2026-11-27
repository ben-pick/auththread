# Object store sink

One NDJSON object per time partition. One line per finished journey. S3, R2, MinIO or any
S3-compatible endpoint. No SDK.

## Use

```ts
import { createObjectStoreSink, createS3Store } from "@auththread/sink-object-store";

const store = createS3Store({
  endpoint: "https://<account>.r2.cloudflarestorage.com",
  region: "auto",
  bucket: "auththread",
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
});

const sink = createObjectStoreSink({
  store,
  prefix: "auththread",
  maxRows: 1000,
  flushIntervalMs: 60_000,
});
```

For AWS S3 use `endpoint: "https://s3.<region>.amazonaws.com"` and the bucket region. For
MinIO use its endpoint and `forcePathStyle: true` (the default).

Credentials belong in your secret store. The sink holds them only in memory.

## Key layout

```
auththread/dt=2026-11-26/hour=05/batch-9f2c1a4b6d8e0c33.ndjson
```

The batch suffix is a SHA-256 of the object body. A retry writes the same key, so a replay
is idempotent. Rows are sorted by trace ID before hashing and writing, so the same set of
journeys always produces the same object.

The partition uses the journey start time in UTC. Late journeys land in older partitions,
which object stores and ClickHouse handle fine.

## Batching

- Flush at 1000 rows or 5 MB, or every 60 seconds.
- `flush()` is called by the Node runtime on shutdown, and by the Durable Object on each
  alarm. In a Worker that can be evicted before an alarm, prefer OTLP or the webhook, or set
  `maxRows` small enough that each journey flushes.
- A failed put keeps the rows in memory and schedules a retry. The stitcher counts the error
  and the login is unaffected.

## ClickHouse

Query the files directly:

```sql
SELECT
  tenant,
  provider,
  outcome,
  count() AS journeys
FROM s3(
  'https://<account>.r2.cloudflarestorage.com/auththread/auththread/dt=*/hour=*/*.ndjson',
  '<access_key>',
  '<secret_key>',
  'JSONEachRow'
)
GROUP BY tenant, provider, outcome;
```

Or point ClickPipes at the bucket. Either way, one row is one journey, with `steps` as a JSON
array and `attributes` as a JSON object.

For a typed table and query examples, see the ClickHouse design in the repo discussion. The
short version:

```sql
CREATE TABLE auththread.journeys
ENGINE = MergeTree
ORDER BY (tenant, started_at, journey_id)
AS SELECT * FROM s3('...', 'JSONEachRow');
```

## DuckDB

DuckDB reads these files directly. No ingestion, no extension beyond `httpfs`.

```sql
INSTALL httpfs;
LOAD httpfs;

CREATE OR REPLACE SECRET auththread_r2 (
  TYPE S3,
  KEY_ID '<access_key>',
  SECRET '<secret_key>',
  REGION 'auto',
  ENDPOINT '<account>.r2.cloudflarestorage.com',
  URL_STYLE 'path',
  USE_SSL true
);

SELECT
  dt,
  hour,
  attributes->>'auth.method' AS method,
  outcome,
  count(*) AS journeys
FROM read_ndjson(
  's3://auththread/auththread/dt=*/hour=*/*.ndjson',
  hive_partitioning = true,
  columns = {
    schemaVersion: 'VARCHAR',
    event: 'VARCHAR',
    traceId: 'VARCHAR',
    spanId: 'VARCHAR',
    kind: 'VARCHAR',
    outcome: 'VARCHAR',
    provider: 'VARCHAR',
    tenant: 'VARCHAR',
    startedAt: 'TIMESTAMP',
    durationMs: 'BIGINT',
    attributes: 'JSON',
    steps: 'JSON',
    correlationCounts: 'JSON'
  }
)
GROUP BY dt, hour, method, outcome;
```

`attributes->>'auth.method'` is deliberate. `json_extract(attributes, '$.auth.method')`
treats the dot inside `auth.method` as a nested path and returns NULL. The arrow operator, or
`json_extract(attributes, '$."auth.method"')`, reads the dotted key. This was the only
surprise in local testing.

Auto inference also works and turns `attributes` into a struct union across files:

```sql
SELECT traceId, outcome, attributes."auth.method" AS method
FROM read_ndjson('s3://auththread/auththread/dt=*/hour=*/*.ndjson');
```

For `steps`:

```sql
SELECT traceId, step->>'name' AS step, step->>'errorCode' AS error_code
FROM read_ndjson('...', columns = { traceId: 'VARCHAR', steps: 'JSON' }),
UNNEST(json_extract(steps, '$[*]')) AS t(step);
```

Local development works the same way with a path instead of `s3://`.

Verified with DuckDB 1.4.5 against the sink's NDJSON shape, including hive partition columns
(`dt`, `hour`), JSON `attributes`, and `steps`. DuckDB reads whole NDJSON files, so it has no
predicate pushdown until the object format becomes Parquet. The 1000 row / 5 MB batches keep
that reasonable.

## Limits

- NDJSON text only initially. Parquet is a later change, and it will extend the `ObjectStore`
  port to binary bodies.
- No compression on the wire. The objects are small text files; enable bucket compression if
  you need it.
- The sink does not create buckets, lifecycle rules or IAM policies. Do that in
  infrastructure, and set an object lifecycle that matches your retention.
