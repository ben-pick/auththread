import type {
  CorrelationHints,
  ProviderEvent,
  Span,
  TraceId,
} from "@auththread/schema";
import { Context, type Effect, type Scope } from "effect";
import type { SettingsError, StorageError } from "./errors.ts";

export type JourneyItem =
  | {
      readonly kind: "span";
      readonly id: string;
      readonly atMs: number;
      readonly span: Span;
    }
  | {
      readonly kind: "event";
      readonly id: string;
      readonly atMs: number;
      readonly event: ProviderEvent;
    };

/** Per-trace storage. One implementation per runtime: memory, SQLite, a Durable Object. */
export class JourneyBuffer extends Context.Service<
  JourneyBuffer,
  {
    append(
      traceId: TraceId,
      item: JourneyItem,
    ): Effect.Effect<void, StorageError>;
    read(traceId: TraceId): Effect.Effect<JourneyItem[], StorageError>;
    delete(traceId: TraceId): Effect.Effect<void, StorageError>;
    /** Indexed when a span arrives, so a later event without a trace ID can still be joined. */
    indexHints(
      traceId: TraceId,
      hints: CorrelationHints,
      atMs: number,
    ): Effect.Effect<void, StorageError>;
    /** Exact lookup by an opaque transaction identifier, scoped by tenant. */
    findByTransaction(
      tenant: string,
      transactionId: string,
      windowMs: number,
      nowMs: number,
    ): Effect.Effect<TraceId | null, StorageError>;
    findCandidates(
      hints: CorrelationHints,
      windowMs: number,
      nowMs: number,
    ): Effect.Effect<TraceId[], StorageError>;
    /** Removes items older than the cutoff. Returns how many journeys were dropped. */
    prune(beforeMs: number): Effect.Effect<number, StorageError>;
  }
>()("auththread/JourneyBuffer") {}

export type JourneyBufferService = JourneyBuffer["Service"];

/** Timer storage. A Durable Object alarm, a Redis sorted set or an in-process map. */
export class Scheduler extends Context.Service<
  Scheduler,
  {
    schedule(traceId: TraceId, atMs: number): Effect.Effect<void, StorageError>;
    cancel(traceId: TraceId): Effect.Effect<void, StorageError>;
    /**
     * Registers the finaliser. The subscription lives for the scope, so a
     * scheduler implementation never keeps a reference to a torn-down stitcher.
     */
    onDue(
      handler: (
        traceId: TraceId,
        nowMs: number,
      ) => Effect.Effect<void, StorageError>,
    ): Effect.Effect<void, never, Scope.Scope>;
    /** Fires every timer due at the given instant. */
    runDue(nowMs: number): Effect.Effect<void, StorageError>;
  }
>()("auththread/Scheduler") {}

export type SchedulerService = Scheduler["Service"];

export interface TenantSettings<Settings = unknown> {
  readonly tenant: string;
  readonly provider: string;
  /** Indexed lookup key: sha256 of the tenant API key, never the key itself. */
  readonly apiKeyHash: string;
  readonly salt: string;
  readonly providerSettings: Settings;
}

export class SettingsStore extends Context.Service<
  SettingsStore,
  {
    getTenant(
      apiKeyHash: string,
    ): Effect.Effect<TenantSettings | null, SettingsError>;
  }
>()("auththread/SettingsStore") {}

export class Secrets extends Context.Service<
  Secrets,
  {
    get(name: string): Effect.Effect<string | undefined, StorageError>;
  }
>()("auththread/Secrets") {}
