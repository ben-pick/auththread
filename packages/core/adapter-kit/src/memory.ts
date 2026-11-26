import type { CorrelationHints, Span, TraceId } from "@auththread/schema";
import type {
  JourneyBuffer,
  JourneyItem,
  Scheduler,
  TenantSettings,
} from "./runtime.ts";

export const hintKeys = (hints: CorrelationHints): string[] => {
  const keys: string[] = [];
  if (hints.userHash !== undefined) keys.push(`u:${hints.userHash}`);
  if (hints.clientId !== undefined) keys.push(`c:${hints.clientId}`);
  if (hints.ipHash !== undefined) keys.push(`i:${hints.ipHash}`);
  if (hints.userAgentHash !== undefined) keys.push(`a:${hints.userAgentHash}`);
  return keys;
};

const newest = (items: JourneyItem[]): number =>
  items.reduce((latest, item) => Math.max(latest, item.atMs), 0);

/** Used by the Node runtime, the Cloudflare runtime fallback and every test. */
export function createMemoryBuffer(): JourneyBuffer {
  const traces = new Map<TraceId, Map<string, JourneyItem>>();
  const hints = new Map<string, Map<TraceId, number>>();

  const trace = (traceId: TraceId): Map<string, JourneyItem> => {
    const existing = traces.get(traceId);
    if (existing !== undefined) return existing;
    const created = new Map<string, JourneyItem>();
    traces.set(traceId, created);
    return created;
  };

  return {
    async append(traceId, item) {
      const items = trace(traceId);
      if (!items.has(item.id)) items.set(item.id, item);
    },
    async read(traceId) {
      return [...(traces.get(traceId)?.values() ?? [])];
    },
    async delete(traceId) {
      traces.delete(traceId);
      for (const entries of hints.values()) entries.delete(traceId);
    },
    async indexHints(traceId, hintValues, atMs) {
      for (const key of hintKeys(hintValues)) {
        const entries = hints.get(key) ?? new Map<TraceId, number>();
        entries.set(traceId, Math.max(entries.get(traceId) ?? 0, atMs));
        hints.set(key, entries);
      }
    },
    async findCandidates(hintValues, windowMs, nowMs) {
      const scores = new Map<TraceId, number>();
      for (const key of hintKeys(hintValues)) {
        for (const [traceId, atMs] of hints.get(key) ?? []) {
          if (Math.abs(nowMs - atMs) > windowMs) continue;
          scores.set(traceId, (scores.get(traceId) ?? 0) + 1);
        }
      }
      return [...scores.entries()]
        .sort(
          ([a, scoreA], [b, scoreB]) => scoreB - scoreA || a.localeCompare(b),
        )
        .map(([traceId]) => traceId);
    },
    async prune(beforeMs) {
      let dropped = 0;
      for (const [traceId, items] of traces) {
        if (items.size === 0) continue;
        if (newest([...items.values()]) < beforeMs) {
          traces.delete(traceId);
          dropped += 1;
        }
      }
      for (const entries of hints.values()) {
        for (const [traceId, atMs] of entries) {
          if (atMs < beforeMs) entries.delete(traceId);
        }
      }
      return dropped;
    },
  };
}

export interface MemoryScheduler extends Scheduler {
  readonly pending: ReadonlyMap<TraceId, number>;
}

export function createMemoryScheduler(): MemoryScheduler {
  const due = new Map<TraceId, number>();
  const handlers: Array<(traceId: TraceId) => Promise<void>> = [];

  return {
    get pending() {
      return due;
    },
    async schedule(traceId, atMs) {
      due.set(traceId, atMs);
    },
    async cancel(traceId) {
      due.delete(traceId);
    },
    onDue(handler) {
      handlers.push(handler);
    },
    async runDue(nowMs) {
      const ready = [...due.entries()]
        .filter(([, atMs]) => atMs <= nowMs)
        .sort(([, a], [, b]) => a - b || 0)
        .map(([traceId]) => traceId);

      for (const traceId of ready) {
        due.delete(traceId);
        for (const handler of handlers) await handler(traceId);
      }
    },
  };
}

export function createStaticSettings<Settings>(
  tenants: readonly TenantSettings<Settings>[],
): {
  getTenant(apiKeyHash: string): Promise<TenantSettings<Settings> | null>;
} {
  const byKey = new Map(tenants.map((tenant) => [tenant.apiKeyHash, tenant]));
  return {
    async getTenant(apiKeyHash) {
      return byKey.get(apiKeyHash) ?? null;
    },
  };
}

export const itemId = {
  span: (span: Span): string => `span:${span.spanId}`,
};
