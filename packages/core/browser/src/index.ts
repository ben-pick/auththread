import {
  type Attributes,
  type AuthUiStage,
  isTraceId,
  type JourneyKind,
  newSpanId,
  newTraceId,
  rootSpanId,
  type SpanStatus,
  type TraceId,
} from "@auththread/schema";
import type { BrowserProvider } from "./provider.ts";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface BrowserOptions {
  /** Base URL of the stitcher, for example https://auth-telemetry.example.com */
  readonly endpoint: string;
  /** Write-only tenant key. Public by design, like any browser telemetry key. */
  readonly key: string;
  readonly tenant: string;
  readonly provider: BrowserProvider;
  /** Defaults to login. */
  readonly kind?: JourneyKind;
  /** Spans per request before an automatic flush. Default 20. */
  readonly batchSize?: number;
  /** Maximum time a span waits before a flush. Default 1000 ms. */
  readonly flushIntervalMs?: number;
  readonly storage?: StorageLike;
  readonly now?: () => number;
  readonly send?: (body: string) => void;
  readonly fetchImpl?: typeof fetch;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export interface CallbackResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface AuthThreadBrowser {
  traceId(): TraceId;
  authorizeParams(): Record<string, string>;
  callback(url: string | URL): CallbackResult;
  tokenExchange(durationMs: number): void;
  abandon(stage: AuthUiStage): void;
  /** Sends every queued span now. Called automatically on a batch or a page hide. */
  flush(): void;
}

const TRACE_KEY = "auththread.trace";
const STARTED_KEY = "auththread.started";
const PENDING_KEY = "auththread.pending";
const PENDING_TTL_MS = 15 * 60 * 1000;

const clear = (storage: StorageLike, key: string): void => {
  if (storage.removeItem !== undefined) storage.removeItem(key);
  else storage.setItem(key, "");
};

const memoryStorage = (): StorageLike => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

const safeStorage = (storage?: StorageLike): StorageLike => {
  if (storage !== undefined) return storage;
  try {
    return globalThis.sessionStorage ?? memoryStorage();
  } catch {
    return memoryStorage();
  }
};

const compactSpan = (
  traceId: TraceId,
  name: string,
  startMs: number,
  durationMs: number,
  attributes: Attributes,
  status: SpanStatus,
) => ({
  traceId,
  spanId: newSpanId(),
  parentSpanId: rootSpanId(traceId),
  name,
  startMs,
  durationMs,
  attributes,
  status,
});

export function init(options: BrowserOptions): AuthThreadBrowser {
  const storage = safeStorage(options.storage);
  const now = options.now ?? (() => Date.now());
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const batchSize = options.batchSize ?? 20;
  const setTimer =
    options.setTimer ??
    ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as never));

  let queue: unknown[] = [];
  let timer: unknown = null;

  const stored = storage.getItem(TRACE_KEY);
  let current: TraceId | null =
    stored !== null && isTraceId(stored) ? stored : null;

  const trace = (): TraceId => {
    if (current === null) {
      current = newTraceId();
      storage.setItem(TRACE_KEY, current);
    }
    return current;
  };

  const beginAttempt = (): TraceId => {
    const pending = Number(storage.getItem(PENDING_KEY) ?? "0");
    const active = pending > 0 && now() - pending < PENDING_TTL_MS;
    if (!active) {
      current = newTraceId();
      storage.setItem(TRACE_KEY, current);
    }
    return trace();
  };

  const send = (body: string): void => {
    if (options.send !== undefined) {
      try {
        options.send(body);
      } catch {
        // Never in the login path.
      }
      return;
    }
    try {
      const request = fetchImpl(
        `${options.endpoint.replace(/\/$/, "")}/v1/compact-spans`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.key}`,
          },
          body,
          keepalive: true,
        },
      );
      void request.catch(() => undefined);
    } catch {
      // Never in the login path.
    }
  };

  const emit = (span: unknown): void => {
    queue.push(span);
    if (queue.length >= batchSize) flush();
    else schedule();
  };

  function flush(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (queue.length === 0) return;
    const spans = queue;
    queue = [];
    send(JSON.stringify({ spans }));
  }

  function schedule(): void {
    if (timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      flush();
    }, options.flushIntervalMs ?? 1000);
  }

  const base: Attributes = {
    "auth.provider": options.provider.id,
    "auth.tenant": options.tenant,
    "auth.journey.kind": options.kind ?? "login",
  };

  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("pagehide", () => flush());
  }

  return {
    traceId: () => trace(),

    authorizeParams() {
      const startedAt = now();
      const id = beginAttempt();
      storage.setItem(STARTED_KEY, String(startedAt));
      storage.setItem(PENDING_KEY, String(startedAt));
      emit(
        compactSpan(id, "auth.app.login_start", startedAt, 0, base, {
          code: "unset",
        }),
      );
      flush();
      return options.provider.authorizeParams(id);
    },

    callback(url) {
      const parsed = typeof url === "string" ? new URL(url) : url;
      const error = parsed.searchParams.get("error") ?? undefined;
      const code = parsed.searchParams.get("code");
      const failure = error ?? (code === null ? "missing_code" : undefined);
      const finishedAt = now();
      const id = trace();
      clear(storage, PENDING_KEY);
      clear(storage, STARTED_KEY);
      emit(
        compactSpan(
          id,
          "auth.app.callback",
          finishedAt,
          0,
          {
            ...base,
            ...(failure === undefined
              ? {}
              : {
                  "auth.error.code": failure,
                  "auth.error.source": "provider",
                }),
          },
          failure === undefined
            ? { code: "ok" }
            : { code: "error", message: failure },
        ),
      );
      flush();
      return failure === undefined
        ? { ok: true }
        : { ok: false, error: failure };
    },

    flush,

    tokenExchange(durationMs) {
      const finishedAt = now();
      emit(
        compactSpan(
          trace(),
          "auth.app.token_exchange",
          finishedAt - durationMs,
          durationMs,
          base,
          { code: "ok" },
        ),
      );
    },

    abandon(stage) {
      const at = now();
      clear(storage, PENDING_KEY);
      emit(
        compactSpan(
          trace(),
          "auth.ui.screen",
          at,
          0,
          {
            ...base,
            "auth.ui.stage": stage,
            "auth.abandoned_at": stage,
          },
          { code: "unset" },
        ),
      );
    },
  };
}

export type { BrowserProvider };
