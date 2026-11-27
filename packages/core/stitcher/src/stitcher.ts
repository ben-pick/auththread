import {
  JourneyBuffer,
  type JourneyBufferService,
  type ProviderAdapter,
  Scheduler,
  type SchedulerService,
  type SettingsError,
  type SettingsStore,
  SettingsStore as SettingsStoreTag,
  type Sink,
  type SinkBatch,
  type StorageError,
  type TenantSettings,
} from "@auththread/adapter-kit";
import {
  type Attributes,
  type AttributeValue,
  buildJourney,
  type CorrelationHints,
  hashUser,
  type Journey,
  type ProviderEvent,
  redactAttributes,
  redactSpan,
  rootSpanId,
  SPAN_NAMES,
  type Span,
  sha256Hex,
  sortSpans,
  type TraceId,
} from "@auththread/schema";
import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Ref,
  Schema,
  type Scope,
  Semaphore,
} from "effect";
import { BadRequest, NotFound, Unauthorized } from "./errors.ts";
import {
  decodeCompactSpans,
  decodeOtlpSpans,
  decodeProviderEventBatch,
} from "./wire.ts";

export interface StitcherOptions {
  readonly providers: readonly ProviderAdapter<unknown>[];
  readonly sinks: readonly Sink[];
  /** A journey finalises this long after its last item. Default 10 minutes. */
  readonly quietMs?: number;
  /** How far apart a hint match may be. Default 2 minutes. */
  readonly correlationWindowMs?: number;
  /** Items older than this are pruned. Default 2 hours. */
  readonly ttlMs?: number;
  /** Items kept per journey. Older items are rejected. Default 500. */
  readonly maxItemsPerTrace?: number;
  /** Keep emitted batches in memory so tests and the demo can read them. */
  readonly captureBatches?: boolean;
  readonly onError?: (error: unknown) => Effect.Effect<void>;
  /** How often sinks flush their own buffer. Default 60 seconds. 0 disables it. */
  readonly flushIntervalMs?: number;
  /** Test seam. Production reads the Effect `Clock`. */
  readonly now?: Effect.Effect<number>;
}

export interface StitcherStats {
  readonly finalised: number;
  readonly unmatched: number;
  readonly writeErrors: number;
  readonly rejected: number;
}

interface PendingEvent {
  readonly event: ProviderEvent;
  readonly atMs: number;
  readonly tenant: string;
  readonly bytes: number;
}

interface State {
  readonly pending: readonly PendingEvent[];
  readonly pendingBytes: number;
  readonly deadlines: ReadonlyMap<TraceId, number>;
  readonly counts: ReadonlyMap<TraceId, number>;
  readonly owners: ReadonlyMap<TraceId, string>;
  readonly finalising: ReadonlySet<TraceId>;
  readonly emitted: readonly SinkBatch[];
  readonly finalised: number;
  readonly unmatched: number;
  readonly writeErrors: number;
  readonly rejected: number;
}

const initialState: State = {
  pending: [],
  pendingBytes: 0,
  deadlines: new Map(),
  counts: new Map(),
  owners: new Map(),
  finalising: new Set(),
  emitted: [],
  finalised: 0,
  unmatched: 0,
  writeErrors: 0,
  rejected: 0,
};

const MAX_BODY_BYTES = 256 * 1024;
const MAX_PENDING = 200;
const MAX_PENDING_BYTES = 1024 * 1024;

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers":
    "authorization, content-type, x-auththread-key",
  "access-control-max-age": "86400",
};

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: { ...CORS, "cache-control": "no-store" },
  });

const stringValue = (value: unknown): string | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(value));

/**
 * The snippet sends vendor facts. The adapter owns the neutral meaning. This
 * runs after redaction and before buffering so the stored span, the OTLP export
 * and the wide event all agree on stage/method.
 */
