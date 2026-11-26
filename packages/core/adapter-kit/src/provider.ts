import type {
  Attributes,
  CorrelationHints,
  Outcome,
  ProviderEvent,
  TraceId,
} from "@auththread/schema";

export const CAPABILITIES = [
  "browser",
  "event-feed",
  "hooks",
  "hosted-page",
  "config",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type Correlation =
  | { readonly kind: "exact"; readonly traceId: TraceId }
  | { readonly kind: "hints"; readonly hints: CorrelationHints };

export interface FeedRequest {
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export interface Feed<Settings = unknown> {
  /** Mounted under /v1/providers/<adapter id>/. */
  readonly path: string;
  verify(request: FeedRequest, settings: Settings): boolean | Promise<boolean>;
  /**
   * Normalise the provider payload. Untrusted input: validate it here. Hash any
   * identifier with the supplied function instead of keeping it raw.
   */
  parse(body: unknown, context: ParseContext): ProviderEvent[];
}

export interface ParseContext {
  readonly hashUser: (value: string) => string;
}

export interface ConfigSnapshot {
  readonly provider: string;
  readonly fetchedAt: number;
  readonly hash: string;
  readonly hooks: ReadonlyArray<{
    readonly name: string;
    readonly version: string;
    readonly updatedAt: number;
  }>;
}

export interface ProviderAdapter<Settings = unknown> {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  /** Params that carry a trace ID through /authorize. Empty when the provider has none. */
  authorizeParams(traceId: TraceId): Record<string, string>;
  readonly feeds?: readonly Feed<Settings>[];
  correlate(event: ProviderEvent, settings: Settings): Correlation;
  classify(event: ProviderEvent): { outcome?: Outcome; errorCode?: string };
  fetchConfig?(settings: Settings): Promise<ConfigSnapshot>;
}

export type { Attributes };
