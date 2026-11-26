import type { ProviderAdapter, Sink } from "@auththread/adapter-kit";
import {
  createStitcher,
  type Stitcher,
  type StitcherOptions,
} from "@auththread/stitcher";
import {
  type AlarmScheduler,
  createAlarmScheduler,
  createDurableObjectBuffer,
  type DurableObjectStateLike,
} from "./storage.ts";

export interface JourneyDurableObjectOptions
  extends Omit<StitcherOptions, "buffer" | "scheduler" | "clock"> {
  readonly clock?: () => number;
}

export interface JourneyDurableObjectInstance {
  readonly stitcher: Stitcher;
  readonly scheduler: AlarmScheduler;
  fetch(request: Request): Promise<Response>;
  alarm(): Promise<void>;
}

/**
 * Returns the class a Worker exports as its Durable Object. The whole stitcher
 * lives here, so the buffer, the join and the timer share one consistent store.
 */
export function createJourneyDurableObject(
  options: JourneyDurableObjectOptions,
) {
  return class JourneyDurableObject implements JourneyDurableObjectInstance {
    readonly stitcher: Stitcher;
    readonly scheduler: AlarmScheduler;

    constructor(state: DurableObjectStateLike) {
      const now = options.clock ?? (() => Date.now());
      this.scheduler = createAlarmScheduler(state.storage, now);
      this.stitcher = createStitcher({
        ...options,
        clock: { now },
        buffer: createDurableObjectBuffer(state.storage),
        scheduler: this.scheduler,
      });
    }

    fetch(request: Request): Promise<Response> {
      return this.stitcher.fetch(request);
    }

    async alarm(): Promise<void> {
      await this.scheduler.alarm();
      for (const sink of options.sinks) {
        try {
          await sink.flush?.();
        } catch (error) {
          options.onError?.(error);
        }
      }
    }
  };
}

export type { ProviderAdapter, Sink };
