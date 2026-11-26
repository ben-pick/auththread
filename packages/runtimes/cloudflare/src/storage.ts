import {
  hintKeys,
  type JourneyBufferService,
  type JourneyItem,
  type SchedulerService,
  StorageError,
} from "@auththread/adapter-kit";
import { compareStrings, type TraceId } from "@auththread/schema";
import { Clock, Effect, Ref } from "effect";

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

const storageError = (operation: string, cause: unknown): StorageError =>
  new StorageError({ operation, cause });

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

export const createDurableObjectBuffer = (
  storage: DurableObjectStorageLike,
): JourneyBufferService => {
  const deleteTrace = (traceId: TraceId): Effect.Effect<void, StorageError> =>
    Effect.gen(function* () {
      const items = yield* Effect.tryPromise({
        try: () => storage.list<JourneyItem>({ prefix: `j:${traceId}:` }),
        catch: (cause) => storageError("delete", cause),
      });
      for (const key of items.keys())
        yield* Effect.tryPromise({
          try: () => storage.delete(key),
          catch: (cause) => storageError("delete", cause),
        });
      const hints = yield* Effect.tryPromise({
        try: () => storage.list<{ atMs: number }>({ prefix: "h:" }),
        catch: (cause) => storageError("delete", cause),
      });
      for (const key of hints.keys()) {
        if (key.endsWith(`:${traceId}`))
          yield* Effect.tryPromise({
            try: () => storage.delete(key),
            catch: (cause) => storageError("delete", cause),
          });
      }
      const transactions = yield* Effect.tryPromise({
        try: () => storage.list<{ atMs: number }>({ prefix: "x:" }),
        catch: (cause) => storageError("delete", cause),
      });
      for (const key of transactions.keys()) {
        if (key.endsWith(`:${traceId}`))
          yield* Effect.tryPromise({
            try: () => storage.delete(key),
            catch: (cause) => storageError("delete", cause),
          });
      }
    });

  return {
    append: (traceId, item) =>
      Effect.tryPromise({
        try: () => storage.put(itemKey(traceId, item.id), item),
        catch: (cause) => storageError("append", cause),
      }),
    read: (traceId) =>
      Effect.gen(function* () {
        const entries = yield* Effect.tryPromise({
          try: () => storage.list<JourneyItem>({ prefix: `j:${traceId}:` }),
          catch: (cause) => storageError("read", cause),
        });
        return [...entries.values()];
      }),
    delete: deleteTrace,
    indexHints: (traceId, hints, atMs) =>
      Effect.gen(function* () {
        for (const key of hintKeys(hints)) {
          const storageKey = hintKey(key, traceId);
          const existing = yield* Effect.tryPromise({
            try: () => storage.get<{ atMs: number }>(storageKey),
            catch: (cause) => storageError("indexHints", cause),
          });
          yield* Effect.tryPromise({
            try: () =>
              storage.put(storageKey, {
                atMs: Math.max(existing?.atMs ?? 0, atMs),
              }),
            catch: (cause) => storageError("indexHints", cause),
          });
        }
        if (hints.transactionId !== undefined) {
          const storageKey = transactionKey(
            hints.tenant ?? "",
            hints.transactionId,
            traceId,
          );
          const existing = yield* Effect.tryPromise({
            try: () => storage.get<{ atMs: number }>(storageKey),
            catch: (cause) => storageError("indexHints", cause),
          });
          yield* Effect.tryPromise({
            try: () =>
              storage.put(storageKey, {
                atMs: Math.max(existing?.atMs ?? 0, atMs),
              }),
            catch: (cause) => storageError("indexHints", cause),
          });
        }
      }),
    findByTransaction: (tenant, transactionId, windowMs, nowMs) =>
      Effect.gen(function* () {
        const prefix = `x:${tenant}:${transactionId}:`;
        const entries = yield* Effect.tryPromise({
          try: () => storage.list<{ atMs: number }>({ prefix }),
          catch: (cause) => storageError("findByTransaction", cause),
        });

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
      }),
    findCandidates: (hints, windowMs, nowMs) =>
      Effect.gen(function* () {
        const keys = hintKeys(hints);
        if (keys.length === 0) return [];

        let candidates: Set<TraceId> | null = null;
        for (const key of keys) {
          const entries = yield* Effect.tryPromise({
            try: () => storage.list<{ atMs: number }>({ prefix: `h:${key}:` }),
            catch: (cause) => storageError("findCandidates", cause),
          });
          const matching = new Set<TraceId>();
          for (const [entryKey, entry] of entries) {
            if (Math.abs(nowMs - entry.atMs) > windowMs) continue;
            matching.add(
              entryKey.slice(entryKey.lastIndexOf(":") + 1) as TraceId,
            );
          }
          if (candidates === null) {
            candidates = matching;
          } else {
            const next = new Set<TraceId>();
            for (const traceId of candidates) {
              if (matching.has(traceId)) next.add(traceId);
            }
            candidates = next;
          }
          if (candidates.size === 0) return [];
        }

        return [...(candidates ?? new Set<TraceId>())].sort(compareStrings);
      }),
    prune: (beforeMs) =>
      Effect.gen(function* () {
        const items = yield* Effect.tryPromise({
          try: () => storage.list<JourneyItem>({ prefix: "j:" }),
          catch: (cause) => storageError("prune", cause),
        });
        const newest = new Map<TraceId, number>();
        for (const [key, item] of items) {
          const traceId = traceOfItemKey(key);
          if (traceId === null) continue;
          newest.set(traceId, Math.max(newest.get(traceId) ?? 0, item.atMs));
        }
        let dropped = 0;
        for (const [traceId, atMs] of newest) {
          if (atMs >= beforeMs) continue;
          yield* deleteTrace(traceId);
          dropped += 1;
        }
        return dropped;
      }),
  };
};

