import {
  hintKeys,
  type JourneyBuffer,
  type JourneyItem,
  type Scheduler,
} from "@auththread/adapter-kit";
import type { TraceId } from "@auththread/schema";
import { compareStrings } from "@auththread/schema";

/** The subset of Durable Object storage the runtime uses. Tests provide a fake. */
export interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
  setAlarm(atMs: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

export interface DurableObjectStateLike {
  readonly storage: DurableObjectStorageLike;
}

const itemKey = (traceId: TraceId, id: string): string => `j:${traceId}:${id}`;
const hintKey = (key: string, traceId: TraceId): string =>
  `h:${key}:${traceId}`;
const transactionKey = (
  tenant: string,
  transactionId: string,
  traceId: TraceId,
): string => `x:${tenant}:${transactionId}:${traceId}`;
const alarmKey = (traceId: TraceId): string => `a:${traceId}`;

const traceOfItemKey = (key: string): TraceId | null => {
  const parts = key.split(":");
  return parts.length >= 3 ? ((parts[1] ?? null) as TraceId | null) : null;
};

export function createDurableObjectBuffer(
  storage: DurableObjectStorageLike,
): JourneyBuffer {
  const deleteTrace = async (traceId: TraceId): Promise<void> => {
    const items = await storage.list<JourneyItem>({ prefix: `j:${traceId}:` });
    for (const key of items.keys()) await storage.delete(key);
    const hints = await storage.list<{ atMs: number }>({ prefix: "h:" });
    for (const key of hints.keys()) {
      if (key.endsWith(`:${traceId}`)) await storage.delete(key);
    }
    const transactions = await storage.list<{ atMs: number }>({
      prefix: "x:",
    });
    for (const key of transactions.keys()) {
      if (key.endsWith(`:${traceId}`)) await storage.delete(key);
    }
  };

  const buffer: JourneyBuffer = {
    async append(traceId, item) {
      await storage.put(itemKey(traceId, item.id), item);
    },
    async read(traceId) {
      const entries = await storage.list<JourneyItem>({
        prefix: `j:${traceId}:`,
      });
      return [...entries.values()];
    },
    async delete(traceId) {
      await deleteTrace(traceId);
    },
    async indexHints(traceId, hints, atMs) {
      for (const key of hintKeys(hints)) {
        const storageKey = hintKey(key, traceId);
        const existing = await storage.get<{ atMs: number }>(storageKey);
        await storage.put(storageKey, {
          atMs: Math.max(existing?.atMs ?? 0, atMs),
        });
      }
      if (hints.transactionId !== undefined) {
        const storageKey = transactionKey(
          hints.tenant ?? "",
          hints.transactionId,
          traceId,
        );
        const existing = await storage.get<{ atMs: number }>(storageKey);
        await storage.put(storageKey, {
          atMs: Math.max(existing?.atMs ?? 0, atMs),
        });
      }
    },
    async findByTransaction(tenant, transactionId, windowMs, nowMs) {
      const prefix = `x:${tenant}:${transactionId}:`;
      const entries = await storage.list<{ atMs: number }>({ prefix });

      let best: TraceId | null = null;
      let bestAt = -1;
      for (const [key, entry] of entries) {
        if (Math.abs(nowMs - entry.atMs) > windowMs) continue;
        const traceId = key.slice(prefix.length) as TraceId;
        if (
          entry.atMs > bestAt ||
          (entry.atMs === bestAt &&
            (best === null || compareStrings(traceId, best) < 0))
        ) {
          best = traceId;
          bestAt = entry.atMs;
        }
      }
      return best;
    },
    async findCandidates(hints, windowMs, nowMs) {
      const scores = new Map<TraceId, number>();
      for (const key of hintKeys(hints)) {
        const entries = await storage.list<{ atMs: number }>({
          prefix: `h:${key}:`,
        });
        for (const [entryKey, entry] of entries) {
          if (Math.abs(nowMs - entry.atMs) > windowMs) continue;
          const traceId = entryKey.slice(
            entryKey.lastIndexOf(":") + 1,
          ) as TraceId;
          scores.set(traceId, (scores.get(traceId) ?? 0) + 1);
        }
      }
      return [...scores.entries()]
        .sort(
          ([a, scoreA], [b, scoreB]) => scoreB - scoreA || compareStrings(a, b),
        )
        .map(([traceId]) => traceId);
    },
    async prune(beforeMs) {
      const items = await storage.list<JourneyItem>({ prefix: "j:" });
      const newest = new Map<TraceId, number>();
      for (const [key, item] of items) {
        const traceId = traceOfItemKey(key);
        if (traceId === null) continue;
        newest.set(traceId, Math.max(newest.get(traceId) ?? 0, item.atMs));
      }
      let dropped = 0;
      for (const [traceId, atMs] of newest) {
        if (atMs >= beforeMs) continue;
        await deleteTrace(traceId);
        dropped += 1;
      }
      return dropped;
    },
  };

  return buffer;
}

export interface AlarmScheduler extends Scheduler {
  alarm(): Promise<void>;
}

/**
 * One alarm per object, fired at the earliest deadline. Every schedule recomputes
 * the minimum, so a quiet period extends cleanly when a late span arrives.
 */
export function createAlarmScheduler(
  storage: DurableObjectStorageLike,
  clock: () => number = () => Date.now(),
): AlarmScheduler {
  const handlers: Array<(traceId: TraceId) => Promise<void>> = [];

  const align = async (): Promise<void> => {
    const deadlines = await storage.list<{ atMs: number }>({ prefix: "a:" });
    let earliest: number | null = null;
    for (const entry of deadlines.values()) {
      if (earliest === null || entry.atMs < earliest) earliest = entry.atMs;
    }
    if (earliest === null) await storage.deleteAlarm();
    else await storage.setAlarm(earliest);
  };

  const due = async (nowMs: number): Promise<TraceId[]> => {
    const deadlines = await storage.list<{ atMs: number }>({ prefix: "a:" });
    return [...deadlines.entries()]
      .filter(([, entry]) => entry.atMs <= nowMs)
      .sort(([, a], [, b]) => a.atMs - b.atMs)
      .map(([key]) => key.slice(2) as TraceId);
  };

  return {
    async schedule(traceId, atMs) {
      await storage.put(alarmKey(traceId), { atMs });
      await align();
    },
    async cancel(traceId) {
      await storage.delete(alarmKey(traceId));
      await align();
    },
    onDue(handler) {
      handlers.push(handler);
    },
    async runDue(nowMs) {
      for (const traceId of await due(nowMs)) {
        await storage.delete(alarmKey(traceId));
        for (const handler of handlers) await handler(traceId);
      }
      await align();
    },
    async alarm() {
      await this.runDue(clock());
    },
  };
}
