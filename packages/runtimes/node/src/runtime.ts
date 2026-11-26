import {
  createMemoryBuffer,
  createStaticSettings,
  type JourneyBuffer,
  type ProviderAdapter,
  type Sink,
} from "@auththread/adapter-kit";
import type { AuththreadConfig } from "@auththread/config";
import { toTenantSettings } from "@auththread/config";
import type { Clock, Stitcher } from "@auththread/stitcher";
import { createNodeScheduler, type NodeScheduler } from "./scheduler.ts";
import { createNodeServer, type NodeServer } from "./server.ts";
import { createSQLiteStore, type SQLiteStore } from "./sqlite.ts";

export type NodeStorage =
  | { readonly type: "memory" }
  | { readonly type: "sqlite"; readonly path: string };

export interface NodeRuntimeOptions {
  readonly config: AuththreadConfig;
  readonly providers: readonly ProviderAdapter<unknown>[];
  readonly sinks: readonly Sink[];
  /** Defaults to memory. SQLite persists journeys across restarts. */
  readonly storage?: NodeStorage;
  /** Advanced: supply a buffer directly. Overrides storage. */
  readonly buffer?: JourneyBuffer;
  readonly scheduler?: NodeScheduler;
  readonly clock?: Clock;
  readonly quietMs?: number;
  readonly correlationWindowMs?: number;
  readonly ttlMs?: number;
  readonly captureBatches?: boolean;
  readonly onError?: (error: unknown) => void;
}

export interface NodeRuntime {
  readonly stitcher: Stitcher;
  readonly server: NodeServer["server"];
  readonly scheduler: NodeScheduler;
  listen(port: number, host?: string): Promise<{ port: number }>;
  close(): Promise<void>;
}

/**
 * Compose the Node HTTP host from the shared config. This is the turnkey
 * entrypoint; createNodeServer and createStitcher remain the lower-level hooks.
 */
export function createNodeRuntime(options: NodeRuntimeOptions): NodeRuntime {
  const storage = options.storage ?? { type: "memory" };
  let store: SQLiteStore | undefined;
  let buffer: JourneyBuffer;

  if (options.buffer !== undefined) {
    buffer = options.buffer;
  } else if (storage.type === "sqlite") {
    const quietMs = options.quietMs ?? options.config.quietMs;
    store = createSQLiteStore({
      path: storage.path,
      ...(quietMs === undefined ? {} : { quietMs }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    });
    buffer = store.buffer;
  } else {
    buffer = createMemoryBuffer();
  }

  const scheduler =
    options.scheduler ?? store?.scheduler ?? createNodeScheduler();

  const server = createNodeServer({
    providers: options.providers,
    sinks: options.sinks,
    settings: createStaticSettings(toTenantSettings(options.config)),
    buffer,
    scheduler,
    ...(options.quietMs === undefined && options.config.quietMs === undefined
      ? {}
      : { quietMs: options.quietMs ?? options.config.quietMs }),
    ...(options.correlationWindowMs === undefined &&
    options.config.correlationWindowMs === undefined
      ? {}
      : {
          correlationWindowMs:
            options.correlationWindowMs ?? options.config.correlationWindowMs,
        }),
    ...(options.ttlMs === undefined && options.config.ttlMs === undefined
      ? {}
      : { ttlMs: options.ttlMs ?? options.config.ttlMs }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.captureBatches === undefined
      ? {}
      : { captureBatches: options.captureBatches }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });

  return {
    stitcher: server.stitcher,
    server: server.server,
    scheduler,
    listen: (port, host) => server.listen(port, host),
    async close() {
      await server.close();
      store?.close();
    },
  };
}

export type { NodeServer };
