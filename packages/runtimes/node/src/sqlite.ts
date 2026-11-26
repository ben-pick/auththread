import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  hintKeys,
  type JourneyBuffer,
  type JourneyItem,
} from "@auththread/adapter-kit";
import type { CorrelationHints, TraceId } from "@auththread/schema";
import type { NodeScheduler } from "./scheduler.ts";

export interface SQLiteStoreOptions {
  /** File path, or ":memory:" for tests. */
  readonly path: string;
  /** Quiet period used when recovering deadlines for buffered items. */
  readonly quietMs?: number;
  readonly pollIntervalMs?: number;
  /** Start the deadline poller. Tests can disable it and call runDue. */
  readonly autoStart?: boolean;
  readonly onError?: (error: unknown) => void;
}

export interface SQLiteStore {
  readonly buffer: JourneyBuffer;
  readonly scheduler: NodeScheduler;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  trace_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (trace_id, item_id)
);
CREATE INDEX IF NOT EXISTS items_trace_at ON items(trace_id, at_ms);

CREATE TABLE IF NOT EXISTS hints (
  hint_key TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  PRIMARY KEY (hint_key, trace_id)
);
CREATE INDEX IF NOT EXISTS hints_key_at ON hints(hint_key, at_ms);

CREATE TABLE IF NOT EXISTS transactions (
  tenant TEXT NOT NULL,
  tx TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant, tx)
);