const normalizeUiSpan = (
  span: Span,
  adapter: ProviderAdapter<unknown> | undefined,
): Span => {
  if (span.name !== SPAN_NAMES.uiScreen) return span;

  const vendorScreen = stringValue(span.attributes["auth.ui.vendor_screen"]);
  const vendorPath = stringValue(span.attributes["auth.ui.vendor_path"]);
  const legacyStep = stringValue(span.attributes["auth.ui.step"]);
  const rule =
    adapter?.classifyUiScreen?.({
      ...(vendorScreen === undefined ? {} : { vendorScreen }),
      ...(vendorPath === undefined ? {} : { vendorPath }),
      ...(legacyStep === undefined ? {} : { legacyStep }),
    }) ?? {};

  const attributes: Record<string, AttributeValue> = { ...span.attributes };
  delete attributes["auth.ui.step"];
  // A snippet span is identified by its vendor screen/path. Its neutral meaning
  // is server-derived, so do not trust a client-supplied stage or abandonment.
  if (
    vendorScreen !== undefined ||
    vendorPath !== undefined ||
    legacyStep !== undefined
  ) {
    delete attributes["auth.ui.stage"];
    delete attributes["auth.abandoned_at"];
    delete attributes["auth.abandoned_screen"];
  }

  if (rule.stage !== undefined) attributes["auth.ui.stage"] = rule.stage;
  if (rule.method !== undefined) attributes["auth.method"] = rule.method;
  if (rule.methodVendorName !== undefined) {
    attributes["auth.method.vendor_name"] = rule.methodVendorName;
  }

  const abandoned = attributes["auth.ui.abandoned"] === true;
  delete attributes["auth.ui.abandoned"];
  if (abandoned) {
    if (rule.stage !== undefined) attributes["auth.abandoned_at"] = rule.stage;
    if (vendorScreen !== undefined) {
      attributes["auth.abandoned_screen"] = vendorScreen;
    }
  }

  return {
    ...span,
    parentSpanId: span.parentSpanId ?? rootSpanId(span.traceId),
    attributes,
  };
};

const hintsOf = (
  attributes: Attributes,
  salt: string | undefined,
  tenant: string | undefined,
): CorrelationHints => {
  const userHash = stringValue(attributes["auth.user.hash"]);
  const clientId = stringValue(attributes["auth.client_id"]);
  const transactionId = stringValue(attributes["auth.transaction.id"]);
  const rawUser = stringValue(attributes.user_id);
  return {
    ...(tenant === undefined ? {} : { tenant }),
    ...(userHash === undefined ? {} : { userHash }),
    ...(rawUser !== undefined && salt !== undefined
      ? { userHash: hashUser(rawUser, salt) }
      : {}),
    ...(clientId === undefined ? {} : { clientId }),
    ...(transactionId === undefined ? {} : { transactionId }),
  };
};

/**
 * Joining on a client ID alone is unsafe: a client is shared by every user of an
 * app. A hint join therefore needs the same tenant and a user hash.
 */
const matching = (
  event: ProviderEvent,
  hints: CorrelationHints,
  windowMs: number,
  atMs: number,
): boolean =>
  event.tenant === hints.tenant &&
  event.hints.userHash !== undefined &&
  event.hints.userHash === hints.userHash &&
  Math.abs(event.atMs - atMs) <= windowMs;

const bearer = (request: Request): string | null => {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const value = header.slice(7).trim();
    return value.length === 0 ? null : value;
  }
  const fallback = request.headers.get("x-auththread-key")?.trim();
  return fallback !== undefined && fallback.length > 0 ? fallback : null;
};

const readBody = (request: Request): Effect.Effect<string, BadRequest> =>
  Effect.gen(function* () {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES)
      return yield* new BadRequest({ message: "payload too large" });

    const body = request.body;
    if (body === null) return "";

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    while (true) {
      const next = yield* Effect.tryPromise({
        try: () => reader.read(),
        catch: () => new BadRequest({ message: "could not read the body" }),
      });
      if (next.done) break;
      const chunk = next.value;
      if (chunk === undefined) continue;

      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) {
        yield* Effect.tryPromise({
          try: () => reader.cancel(),
          catch: () => new BadRequest({ message: "payload too large" }),
        }).pipe(Effect.orElseSucceed(() => undefined));
        return yield* new BadRequest({ message: "payload too large" });
      }
      chunks.push(chunk);
    }

    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
  });

const readJson = (request: Request): Effect.Effect<unknown, BadRequest> =>
  Effect.gen(function* () {
    const text = yield* readBody(request);
    return yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.Unknown),
    )(text).pipe(
      Effect.mapError(
        () => new BadRequest({ message: "body is not valid JSON" }),
      ),
    );
  });

