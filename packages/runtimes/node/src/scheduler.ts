import type { Scheduler } from "@auththread/adapter-kit";
import type { TraceId } from "@auththread/schema";

export interface NodeScheduler extends Scheduler {
  stop(): void;
}

/** setTimeout-backed scheduler. Timers are unref'd so a test process can exit. */
export function createNodeScheduler(): NodeScheduler {
  const due = new Map<TraceId, number>();
  const timers = new Map<TraceId, ReturnType<typeof setTimeout>>();
  const handlers: Array<(traceId: TraceId) => Promise<void>> = [];

  const fire = async (traceId: TraceId): Promise<void> => {
    due.delete(traceId);
    const timer = timers.get(traceId);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(traceId);
    for (const handler of handlers) await handler(traceId);
  };

  return {
    async schedule(traceId, atMs) {
      due.set(traceId, atMs);
      const existing = timers.get(traceId);
      if (existing !== undefined) clearTimeout(existing);
      const timer = setTimeout(
        () => {
          void fire(traceId);
        },
        Math.max(0, atMs - Date.now()),
      );
      timer.unref?.();
      timers.set(traceId, timer);
    },
    async cancel(traceId) {
      due.delete(traceId);
      const timer = timers.get(traceId);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(traceId);
    },
    onDue(handler) {
      handlers.push(handler);
    },
    async runDue(nowMs) {
      const ready = [...due.entries()]
        .filter(([, atMs]) => atMs <= nowMs)
        .sort(([, a], [, b]) => a - b)
        .map(([traceId]) => traceId);
      for (const traceId of ready) await fire(traceId);
    },
    stop() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      due.clear();
    },
  };
}
