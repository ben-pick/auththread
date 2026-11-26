import {
  DEFAULT_SAMPLING,
  type SamplingPolicy,
  type Sink,
  shouldKeep,
} from "@auththread/adapter-kit";
import {
  compareStrings,
  type Journey,
  sha256Hex,
  toWideEvent,
  type WideEvent,
} from "@auththread/schema";
import type { ObjectStore } from "./store.ts";

export interface ObjectStoreSinkOptions {
  readonly store: ObjectStore;
  /** Key prefix, for example "auththread". */
  readonly prefix?: string;
  /** Rows per object before a flush. Default 1000. */
  readonly maxRows?: number;
  /** Bytes per object before a flush. Default 5 MB. */
  readonly maxBytes?: number;
  /** Maximum age of a buffered row. Default 60 s. */
  readonly flushIntervalMs?: number;
  readonly sampling?: SamplingPolicy;
  readonly onError?: (error: unknown) => void;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export interface ObjectStoreSink extends Sink {
  flush(): Promise<void>;
}

interface PartitionBuffer {
  rows: WideEvent[];
  bytes: number;
}

const partitionOf = (startedAt: string): string => {
  const date = new Date(startedAt);
  const iso = Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
  return `dt=${iso.slice(0, 10)}/hour=${iso.slice(11, 13)}`;
};

export function createObjectStoreSink(
  options: ObjectStoreSinkOptions,
): ObjectStoreSink {
  const sampling = options.sampling ?? DEFAULT_SAMPLING;
  const prefix = (options.prefix ?? "auththread").replace(/^\/+|\/+$/g, "");
  const maxRows = options.maxRows ?? 1000;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const flushIntervalMs = options.flushIntervalMs ?? 60_000;
  const setTimer =
    options.setTimer ??
    ((callback: () => void, ms: number) => {
      const handle = setTimeout(callback, ms);
      (handle as { unref?: () => void }).unref?.();
      return handle;
    });
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as never));

  const buffers = new Map<string, PartitionBuffer>();
  let timer: unknown = null;

  const cancelTimer = (): void => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  const schedule = (): void => {
    if (timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      void flushAll().catch((error) => options.onError?.(error));
    }, flushIntervalMs);
  };

  async function flushPartition(partition: string): Promise<void> {
    const buffer = buffers.get(partition);
    if (buffer === undefined || buffer.rows.length === 0) return;

    const rows = buffer.rows;
    const bytes = buffer.bytes;
    buffer.rows = [];
    buffer.bytes = 0;

    const sorted = [...rows].sort((a, b) =>
      compareStrings(a.traceId, b.traceId),
    );
    const body = `${sorted.map((row) => JSON.stringify(row)).join("\n")}\n`;
    const key = `${prefix}/${partition}/batch-${sha256Hex(body).slice(0, 16)}.ndjson`;

    try {
      await options.store.put(key, body, "application/x-ndjson");
    } catch (error) {
      buffer.rows = [...rows, ...buffer.rows];
      buffer.bytes = bytes + buffer.bytes;
      schedule();
      throw error;
    }

    if (buffer.rows.length === 0) {
      buffers.delete(partition);
    } else {
      schedule();
    }
  }

  async function flushAll(): Promise<void> {
    cancelTimer();
    for (const partition of [...buffers.keys()]) {
      await flushPartition(partition);
    }
  }

  return {
    id: "object-store",
    accepts: ["journey"],
    sampling,

    render(journey: Journey) {
      if (!shouldKeep(sampling, journey)) return null;
      return {
        sinkId: "object-store",
        journeyId: journey.traceId,
        wideEvent: toWideEvent(journey),
      };
    },

    async write(batch) {
      const wide = batch.wideEvent;
      if (wide === undefined) return;

      const partition = partitionOf(wide.startedAt);
      const buffer = buffers.get(partition) ?? { rows: [], bytes: 0 };
      buffers.set(partition, buffer);
      const bytes = JSON.stringify(wide).length + 1;
      buffer.rows.push(wide);
      buffer.bytes += bytes;

      if (buffer.rows.length >= maxRows || buffer.bytes >= maxBytes) {
        await flushPartition(partition);
        return;
      }
      schedule();
    },

    flush: flushAll,

    idempotencyKey: (batch) => batch.journeyId,
  };
}

export type { S3StoreOptions } from "./s3.ts";
export { createS3Store } from "./s3.ts";
export type { ObjectStore } from "./store.ts";
