import type { CorrelationHints, Span, TraceId } from "@auththread/schema";
import { compareStrings } from "@auththread/schema";
import { Effect, Layer } from "effect";
import { StorageError } from "./errors.ts";
import {
  JourneyBuffer,
  type JourneyItem,
  Scheduler,
  Secrets,
  SettingsStore,
  type TenantSettings,
} from "./runtime.ts";

export const hintKeys = (hints: CorrelationHints): string[] => {
  const keys: string[] = [];
  if (hints.tenant !== undefined) keys.push(`t:${hints.tenant}`);
  if (hints.userHash !== undefined) keys.push(`u:${hints.userHash}`);
  if (hints.clientId !== undefined) keys.push(`c:${hints.clientId}`);
  if (hints.ipHash !== undefined) keys.push(`i:${hints.ipHash}`);
  if (hints.userAgentHash !== undefined) keys.push(`a:${hints.userAgentHash}`);
  return keys;
};

const newest = (items: Iterable<JourneyItem>): number => {
  let latest = 0;
  for (const item of items) latest = Math.max(latest, item.atMs);
  return latest;
};

const storage = <A>(
  operation: string,
  run: () => A,
): Effect.Effect<A, StorageError> =>
  Effect.try({
    try: run,
    catch: (cause) => new StorageError({ operation, cause }),
  });

/** Used by the Node runtime, the Cloudflare runtime fallback and every test. */
export function memoryBuffer(): JourneyBuffer["Service"] {
  const traces = new Map<TraceId, Map<string, JourneyItem>>();
  const hints = new Map<string, Map<TraceId, number>>();
  const transactions = new Map<string, Map<TraceId, number>>();

  const trace = (traceId: TraceId): Map<string, JourneyItem> => {
    const existing = traces.get(traceId);
    if (existing !== undefined) return existing;
    const created = new Map<string, JourneyItem>();
    traces.set(traceId, created);
    return created;
  };

  return {
    append: (traceId, item) =>
      storage("append", () => {
        const items = trace(traceId);
        if (!items.has(item.id)) items.set(item.id, item);
      }),
    read: (traceId) =>
      storage("read", () => [...(traces.get(traceId)?.values() ?? [])]),
    delete: (traceId) =>
      storage("delete", () => {
        traces.delete(traceId);
        for (const entries of hints.values()) entries.delete(traceId);
        for (const entries of transactions.values()) entries.delete(traceId);
      }),
    indexHints: (traceId, hintValues, atMs) =>
      storage("indexHints", () => {
        for (const key of hintKeys(hintValues)) {
          const entries = hints.get(key) ?? new Map<TraceId, number>();
          entries.set(traceId, Math.max(entries.get(traceId) ?? 0, atMs));
          hints.set(key, entries);
        }
        if (hintValues.transactionId !== undefined) {
          const key = `${hintValues.tenant ?? ""}:${hintValues.transactionId}`;
          const entries = transactions.get(key) ?? new Map<TraceId, number>();
          entries.set(traceId, Math.max(entries.get(traceId) ?? 0, atMs));
          transactions.set(key, entries);
        }
      }),
    findByTransaction: (tenant, transactionId, windowMs, nowMs) =>
      storage("findByTransaction", () => {
        const entries = transactions.get(`${tenant}:${transactionId}`);
        if (entries === undefined) return null;

        let best: TraceId | null = null;
        let bestAt = -1;
        for (const [traceId, atMs] of entries) {
          if (Math.abs(nowMs - atMs) > windowMs) continue;
          if (
            atMs > bestAt ||
            (atMs === bestAt &&
              (best === null || compareStrings(traceId, best) < 0))
          ) {
            best = traceId;
            bestAt = atMs;
          }
        }
        return best;
      }),
    findCandidates: (hintValues, windowMs, nowMs) =>
      storage("findCandidates", () => {
        const keys = hintKeys(hintValues);
        if (keys.length === 0) return [];

        let candidates: Set<TraceId> | null = null;
        for (const key of keys) {
          const matching = new Set<TraceId>();
          for (const [traceId, atMs] of hints.get(key) ?? []) {
            if (Math.abs(nowMs - atMs) <= windowMs) matching.add(traceId);
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
      storage("prune", () => {
        let dropped = 0;
        for (const [traceId, items] of traces) {
          if (items.size === 0) continue;
          if (newest(items.values()) < beforeMs) {
            traces.delete(traceId);
            dropped += 1;
          }
        }
        for (const entries of hints.values()) {
          for (const [traceId, atMs] of entries) {
            if (atMs < beforeMs) entries.delete(traceId);
          }
        }
        for (const entries of transactions.values()) {
          for (const [traceId, atMs] of entries) {
            if (atMs < beforeMs) entries.delete(traceId);
          }
        }
        return dropped;
      }),
  };
}

export const memoryBufferLayer: Layer.Layer<JourneyBuffer> = Layer.sync(
  JourneyBuffer,
  memoryBuffer,
);

export type MemoryScheduler = Scheduler["Service"] & {
  readonly pending: Effect.Effect<ReadonlyMap<TraceId, number>>;
};

export function memoryScheduler(): MemoryScheduler {
  const due = new Map<TraceId, number>();
  const handlers = new Set<
    (traceId: TraceId, nowMs: number) => Effect.Effect<void, StorageError>
  >();

  const runDue = (nowMs: number): Effect.Effect<void, StorageError> =>
    Effect.gen(function* () {
      const ready = [...due.entries()]
        .filter(([, atMs]) => atMs <= nowMs)
        .sort(([, a], [, b]) => a - b)
        .map(([traceId]) => traceId);

      for (const traceId of ready) {
        due.delete(traceId);
        for (const handler of handlers) yield* handler(traceId, nowMs);
      }
    });

  return {
    pending: Effect.sync(() => new Map(due)),
    schedule: (traceId, atMs) =>
      storage("schedule", () => {
        due.set(traceId, atMs);
      }),
    cancel: (traceId) =>
      storage("cancel", () => {
        due.delete(traceId);
      }),
    onDue: (handler) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          handlers.add(handler);
        }),
        () =>
          Effect.sync(() => {
            handlers.delete(handler);
          }),
      ),
    runDue,
  };
}

export const memorySchedulerLayer: Layer.Layer<Scheduler> = Layer.sync(
  Scheduler,
  memoryScheduler,
);

export const staticSettings = <Settings>(
  tenants: readonly TenantSettings<Settings>[],
): SettingsStore["Service"] => {
  const byKey = new Map(tenants.map((tenant) => [tenant.apiKeyHash, tenant]));
  return {
    getTenant: (apiKeyHash) => Effect.succeed(byKey.get(apiKeyHash) ?? null),
  };
};

export const staticSettingsLayer = <Settings>(
  tenants: readonly TenantSettings<Settings>[],
): Layer.Layer<SettingsStore> =>
  Layer.succeed(SettingsStore, staticSettings(tenants));

export const secretsLayer = (
  values: Readonly<Record<string, string>>,
): Layer.Layer<Secrets> =>
  Layer.succeed(Secrets, {
    get: (name) => Effect.succeed(values[name]),
  });

export const itemId = {
  span: (span: Span): string => `span:${span.spanId}`,
};