const reportError = (
  onError: StitcherOptions["onError"],
  error: unknown,
): Effect.Effect<void> =>
  onError === undefined ? Effect.logError(error) : onError(error);

const redactEvent = (
  event: ProviderEvent,
  tenant?: TenantSettings,
): ProviderEvent => ({
  ...event,
  attributes: redactAttributes(event.attributes, {
    ...(tenant === undefined ? {} : { salt: tenant.salt }),
  }),
});

export class Stitcher extends Context.Service<
  Stitcher,
  {
    ingestSpan(
      span: Span,
      tenant?: TenantSettings,
    ): Effect.Effect<void, Unauthorized>;
    ingestEvent(
      event: ProviderEvent,
      tenant?: TenantSettings,
    ): Effect.Effect<void, Unauthorized>;
    runDue(nowMs: number): Effect.Effect<void>;
    /** Finalise every in-flight journey now, used on graceful shutdown. */
    drain: Effect.Effect<void>;
    flush: Effect.Effect<SinkBatch[]>;
    stats: Effect.Effect<StitcherStats>;
    handle(request: Request): Effect.Effect<Response>;
  }
>()("auththread/Stitcher") {}

export type StitcherService = Stitcher["Service"];

const makeStitcher = (
  options: StitcherOptions,
  buffer: JourneyBufferService,
  scheduler: SchedulerService,
  settings: SettingsStore["Service"],
): Effect.Effect<StitcherService, never, Scope.Scope> =>
  Effect.gen(function* () {
    const quietMs = options.quietMs ?? 10 * 60 * 1000;
    const correlationWindowMs = options.correlationWindowMs ?? 2 * 60 * 1000;
    const ttlMs = options.ttlMs ?? 2 * 60 * 60 * 1000;
    const maxItems = options.maxItemsPerTrace ?? 500;

    const providers = new Map(
      options.providers.map((provider) => [provider.id, provider]),
    );
    const state = yield* Ref.make(initialState);
    const lock = yield* Semaphore.make(1);
    const currentNow = (): Effect.Effect<number> =>
      options.now ?? Clock.currentTimeMillis;

    const modify = <A>(f: (current: State) => readonly [A, State]) =>
      Ref.modify(state, f);

    const assertOwner = (
      traceId: TraceId,
      tenant: TenantSettings | undefined,
    ): Effect.Effect<void, Unauthorized> =>
      Effect.gen(function* () {
        if (tenant === undefined) return;
        const existing = yield* modify((current) => {
          const owner = current.owners.get(traceId);
          if (owner !== undefined && owner !== tenant.tenant) {
            return [
              false,
              { ...current, rejected: current.rejected + 1 },
            ] as const;
          }
          const owners = new Map(current.owners);
          owners.set(traceId, tenant.tenant);
          return [true, { ...current, owners }] as const;
        });
        if (!existing)
          return yield* new Unauthorized({
            message: "trace belongs to another tenant",
          });
      });

    const takeSlot = (traceId: TraceId): Effect.Effect<boolean> =>
      modify((current) => {
        const count = current.counts.get(traceId) ?? 0;
        if (count >= maxItems) {
          return [
            false,
            { ...current, rejected: current.rejected + 1 },
          ] as const;
        }
        const counts = new Map(current.counts);
        counts.set(traceId, count + 1);
        return [true, { ...current, counts }] as const;
      });

    const scheduleFinalise = (
      traceId: TraceId,
      endMs: number,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const nowMs = yield* currentNow();
        const bounded = Math.min(Math.max(nowMs, endMs), nowMs + ttlMs);
        const current = yield* Ref.get(state);
        const at = Math.max(
          current.deadlines.get(traceId) ?? 0,
          bounded + quietMs,
        );
        yield* modify((currentState) => {
          const deadlines = new Map(currentState.deadlines);
          deadlines.set(traceId, at);
          return [undefined, { ...currentState, deadlines }] as const;
        });
        yield* scheduler.schedule(traceId, at).pipe(
          Effect.catchCause((error) =>
            Effect.andThen(
              modify(
                (currentState) =>
                  [
                    undefined,
                    {
                      ...currentState,
                      writeErrors: currentState.writeErrors + 1,
                    },
                  ] as const,
              ),
              reportError(options.onError, error),
            ),
          ),
        );
      });

    const cleanupTrace = (traceId: TraceId): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* modify((current) => {
          const deadlines = new Map(current.deadlines);
          const counts = new Map(current.counts);
          const owners = new Map(current.owners);
          deadlines.delete(traceId);
          counts.delete(traceId);
          owners.delete(traceId);
          return [
            undefined,
            { ...current, deadlines, counts, owners },
          ] as const;
        });
        yield* buffer
          .delete(traceId)
          .pipe(
            Effect.catchCause((error) => reportError(options.onError, error)),
          );
      });

    const appendEvent = (
      traceId: TraceId,
      event: ProviderEvent,
      exact = false,
    ): Effect.Effect<void, Unauthorized | StorageError> =>
      Effect.gen(function* () {
        if (!(yield* takeSlot(traceId))) return;
        const stored = exact ? { ...event, traceId } : event;
        yield* buffer.append(traceId, {
          kind: "event",
          id: `event:${event.id}`,
          atMs: event.atMs,
          event: stored,
        });
        yield* scheduleFinalise(traceId, event.atMs);
      });

    const park = (entry: PendingEvent): Effect.Effect<void> =>
      modify((current) => {
        const pending = [...current.pending, entry];
        let pendingBytes = current.pendingBytes + entry.bytes;
        let unmatched = current.unmatched;
        while (
          pending.length > MAX_PENDING ||
          (pendingBytes > MAX_PENDING_BYTES && pending.length > 1)
        ) {
          const dropped = pending.shift();
          pendingBytes -= dropped?.bytes ?? 0;
          unmatched += 1;
        }
        return [
          undefined,
          { ...current, pending, pendingBytes, unmatched },
        ] as const;
      });

    const adoptPending = (
      traceId: TraceId,
      hints: CorrelationHints,
      atMs: number,
    ): Effect.Effect<void, Unauthorized | StorageError> =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        const remaining: PendingEvent[] = [];
        let pendingBytes = current.pendingBytes;

        for (const entry of current.pending) {
          const exact =
            entry.event.tenant === hints.tenant &&
            entry.event.hints.transactionId !== undefined &&
            entry.event.hints.transactionId === hints.transactionId &&
            Math.abs(entry.event.atMs - atMs) <= correlationWindowMs;
          if (
            !exact &&
            !matching(entry.event, hints, correlationWindowMs, atMs)
          ) {
            remaining.push(entry);
            continue;
          }
          pendingBytes -= entry.bytes;
          yield* appendEvent(traceId, entry.event, exact);
        }

        yield* modify(
          (stateNow) =>
            [
              undefined,
              {
                ...stateNow,
                pending: remaining,
                pendingBytes,
              },
            ] as const,
        );
      });

    const finalise = (traceId: TraceId, nowMs: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        if (current.finalising.has(traceId)) return;

        const finalising = new Set(current.finalising);
        finalising.add(traceId);
        yield* modify(
          (stateNow) => [undefined, { ...stateNow, finalising }] as const,
        );

        yield* Effect.gen(function* () {
          const items = yield* buffer.read(traceId);
          const spans = items
            .filter((item) => item.kind === "span")
            .map((item) => item.span);
          if (spans.length === 0) {
            yield* cleanupTrace(traceId);
            return;
          }

          const latest = items.reduce(
            (max, item) => Math.max(max, item.atMs),
            0,
          );
          if (nowMs < latest + quietMs) {
            yield* scheduleFinalise(traceId, latest);
            return;
          }

          const events = items
            .filter((item) => item.kind === "event")
            .map((item) => item.event);
          const first = sortSpans(spans)[0] as Span;
          const provider =
            stringValue(first.attributes["auth.provider"]) ??
            events[0]?.provider ??
            "unknown";
          const tenant =
            stringValue(first.attributes["auth.tenant"]) ??
            events[0]?.tenant ??
            "unknown";

          const journey: Journey = buildJourney({
            traceId: first.traceId,
            provider,
            tenant,
            spans: spans.map((span) => redactSpan(span, {})),
            events: events.map((event) => redactEvent(event)),
          });

          const captured: SinkBatch[] = [];
          for (const sink of options.sinks) {
            const batch = sink.render(journey);
            if (batch === null) continue;
            const written = yield* sink.write(batch).pipe(
              Effect.as(true),
              Effect.catchCause((error) =>
                Effect.andThen(
                  modify(
                    (stateNow) =>
                      [
                        undefined,
                        {
                          ...stateNow,
                          writeErrors: stateNow.writeErrors + 1,
                        },
                      ] as const,
                  ),
                  Effect.andThen(
                    reportError(options.onError, error),
                    Effect.succeed(false),
                  ),
                ),
              ),
            );
            if (written) captured.push(batch);
          }

          if (options.captureBatches === true && captured.length > 0) {
            yield* modify(
              (stateNow) =>
                [
                  undefined,
                  { ...stateNow, emitted: [...stateNow.emitted, ...captured] },
                ] as const,
            );
          }

          const seen = new Set(items.map((item) => item.id));
          const appended = (yield* buffer.read(traceId)).filter(
            (item) => !seen.has(item.id),
          );
          if (appended.length > 0) {
            const newest = appended.reduce(
              (max, item) => Math.max(max, item.atMs),
              0,
            );
            yield* scheduleFinalise(traceId, newest);
            return;
          }

          yield* cleanupTrace(traceId);
          yield* modify(
            (stateNow) =>
              [
                undefined,
                { ...stateNow, finalised: stateNow.finalised + 1 },
              ] as const,
          );
        }).pipe(
          Effect.catchCause((error) => reportError(options.onError, error)),
          Effect.ensuring(
            modify((stateNow) => {
              const next = new Set(stateNow.finalising);
              next.delete(traceId);
              return [undefined, { ...stateNow, finalising: next }] as const;
            }),
          ),
        );
      });

    const withLock = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
      lock.withPermit(effect);

    const ingestSpan = (
      span: Span,
      tenant?: TenantSettings,
    ): Effect.Effect<void, Unauthorized> =>
      withLock(
        Effect.gen(function* () {
          const stamped: Span = {
            ...span,
            attributes:
              tenant === undefined
                ? span.attributes
                : {
                    ...span.attributes,
                    "auth.provider": tenant.provider,
                    "auth.tenant": tenant.tenant,
                  },
          };
          const clean = normalizeUiSpan(
            redactSpan(stamped, {
              ...(tenant === undefined ? {} : { salt: tenant.salt }),
            }),
            tenant === undefined ? undefined : providers.get(tenant.provider),
          );
          yield* assertOwner(span.traceId, tenant);
          if (!(yield* takeSlot(span.traceId))) return;

          const hints = hintsOf(clean.attributes, tenant?.salt, tenant?.tenant);

          yield* buffer.append(span.traceId, {
            kind: "span",
            id: `span:${span.spanId}`,
            atMs: span.startMs,
            span: clean,
          });
          yield* buffer.indexHints(span.traceId, hints, span.startMs);
          yield* adoptPending(span.traceId, hints, span.startMs);
          yield* scheduleFinalise(span.traceId, span.startMs + span.durationMs);
        }).pipe(
          Effect.catchTag("StorageError", (error) =>
            reportError(options.onError, error),
          ),
        ),
      );

    const ingestEvent = (
      event: ProviderEvent,
      tenant?: TenantSettings,
    ): Effect.Effect<void, Unauthorized> =>
      withLock(
        Effect.gen(function* () {
          const adapter = providers.get(event.provider);
          const classified = adapter?.classify(event);
          const verdict: ProviderEvent = {
            ...event,
            provider: tenant?.provider ?? event.provider,
            tenant: tenant?.tenant ?? event.tenant,
            attributes: {
              ...event.attributes,
              ...(tenant === undefined
                ? {}
                : {
                    "auth.provider": tenant.provider,
                    "auth.tenant": tenant.tenant,
                  }),
              ...(classified?.outcome === undefined
                ? {}
                : { "auth.outcome": classified.outcome }),
              ...(classified?.errorCode === undefined
                ? {}
                : { "auth.error.code": classified.errorCode }),
            },
          };
          const withHints: ProviderEvent = {
            ...verdict,
            hints: {
              ...verdict.hints,
              ...hintsOf(
                verdict.attributes,
                tenant?.salt,
                tenant?.tenant ?? verdict.tenant,
              ),
            },
          };
          const clean = redactEvent(withHints, tenant);

          if (clean.traceId !== undefined) {
            yield* assertOwner(clean.traceId, tenant);
            yield* appendEvent(clean.traceId, clean);
            return;
          }

          if (clean.hints.transactionId !== undefined) {
            const exact = yield* buffer.findByTransaction(
              clean.tenant,
              clean.hints.transactionId,
              correlationWindowMs,
              clean.atMs,
            );
            if (exact !== null) {
              yield* assertOwner(exact, tenant);
              yield* appendEvent(exact, clean, true);
              return;
            }
          }

          const userHash = clean.hints.userHash;
          if (userHash !== undefined) {
            const candidates = yield* buffer.findCandidates(
              { tenant: clean.tenant, userHash },
              correlationWindowMs,
              clean.atMs,
            );
            const best = candidates[0];
            if (best !== undefined) {
              yield* assertOwner(best, tenant);
              yield* appendEvent(best, clean);
              return;
            }
          }

          yield* park({
            event: clean,
            atMs: clean.atMs,
            tenant: clean.tenant,
            bytes: JSON.stringify(clean).length,
          });
        }).pipe(
          Effect.catchTag("StorageError", (error) =>
            reportError(options.onError, error),
          ),
        ),
      );

    const runDue = (nowMs: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* scheduler
          .runDue(nowMs)
          .pipe(
            Effect.catchCause((error) => reportError(options.onError, error)),
          );

        yield* modify((current) => {
          let pendingBytes = current.pendingBytes;
          let unmatched = current.unmatched;
          const pending = current.pending.filter((entry) => {
            if (nowMs - entry.atMs > ttlMs) {
              pendingBytes -= entry.bytes;
              unmatched += 1;
              return false;
            }
            return true;
          });
          return [
            undefined,
            { ...current, pending, pendingBytes, unmatched },
          ] as const;
        });

        yield* buffer
          .prune(nowMs - ttlMs)
          .pipe(
            Effect.catchCause((error) => reportError(options.onError, error)),
          );
        yield* modify((current) => {
          const deadlines = new Map(current.deadlines);
          for (const [traceId, at] of deadlines) {
            if (at < nowMs - ttlMs) deadlines.delete(traceId);
          }
          return [undefined, { ...current, deadlines }] as const;
        });
      });

    const requireTenant = (
      request: Request,
    ): Effect.Effect<TenantSettings, Unauthorized | SettingsError> =>
      Effect.gen(function* () {
        const key = bearer(request);
        if (key === null)
          return yield* new Unauthorized({ message: "missing API key" });
        const tenant = yield* settings.getTenant(sha256Hex(key));
        if (tenant === null) {
          yield* modify(
            (current) =>
              [
                undefined,
                { ...current, rejected: current.rejected + 1 },
              ] as const,
          );
          return yield* new Unauthorized({ message: "unknown API key" });
        }
        return tenant;
      });

    const handle = (request: Request): Effect.Effect<Response> =>
      Effect.gen(function* () {
        if (request.method === "OPTIONS")
          return new Response(null, { status: 204, headers: CORS });

        const url = new URL(request.url);
        if (url.pathname === "/healthz") return json({ ok: true });
        if (request.method !== "POST")
          return json({ error: "method not allowed" }, 405);

        const tenant = yield* requireTenant(request);

        if (url.pathname === "/v1/spans") {
          const body = yield* readJson(request);
          const spans = yield* decodeOtlpSpans(body);
          for (const span of spans) yield* ingestSpan(span, tenant);
          return json({ accepted: spans.length }, 202);
        }

        if (url.pathname === "/v1/compact-spans") {
          const body = yield* readJson(request);
          const spans = yield* decodeCompactSpans(body);
          for (const span of spans) yield* ingestSpan(span, tenant);
          return json({ accepted: spans.length }, 202);
        }

        if (url.pathname === "/v1/events") {
          const body = yield* readJson(request);
          const events = yield* decodeProviderEventBatch(body);
          for (const event of events) yield* ingestEvent(event, tenant);
          return json({ accepted: events.length }, 202);
        }

        if (url.pathname.startsWith("/v1/providers/")) {
          const rest = url.pathname.slice("/v1/providers/".length);
          const slash = rest.indexOf("/");
          const providerId = slash === -1 ? rest : rest.slice(0, slash);
          const feedPath = slash === -1 ? "/" : rest.slice(slash);
          const adapter = providers.get(providerId);
          if (adapter === undefined)
            return yield* new NotFound({ message: "unknown provider" });
          if (adapter.id !== tenant.provider)
            return yield* new Unauthorized({
              message: "tenant is for another provider",
            });
          const feed = (adapter.feeds ?? []).find(
            (candidate) => candidate.path === feedPath,
          );
          if (feed === undefined)
            return yield* new NotFound({ message: "unknown feed" });

          const headers: Record<string, string | undefined> = {};
          request.headers.forEach((value, name) => {
            headers[name] = value;
          });
          const verified = yield* feed.verify(
            { headers },
            tenant.providerSettings,
          );
          if (!verified) {
            yield* modify(
              (current) =>
                [
                  undefined,
                  { ...current, rejected: current.rejected + 1 },
                ] as const,
            );
            return yield* new Unauthorized({
              message: "feed verification failed",
            });
          }

          const body = yield* readJson(request);
          const events = yield* feed.parse(body, {
            hashUser: (value) => hashUser(value, tenant.salt),
          });
          for (const event of events) yield* ingestEvent(event, tenant);
          return json({ accepted: events.length }, 202);
        }

        return yield* new NotFound({ message: "unknown route" });
      }).pipe(
        Effect.catchTags({
          BadRequest: (error) =>
            Effect.succeed(
              json({ error: "bad_request", message: error.message }, 400),
            ),
          Unauthorized: (error) =>
            Effect.succeed(
              json({ error: "unauthorized", message: error.message }, 401),
            ),
          NotFound: (error) =>
            Effect.succeed(
              json({ error: "not_found", message: error.message }, 404),
            ),
          FeedError: (error) =>
            Effect.succeed(
              json({ error: "bad_request", message: error.message }, 400),
            ),
        }),
        Effect.catchCause((error) =>
          Effect.andThen(
            reportError(options.onError, error),
            Effect.succeed(json({ error: "internal" }, 500)),
          ),
        ),
        Effect.catchCause((cause) =>
          Effect.andThen(
            reportError(options.onError, cause),
            Effect.succeed(json({ error: "internal" }, 500)),
          ),
        ),
      );

    const service: StitcherService = {
      ingestSpan,
      ingestEvent,
      runDue,
      drain: runDue(Number.MAX_SAFE_INTEGER),
      flush: Ref.modify(state, (current) => [
        [...current.emitted],
        { ...current, emitted: [] },
      ]),
      stats: Ref.get(state).pipe(
        Effect.map((current) => ({
          finalised: current.finalised,
          unmatched: current.unmatched,
          writeErrors: current.writeErrors,
          rejected: current.rejected,
        })),
      ),
      handle,
    };

    const flushSinks = Effect.forEach(
      options.sinks,
      (sink) =>
        (sink.flush ?? Effect.void).pipe(
          Effect.catchCause((cause) => reportError(options.onError, cause)),
        ),
      { discard: true },
    );

    yield* scheduler.onDue((traceId, nowMs) =>
      withLock(finalise(traceId, nowMs)),
    );
    yield* Effect.addFinalizer(() => Effect.andThen(service.drain, flushSinks));
    const flushIntervalMs = options.flushIntervalMs ?? 60_000;
    if (flushIntervalMs > 0) {
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.andThen(
            Effect.sleep(Duration.millis(flushIntervalMs)),
            flushSinks,
          ),
        ),
      );
    }

    return service;
  });

export const stitcherLayer = (
  options: StitcherOptions,
): Layer.Layer<Stitcher, never, JourneyBuffer | Scheduler | SettingsStore> =>
  Layer.effect(
    Stitcher,
    Effect.gen(function* () {
      const buffer = yield* JourneyBuffer;
      const scheduler = yield* Scheduler;
      const settings = yield* SettingsStoreTag;
      return yield* makeStitcher(options, buffer, scheduler, settings);
    }),
  );
