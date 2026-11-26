import type {
  JourneyBuffer,
  ProviderAdapter,
  Scheduler,
  SettingsStore,
  Sink,
  SinkBatch,
  TenantSettings,
} from "@auththread/adapter-kit";
import {
  type Attributes,
  buildJourney,
  type CorrelationHints,
  hashUser,
  type Journey,
  type ProviderEvent,
  redactAttributes,
  redactSpan,
  type Span,
  sha256Hex,
  sortSpans,
  type TraceId,
} from "@auththread/schema";
import {
  decodeCompactSpans,
  decodeOtlpSpans,
  decodeProviderEvent,
} from "./decode.ts";
import { BadRequest, NotFound, Unauthorized } from "./errors.ts";

export interface Clock {
  now(): number;
}

export interface StitcherOptions {
  readonly providers: readonly ProviderAdapter<unknown>[];
  readonly buffer: JourneyBuffer;
  readonly scheduler: Scheduler;
  readonly settings: SettingsStore;
  readonly sinks: readonly Sink[];
  readonly clock?: Clock;
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
  readonly onError?: (error: unknown) => void;
}

export interface StitcherStats {
  readonly finalised: number;
  readonly unmatched: number;
  readonly writeErrors: number;
  readonly rejected: number;
}

export interface Stitcher {
  fetch(request: Request): Promise<Response>;
  ingestSpan(span: Span, tenant?: TenantSettings): Promise<void>;
  ingestEvent(event: ProviderEvent, tenant?: TenantSettings): Promise<void>;
  runDue(nowMs: number): Promise<void>;
  flush(): SinkBatch[];
  stats(): StitcherStats;
}

interface PendingEvent {
  readonly event: ProviderEvent;
  readonly atMs: number;
  readonly tenant: string;
  readonly bytes: number;
}

const MAX_BODY_BYTES = 256 * 1024;
const MAX_PENDING = 200;
const MAX_PENDING_BYTES = 1024 * 1024;

const hintsOf = (
  attributes: Attributes,
  salt: string | undefined,
  tenant: string | undefined,
): CorrelationHints => {
  const userHash = attributes["auth.user.hash"];
  const clientId = attributes["auth.client_id"];
  const rawUser = attributes.user_id;
  return {
    ...(tenant === undefined ? {} : { tenant }),
    ...(typeof userHash === "string" ? { userHash } : {}),
    ...(typeof rawUser === "string" && salt !== undefined
      ? { userHash: hashUser(rawUser, salt) }
      : {}),
    ...(typeof clientId === "string" ? { clientId } : {}),
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

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers":
    "authorization, content-type, x-auththread-key",
  "access-control-max-age": "86400",
};

async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) throw new BadRequest("payload too large");
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) throw new BadRequest("payload too large");
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new BadRequest("body is not valid JSON");
  }
}

const bearer = (request: Request): string | null => {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7);
  return request.headers.get("x-auththread-key");
};