CREATE TABLE IF NOT EXISTS deadlines (
  trace_id TEXT PRIMARY KEY,
  at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS deadlines_at ON deadlines(at_ms);

CREATE TABLE IF NOT EXISTS trace_owners (
  trace_id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL
);
`;

const tenantOf = (item: JourneyItem): string | undefined => {
  if (item.kind === "span") {
    const value = item.span.attributes["auth.tenant"];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }
  return item.event.tenant.length > 0 ? item.event.tenant : undefined;
};

const hintsOf = (item: JourneyItem, tenant: string): CorrelationHints => {
  if (item.kind === "span") {
    const attributes = item.span.attributes;
    return {
      tenant,
      ...(typeof attributes["auth.user.hash"] === "string"
        ? { userHash: attributes["auth.user.hash"] }
        : {}),
      ...(typeof attributes["auth.client_id"] === "string"
        ? { clientId: attributes["auth.client_id"] }
        : {}),
      ...(typeof attributes["auth.transaction.id"] === "string"
        ? { transactionId: attributes["auth.transaction.id"] }
        : {}),
    };
  }
  return { ...item.event.hints, tenant };
};

export function createSQLiteStore(options: SQLiteStoreOptions): SQLiteStore {
  if (options.path !== ":memory:") {
    mkdirSync(dirname(options.path), { recursive: true });
  }

  const db = new DatabaseSync(options.path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);

  const quietMs = options.quietMs ?? 10 * 60 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const handlers: Array<(traceId: TraceId) => Promise<void>> = [];

  const transaction = <T>(run: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  const ownerGet = db.prepare(
    "SELECT tenant FROM trace_owners WHERE trace_id = ?",
  );
  const ownerInsert = db.prepare(
    "INSERT INTO trace_owners (trace_id, tenant) VALUES (?, ?)",
  );
  const itemInsert = db.prepare(
    "INSERT OR IGNORE INTO items (trace_id, item_id, at_ms, kind, payload) VALUES (?, ?, ?, ?, ?)",
  );
  const itemRead = db.prepare(
    "SELECT payload FROM items WHERE trace_id = ? ORDER BY at_ms, item_id",
  );
  const itemDelete = db.prepare("DELETE FROM items WHERE trace_id = ?");
  const hintInsert = db.prepare(
    `INSERT INTO hints (hint_key, trace_id, at_ms) VALUES (?, ?, ?)
     ON CONFLICT(hint_key, trace_id) DO UPDATE SET
       at_ms = CASE WHEN excluded.at_ms > hints.at_ms THEN excluded.at_ms ELSE hints.at_ms END`,
  );
  const hintDelete = db.prepare("DELETE FROM hints WHERE trace_id = ?");
  const transactionInsert = db.prepare(
    `INSERT INTO transactions (tenant, tx, trace_id, at_ms) VALUES (?, ?, ?, ?)
     ON CONFLICT(tenant, tx) DO UPDATE SET
       trace_id = excluded.trace_id,
       at_ms = CASE WHEN excluded.at_ms > transactions.at_ms THEN excluded.at_ms ELSE transactions.at_ms END`,
  );
  const transactionFind = db.prepare(
    "SELECT trace_id FROM transactions WHERE tenant = ? AND tx = ? AND at_ms BETWEEN ? AND ? ORDER BY at_ms DESC LIMIT 1",
  );
  const transactionDelete = db.prepare(
    "DELETE FROM transactions WHERE trace_id = ?",
  );
  const ownerDelete = db.prepare("DELETE FROM trace_owners WHERE trace_id = ?");
  const deadlineSchedule = db.prepare(
    `INSERT INTO deadlines (trace_id, at_ms) VALUES (?, ?)
     ON CONFLICT(trace_id) DO UPDATE SET
       at_ms = CASE WHEN excluded.at_ms > deadlines.at_ms THEN excluded.at_ms ELSE deadlines.at_ms END`,
  );
  const deadlineDue = db.prepare(
    "SELECT trace_id FROM deadlines WHERE at_ms <= ? ORDER BY at_ms",
  );
  const deadlineDelete = db.prepare("DELETE FROM deadlines WHERE trace_id = ?");

  // A crash between append and schedule leaves items without a deadline.
  // Rebuild every missing or stale deadline from the items themselves.
  db.prepare(
    `INSERT INTO deadlines (trace_id, at_ms)
     SELECT trace_id, MAX(at_ms) + ? FROM items WHERE true GROUP BY trace_id
     ON CONFLICT(trace_id) DO UPDATE SET
       at_ms = CASE WHEN excluded.at_ms > deadlines.at_ms THEN excluded.at_ms ELSE deadlines.at_ms END`,
  ).run(quietMs);

  const deleteRows = (traceId: string): void => {
    itemDelete.run(traceId);
    hintDelete.run(traceId);
    transactionDelete.run(traceId);
    deadlineDelete.run(traceId);
    ownerDelete.run(traceId);
  };

  const buffer: JourneyBuffer = {
    async append(traceId, item) {
      const tenant = tenantOf(item);
      const hints = hintsOf(item, tenant ?? "unknown");

      transaction(() => {
        if (tenant !== undefined) {
          const owner = ownerGet.get(traceId) as { tenant: string } | undefined;
          if (owner === undefined) ownerInsert.run(traceId, tenant);
          else if (owner.tenant !== tenant) {
            throw new Error("trace belongs to another tenant");
          }
        }

        itemInsert.run(
          traceId,
          item.id,
          item.atMs,
          item.kind,
          JSON.stringify(item),
        );
        for (const key of hintKeys(hints)) {
          hintInsert.run(key, traceId, item.atMs);
        }
        if (hints.transactionId !== undefined) {
          transactionInsert.run(
            tenant ?? "unknown",
            hints.transactionId,
            traceId,
            item.atMs,
          );
        }
      });
    },

    async read(traceId) {
      return (itemRead.all(traceId) as Array<{ payload: string }>).map(
        (row) => JSON.parse(row.payload) as JourneyItem,
      );
    },

    async delete(traceId) {
      transaction(() => deleteRows(traceId));
    },

    async indexHints(traceId, hints, atMs) {
      transaction(() => {
        for (const key of hintKeys(hints)) hintInsert.run(key, traceId, atMs);
        if (hints.transactionId !== undefined) {
          transactionInsert.run(
            hints.tenant ?? "unknown",
            hints.transactionId,
            traceId,
            atMs,
          );
        }
      });
    },

    async findByTransaction(tenant, transactionId, windowMs, nowMs) {
      const row = transactionFind.get(
        tenant,
        transactionId,
        nowMs - windowMs,
        nowMs + windowMs,
      ) as { trace_id: string } | undefined;
      return (row?.trace_id as TraceId | undefined) ?? null;
    },

    async findCandidates(hints, windowMs, nowMs) {
      const keys = hintKeys(hints);
      if (keys.length === 0) return [];

      const placeholders = keys.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `SELECT trace_id FROM hints
           WHERE hint_key IN (${placeholders}) AND at_ms BETWEEN ? AND ?
           GROUP BY trace_id HAVING COUNT(DISTINCT hint_key) = ?
           ORDER BY trace_id`,
        )
        .all(
          ...keys,
          nowMs - windowMs,
          nowMs + windowMs,
          keys.length,
        ) as Array<{
        trace_id: string;
      }>;
      return rows.map((row) => row.trace_id as TraceId);
    },

    async prune(beforeMs) {
      return transaction(() => {
        const old = db
          .prepare(
            "SELECT trace_id FROM items GROUP BY trace_id HAVING MAX(at_ms) < ?",
          )
          .all(beforeMs) as Array<{ trace_id: string }>;

        for (const row of old) deleteRows(row.trace_id);

        db.prepare("DELETE FROM hints WHERE at_ms < ?").run(beforeMs);
        db.prepare("DELETE FROM transactions WHERE at_ms < ?").run(beforeMs);
        db.prepare("DELETE FROM deadlines WHERE at_ms < ?").run(beforeMs);
        return old.length;
      });
    },
  };

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const runDue = async (nowMs: number): Promise<void> => {
    const due = deadlineDue.all(nowMs) as Array<{ trace_id: string }>;

    for (const row of due) {
      const traceId = row.trace_id as TraceId;
      try {
        for (const handler of handlers) await handler(traceId);
        deadlineDelete.run(traceId);
      } catch (error) {
        // Keeping the deadline retries on the next poll instead of losing the
        // journey because one write failed.
        options.onError?.(error);
      }
    }
  };

  const schedulePoll = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void (async () => {
        if (running) {
          schedulePoll();
          return;
        }
        running = true;
        try {
          await runDue(Date.now());
        } catch (error) {
          options.onError?.(error);
        } finally {
          running = false;
          schedulePoll();
        }
      })();
    }, pollIntervalMs);
    timer.unref?.();
  };

  if (options.autoStart !== false) schedulePoll();

  const scheduler: NodeScheduler = {
    async schedule(traceId, atMs) {
      deadlineSchedule.run(traceId, atMs);
    },
    async cancel(traceId) {
      deadlineDelete.run(traceId);
    },
    onDue(handler) {
      handlers.push(handler);
    },
    runDue,
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };

  let closed = false;
  return {
    buffer,
    scheduler,
    close() {
      if (closed) return;
      closed = true;
      scheduler.stop();
      db.close();
    },
  };
}
