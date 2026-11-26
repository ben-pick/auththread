import type {
  CorrelationHints,
  ProviderEvent,
  Span,
  TraceId,
} from "@auththread/schema";

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

export interface JourneyBuffer {
  append(traceId: TraceId, item: JourneyItem): Promise<void>;
  read(traceId: TraceId): Promise<JourneyItem[]>;
  delete(traceId: TraceId): Promise<void>;
  /** Indexed when a span arrives, so a later event without a trace ID can still be joined. */
  indexHints(
    traceId: TraceId,
    hints: CorrelationHints,
    atMs: number,
  ): Promise<void>;
  /** Exact lookup by an opaque transaction identifier, scoped by tenant. */
  findByTransaction(
    tenant: string,
    transactionId: string,
    windowMs: number,
    nowMs: number,
  ): Promise<TraceId | null>;
  findCandidates(
    hints: CorrelationHints,
    windowMs: number,
    nowMs: number,
  ): Promise<TraceId[]>;
  /** Removes items older than the cutoff. Returns how many journeys were dropped. */
  prune(beforeMs: number): Promise<number>;
}

export interface Scheduler {
  schedule(traceId: TraceId, atMs: number): Promise<void>;
  cancel(traceId: TraceId): Promise<void>;
  onDue(handler: (traceId: TraceId) => Promise<void>): void;
  /** Runs due timers at the given instant. The alarm and the timer both call this. */
  runDue(nowMs: number): Promise<void>;
}

export interface TenantSettings<Settings = unknown> {
  readonly tenant: string;
  readonly provider: string;
  /** Indexed lookup key: sha256 of the tenant API key, never the key itself. */
  readonly apiKeyHash: string;
  readonly salt: string;
  readonly providerSettings: Settings;
}

export interface SettingsStore {
  getTenant(apiKeyHash: string): Promise<TenantSettings | null>;
}

export interface Secrets {
  get(name: string): Promise<string | undefined>;
}
