import {
  DEFAULT_SAMPLING,
  type SamplingPolicy,
  type Sink,
  type SinkError,
  shouldKeep,
} from "@auththread/adapter-kit";
import {
  compareStrings,
  type Journey,
  sha256Hex,
  toWideEvent,
  type WideEvent,
} from "@auththread/schema";
import { Effect, Ref } from "effect";
import type { ObjectStore } from "./store.ts";

export interface ObjectStoreSinkOptions {
  readonly store: ObjectStore;
  /** Key prefix, for example "auththread". */
  readonly prefix?: string;
  /** Rows per object before a flush. Default 1000. */
  readonly maxRows?: number;
  /** Bytes per object before a flush. Default 5 MB. */
  readonly maxBytes?: number;
  readonly sampling?: SamplingPolicy;
}

export interface ObjectStoreSink extends Sink {
  readonly flush: Effect.Effect<void, SinkError>;
}

interface PartitionBuffer {
  readonly rows: readonly WideEvent[];
  readonly bytes: number;
}

const partitionOf = (startedAt: string): string => {
  const date = new Date(startedAt);
  const iso = Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
  return `dt=${iso.slice(0, 10)}/hour=${iso.slice(11, 13)}`;
};

const emptyBuffer: PartitionBuffer = { rows: [], bytes: 0 };

export const createObjectStoreSink = (
  options: ObjectStoreSinkOptions,
): ObjectStoreSink => {
  const sampling = options.sampling ?? DEFAULT_SAMPLING;
  const prefix = (options.prefix ?? "auththread").replace(/^\/+|\/+$/g, "");
  const maxRows = options.maxRows ?? 1000;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const buffers = Ref.makeUnsafe(new Map<string, PartitionBuffer>());

  const flushPartition = (partition: string): Effect.Effect<void, SinkError> =>
    Effect.gen(function* () {
      const taken = yield* Ref.modify(buffers, (current) => {
        const buffer = current.get(partition) ?? emptyBuffer;
        if (buffer.rows.length === 0) return [emptyBuffer, current] as const;
        const next = new Map(current);
        next.delete(partition);
        return [buffer, next] as const;
      });
      if (taken.rows.length === 0) return;

      const sorted = [...taken.rows].sort((a, b) =>
        compareStrings(a.traceId, b.traceId),
      );
      const body = `${sorted.map((row) => JSON.stringify(row)).join("\n")}\n`;
      const key = `${prefix}/${partition}/batch-${sha256Hex(body).slice(0, 16)}.ndjson`;

      yield* options.store.put(key, body, "application/x-ndjson").pipe(
        Effect.catchTag("SinkError", (error) =>
          Effect.gen(function* () {
            yield* Ref.update(buffers, (current) => {
              const existing = current.get(partition) ?? emptyBuffer;
              const next = new Map(current);
              next.set(partition, {
                rows: [...taken.rows, ...existing.rows],
                bytes: taken.bytes + existing.bytes,
              });
              return next;
            });
            return yield* error;
          }),
        ),
      );
    });

  const flushAll: Effect.Effect<void, SinkError> = Effect.gen(function* () {
    const partitions = [...(yield* Ref.get(buffers)).keys()];
    for (const partition of partitions) {
      yield* flushPartition(partition);
    }
  });

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

    write: (batch) =>
      Effect.gen(function* () {
        const wide = batch.wideEvent;
        if (wide === undefined) return;

        const partition = partitionOf(wide.startedAt);
        const bytes = JSON.stringify(wide).length + 1;
        const full = yield* Ref.modify(buffers, (current) => {
          const buffer = current.get(partition) ?? emptyBuffer;
          const next = new Map(current);
          next.set(partition, {
            rows: [...buffer.rows, wide],
            bytes: buffer.bytes + bytes,
          });
          return [
            buffer.rows.length + 1 >= maxRows ||
              buffer.bytes + bytes >= maxBytes,
            next,
          ] as const;
        });

        if (full) yield* flushPartition(partition);
      }),

    flush: flushAll,

    idempotencyKey: (batch) => batch.journeyId,
  };
};

export type { S3StoreOptions } from "./s3.ts";
export { createS3Store } from "./s3.ts";
export type { ObjectStore } from "./store.ts";
