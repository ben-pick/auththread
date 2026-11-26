---
id: "0009"
title: "The Node runtime persists in-flight journeys in SQLite"
scope:
  - "packages/runtimes/node/**"
  - "examples/node-docker/**"
  - "examples/keycloak-compose/**"
---

# 0009. The Node runtime persists in-flight journeys in SQLite

## Outcome

- `createSQLiteStore` implements `JourneyBuffer` and `NodeScheduler` on top of the built-in
  `node:sqlite` `DatabaseSync`. No dependency is added.
- The store opens with `journal_mode = WAL`, `synchronous = NORMAL` and `busy_timeout = 5000`.
- Items, hints, transactions, finalise deadlines and trace owners live in five tables. Every
  append is one `BEGIN IMMEDIATE` transaction, so an item and its index cannot diverge.
- `AUTHTHREAD_DB` enables the store in the Node example. Without it the runtime keeps the
  memory buffer.
- Startup rebuilds any missing or stale deadline from `MAX(items.at_ms) + quietMs`. A crash
  between append and schedule therefore recovers on the next start.
- `createNodeServer` accepts a buffer and scheduler, drains in-flight journeys on `close()`,
  then flushes sinks. `close()` is ordered: stop accepting, drain, flush, close the database.

## Rules

- SQLite is the single-node durable store. One database has one writer process. Run one
  replica per file until the Redis buffer exists.
- Redis or Valkey is the multi-replica buffer. Postgres is for settings and multi-instance
  coordination, not for the journey buffer.
- A trace has one owning tenant. The stitcher and the store both reject an append from
  another tenant, because a trace ID can leak through a URL, a log or a referrer.
- The buffer uses prepared statements and explicit SQL, not an ORM. The schema is five tables
  and the payload is opaque JSON. Drizzle is reserved for the settings layer, where the
  relations and schema churn are.
- A schema change needs a migration before it ships. `CREATE TABLE IF NOT EXISTS` creates the
  first schema; it does not alter an existing one. Use numbered SQL with `PRAGMA user_version`
  until the settings layer justifies a migration tool.
- No PII in the database. Rows hold redacted items; the tenant salt is what makes hashes
  stable.

## Why

The memory buffer lost every in-flight journey when the process stopped, which is the normal
case for a rolling deploy. SQLite is in the Node standard library, survives restarts, and
needs no extra container. WAL keeps readers and the single writer from blocking each other,
and `NORMAL` sync is the right trade for telemetry that is already fire and forget.

The alternative was `better-sqlite3` with Drizzle. That adds a native module to the image and
puts a query builder on the hot path, for a schema an ORM cannot type past `payload TEXT`.
The real gap was recovery, not query ergonomics, so the store stays small and explicit.

## Deferred

- Redis or Valkey buffer for more than one replica.
- Postgres settings, API key rotation and config history, with Drizzle.
- Numbered migrations for the SQLite schema.
- Pruning by age is implemented on the buffer, but no runtime calls it on a timer yet.