export function createStitcher(options: StitcherOptions): Stitcher {
  const clock = options.clock ?? { now: () => Date.now() };
  const quietMs = options.quietMs ?? 10 * 60 * 1000;
  const correlationWindowMs = options.correlationWindowMs ?? 2 * 60 * 1000;
  const ttlMs = options.ttlMs ?? 2 * 60 * 60 * 1000;
  const maxItems = options.maxItemsPerTrace ?? 500;

  const providers = new Map(
    options.providers.map((provider) => [provider.id, provider]),
  );
  const emitted: SinkBatch[] = [];
  const pending: PendingEvent[] = [];
  const deadlines = new Map<TraceId, number>();
  const counts = new Map<TraceId, number>();
  const finalising = new Set<TraceId>();
  let pendingBytes = 0;
  let overrideNow: number | null = null;
  let finalised = 0;
  let unmatchedDrops = 0;
  let writeErrors = 0;
  let rejected = 0;

  options.scheduler.onDue(async (traceId) => {
    await finalise(traceId, overrideNow ?? clock.now());
  });

  const redactEvent = (
    event: ProviderEvent,
    tenant?: TenantSettings,
  ): ProviderEvent => ({
    ...event,
    attributes: redactAttributes(event.attributes, {
      ...(tenant === undefined ? {} : { salt: tenant.salt }),
    }),
  });

  /**
   * Deadlines only move forward, and never sit in the past. A late span stamped
   * eleven minutes ago must wait a full quiet period from arrival.
   */
  async function scheduleFinalise(
    traceId: TraceId,
    endMs: number,
  ): Promise<void> {
    const now = clock.now();
    const bounded = Math.min(Math.max(now, endMs), now + ttlMs);
    const at = Math.max(deadlines.get(traceId) ?? 0, bounded + quietMs);
    deadlines.set(traceId, at);
    await options.scheduler.schedule(traceId, at);
  }

  function takeSlot(traceId: TraceId): boolean {
    const count = counts.get(traceId) ?? 0;
    if (count >= maxItems) {
      rejected += 1;
      return false;
    }
    counts.set(traceId, count + 1);
    return true;
  }

  async function appendEvent(
    traceId: TraceId,
    event: ProviderEvent,
  ): Promise<void> {
    if (!takeSlot(traceId)) return;
    await options.buffer.append(traceId, {
      kind: "event",
      id: `event:${event.id}`,
      atMs: event.atMs,
      event,
    });
    await scheduleFinalise(traceId, event.atMs);
  }

  function park(entry: PendingEvent): void {
    pending.push(entry);
    pendingBytes += entry.bytes;

    while (
      pending.length > MAX_PENDING ||
      (pendingBytes > MAX_PENDING_BYTES && pending.length > 1)
    ) {
      const dropped = pending.shift();
      pendingBytes -= dropped?.bytes ?? 0;
      unmatchedDrops += 1;
    }
  }

  async function adoptPending(
    traceId: TraceId,
    hints: CorrelationHints,
    atMs: number,
  ): Promise<void> {
    for (let index = pending.length - 1; index >= 0; index--) {
      const entry = pending[index];
      if (entry === undefined) continue;
      if (!matching(entry.event, hints, correlationWindowMs, atMs)) continue;
      pending.splice(index, 1);
      pendingBytes -= entry.bytes;
      await appendEvent(traceId, entry.event);
    }
  }

  async function finalise(traceId: TraceId, nowMs: number): Promise<void> {
    if (finalising.has(traceId)) return;
    finalising.add(traceId);

    try {
      const items = await options.buffer.read(traceId);
      const spans = items
        .filter((item) => item.kind === "span")
        .map((item) => item.span);
      if (spans.length === 0) {
        await options.buffer.delete(traceId);
        deadlines.delete(traceId);
        counts.delete(traceId);
        return;
      }

      const latest = items.reduce((max, item) => Math.max(max, item.atMs), 0);
      if (nowMs < latest + quietMs) {
        await scheduleFinalise(traceId, latest);
        return;
      }

      const events = items
        .filter((item) => item.kind === "event")
        .map((item) => item.event);
      const first = sortSpans(spans)[0] as Span;
      const firstString = (value: unknown, fallback: string): string =>
        typeof value === "string" ? value : fallback;
      const provider = firstString(
        first.attributes["auth.provider"],
        events[0]?.provider ?? "unknown",
      );
      const tenant = firstString(
        first.attributes["auth.tenant"],
        events[0]?.tenant ?? "unknown",
      );

      const journey: Journey = buildJourney({
        traceId: first.traceId,
        provider,
        tenant,
        spans: spans.map((span) => redactSpan(span, {})),
        events: events.map((event) => redactEvent(event)),
      });

      for (const sink of options.sinks) {
        try {
          const batch = sink.render(journey);
          if (batch === null) continue;
          await sink.write(batch);
          if (options.captureBatches === true) emitted.push(batch);
        } catch (error) {
          writeErrors += 1;
          options.onError?.(error);
        }
      }

      const seen = new Set(items.map((item) => item.id));
      const appended = (await options.buffer.read(traceId)).filter(
        (item) => !seen.has(item.id),
      );
      if (appended.length > 0) {
        const newest = appended.reduce(
          (max, item) => Math.max(max, item.atMs),
          0,
        );
        await scheduleFinalise(traceId, newest);
        return;
      }

      await options.buffer.delete(traceId);
      deadlines.delete(traceId);
      counts.delete(traceId);
      finalised += 1;
    } finally {
      finalising.delete(traceId);
    }
  }

  const stitcher: Stitcher = {
    async ingestSpan(span, tenant) {
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
      const clean = redactSpan(stamped, {
        ...(tenant === undefined ? {} : { salt: tenant.salt }),
      });
      if (!takeSlot(span.traceId)) return;

      const hints = hintsOf(clean.attributes, tenant?.salt, tenant?.tenant);

      await options.buffer.append(span.traceId, {
        kind: "span",
        id: `span:${span.spanId}`,
        atMs: span.startMs,
        span: clean,
      });
      await options.buffer.indexHints(span.traceId, hints, span.startMs);
      await adoptPending(span.traceId, hints, span.startMs);
      await scheduleFinalise(span.traceId, span.startMs + span.durationMs);
    },

    async ingestEvent(event, tenant) {
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
        await appendEvent(clean.traceId, clean);
        return;
      }

      const candidates = await options.buffer.findCandidates(
        clean.hints,
        correlationWindowMs,
        clean.atMs,
      );
      const best = candidates[0];
      if (best !== undefined) {
        await appendEvent(best, clean);
        return;
      }

      park({
        event: clean,
        atMs: clean.atMs,
        tenant: clean.tenant,
        bytes: JSON.stringify(clean).length,
      });
    },

    async runDue(nowMs) {
      overrideNow = nowMs;
      try {
        await options.scheduler.runDue(nowMs);
      } finally {
        overrideNow = null;
      }

      for (let index = pending.length - 1; index >= 0; index--) {
        const entry = pending[index];
        if (entry === undefined) continue;
        if (nowMs - entry.atMs > ttlMs) {
          pending.splice(index, 1);
          pendingBytes -= entry.bytes;
          unmatchedDrops += 1;
        }
      }

      await options.buffer.prune(nowMs - ttlMs);
      for (const [traceId, at] of deadlines) {
        if (at < nowMs - ttlMs) deadlines.delete(traceId);
      }
    },

    flush() {
      return emitted.splice(0, emitted.length);
    },

    stats() {
      return { finalised, unmatched: unmatchedDrops, writeErrors, rejected };
    },

    async fetch(request) {
      try {
        if (request.method === "OPTIONS")
          return new Response(null, { status: 204, headers: CORS });

        const url = new URL(request.url);
        if (url.pathname === "/healthz") return json({ ok: true });
        if (request.method !== "POST")
          return json({ error: "method not allowed" }, 405);

        const key = bearer(request);
        if (key === null) throw new Unauthorized("missing API key");
        const tenant = await options.settings.getTenant(sha256Hex(key));
        if (tenant === null) {
          rejected += 1;
          throw new Unauthorized("unknown API key");
        }

        if (url.pathname === "/v1/spans") {
          const body = await readJson(request);
          const spans = decodeOtlpSpans(body);
          for (const span of spans) await stitcher.ingestSpan(span, tenant);
          return json({ accepted: spans.length }, 202);
        }

        if (url.pathname === "/v1/compact-spans") {
          const body = await readJson(request);
          const spans = decodeCompactSpans(body);
          for (const span of spans) await stitcher.ingestSpan(span, tenant);
          return json({ accepted: spans.length }, 202);
        }

        if (url.pathname === "/v1/events") {
          const body = await readJson(request);
          const batch = Array.isArray((body as { events?: unknown }).events)
            ? ((body as { events: unknown[] }).events ?? [])
            : [body];
          for (const entry of batch)
            await stitcher.ingestEvent(decodeProviderEvent(entry), tenant);
          return json({ accepted: batch.length }, 202);
        }

        if (url.pathname.startsWith("/v1/providers/")) {
          const rest = url.pathname.slice("/v1/providers/".length);
          const slash = rest.indexOf("/");
          const providerId = slash === -1 ? rest : rest.slice(0, slash);
          const feedPath = slash === -1 ? "/" : rest.slice(slash);
          const adapter = providers.get(providerId);
          if (adapter === undefined) throw new NotFound("unknown provider");
          if (adapter.id !== tenant.provider)
            throw new Unauthorized("tenant is for another provider");
          const feed = (adapter.feeds ?? []).find(
            (candidate) => candidate.path === feedPath,
          );
          if (feed === undefined) throw new NotFound("unknown feed");

          const headers: Record<string, string | undefined> = {};
          request.headers.forEach((value, name) => {
            headers[name] = value;
          });
          const verified = await Promise.resolve(
            feed.verify({ headers }, tenant.providerSettings),
          );
          if (!verified) {
            rejected += 1;
            throw new Unauthorized("feed verification failed");
          }

          const body = await readJson(request);
          const events = feed.parse(body, {
            hashUser: (value) => hashUser(value, tenant.salt),
          });
          for (const event of events) await stitcher.ingestEvent(event, tenant);
          return json({ accepted: events.length }, 202);
        }

        throw new NotFound("unknown route");
      } catch (error) {
        if (error instanceof BadRequest)
          return json({ error: "bad_request", message: error.message }, 400);
        if (error instanceof Unauthorized) {
          return json({ error: "unauthorized", message: error.message }, 401);
        }
        if (error instanceof NotFound)
          return json({ error: "not_found", message: error.message }, 404);
        options.onError?.(error);
        return json({ error: "internal" }, 500);
      }
    },
  };

  return stitcher;
}

export type { Journey };