export type AlarmScheduler = SchedulerService & {
  readonly alarm: Effect.Effect<void, StorageError>;
};

/**
 * One alarm per object, fired at the earliest deadline. Every schedule recomputes
 * the minimum, so a quiet period extends cleanly when a late span arrives.
 */
export const createAlarmScheduler = (
  storage: DurableObjectStorageLike,
  clock: Effect.Effect<number> = Clock.currentTimeMillis,
): AlarmScheduler => {
  const handlers = Ref.makeUnsafe(
    new Set<
      (traceId: TraceId, nowMs: number) => Effect.Effect<void, StorageError>
    >(),
  );

  const deadlines = (): Effect.Effect<
    Map<string, { atMs: number }>,
    StorageError
  > =>
    Effect.tryPromise({
      try: () => storage.list<{ atMs: number }>({ prefix: "a:" }),
      catch: (cause) => storageError("alarm", cause),
    });

  const align = (): Effect.Effect<void, StorageError> =>
    Effect.gen(function* () {
      const entries = yield* deadlines();
      let earliest: number | null = null;
      for (const entry of entries.values()) {
        if (earliest === null || entry.atMs < earliest) earliest = entry.atMs;
      }
      yield* Effect.tryPromise({
        try: () =>
          earliest === null
            ? storage.deleteAlarm()
            : storage.setAlarm(earliest),
        catch: (cause) => storageError("alarm", cause),
      });
    });

  const due = (nowMs: number): Effect.Effect<TraceId[], StorageError> =>
    Effect.gen(function* () {
      const entries = yield* deadlines();
      return [...entries.entries()]
        .filter(([, entry]) => entry.atMs <= nowMs)
        .sort(([, a], [, b]) => a.atMs - b.atMs)
        .map(([key]) => key.slice(2) as TraceId);
    });

  const runDue = (nowMs: number): Effect.Effect<void, StorageError> =>
    Effect.gen(function* () {
      for (const traceId of yield* due(nowMs)) {
        yield* Effect.tryPromise({
          try: () => storage.delete(alarmKey(traceId)),
          catch: (cause) => storageError("alarm", cause),
        });
        for (const handler of yield* Ref.get(handlers)) {
          yield* handler(traceId, nowMs);
        }
      }
      yield* align();
    });

  return {
    schedule: (traceId, atMs) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => storage.put(alarmKey(traceId), { atMs }),
          catch: (cause) => storageError("schedule", cause),
        });
        yield* align();
      }),
    cancel: (traceId) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => storage.delete(alarmKey(traceId)),
          catch: (cause) => storageError("cancel", cause),
        });
        yield* align();
      }),
    onDue: (handler) =>
      Effect.acquireRelease(
        Ref.update(handlers, (current) => new Set([...current, handler])),
        () =>
          Ref.update(handlers, (current) => {
            const next = new Set(current);
            next.delete(handler);
            return next;
          }),
      ),
    runDue,
    alarm: Effect.gen(function* () {
      const nowMs = yield* clock;
      yield* runDue(nowMs);
    }),
  };
};

export type { JourneyBufferService, SchedulerService };
