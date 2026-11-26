import type { Span } from "@auththread/schema";
import { encodeSpans } from "./encode.ts";

export interface ExportResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly statusCode?: number;
}

export interface Exporter {
  export(spans: readonly Span[]): Promise<ExportResult>;
}

export interface OtlpExporterOptions {
  /** Full traces URL, for example https://collector/v1/traces. */
  readonly endpoint: string;
  readonly serviceName: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly fetchImpl?: typeof fetch;
}

const isRetryable = (status: number): boolean =>
  status === 429 || status >= 500;

export function createOtlpExporter(options: OtlpExporterOptions): Exporter {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 2000;
  const retries = options.retries ?? 1;

  const attempt = async (body: string): Promise<ExportResult> => {
    try {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...options.headers },
        body,
        signal: AbortSignal.timeout(timeoutMs),
        keepalive: true,
      });
      return response.ok
        ? { ok: true, statusCode: response.status }
        : {
            ok: false,
            statusCode: response.status,
            reason: `otlp responded ${response.status}`,
          };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "otlp request failed",
      };
    }
  };

  return {
    async export(spans) {
      if (spans.length === 0) return { ok: true };
      const body = JSON.stringify(
        encodeSpans(spans, { serviceName: options.serviceName }),
      );
      let result = await attempt(body);

      for (let i = 0; i < retries && !result.ok; i++) {
        if (result.statusCode !== undefined && !isRetryable(result.statusCode))
          break;
        result = await attempt(body);
      }

      return result;
    },
  };
}

export interface BatchExporterOptions {
  readonly exporter: Exporter;
  readonly maxSpans?: number;
  readonly flushIntervalMs?: number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export interface BatchExporter extends Exporter {
  enqueue(span: Span): void;
  flush(): Promise<ExportResult>;
  shutdown(): Promise<ExportResult>;
}

export function createBatchExporter(
  options: BatchExporterOptions,
): BatchExporter {
  const maxSpans = options.maxSpans ?? 100;
  const setTimer =
    options.setTimer ??
    ((callback: () => void, ms: number) => {
      const handle = setTimeout(callback, ms);
      (handle as { unref?: () => void }).unref?.();
      return handle;
    });
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as never));

  let queue: Span[] = [];
  let timer: unknown = null;
  let inFlight: Promise<ExportResult> | null = null;

  const cancelTimer = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  const flush = async (): Promise<ExportResult> => {
    cancelTimer();
    if (queue.length === 0) {
      return inFlight ?? { ok: true };
    }
    const batch = queue;
    queue = [];
    inFlight = options.exporter.export(batch);
    const result = await inFlight;
    inFlight = null;
    return result;
  };

  const schedule = () => {
    if (timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      void flush();
    }, options.flushIntervalMs ?? 1000);
  };

  return {
    enqueue(span) {
      queue.push(span);
      if (queue.length >= maxSpans) {
        void flush();
        return;
      }
      schedule();
    },
    flush,
    export: (spans) => options.exporter.export(spans),
    async shutdown() {
      cancelTimer();
      return flush();
    },
  };
}

export interface BeaconExporterOptions {
  readonly endpoint: string;
  readonly serviceName: string;
  readonly sendBeacon?: (url: string, data: Blob) => boolean;
}

/** The browser path: sendBeacon survives a page exit and never blocks the login. */
export function createBeaconExporter(options: BeaconExporterOptions): Exporter {
  const send =
    options.sendBeacon ??
    ((url: string, data: Blob) => globalThis.navigator.sendBeacon(url, data));

  return {
    async export(spans) {
      if (spans.length === 0) return { ok: true };
      const payload = JSON.stringify(
        encodeSpans(spans, { serviceName: options.serviceName }),
      );
      const queued = send(
        options.endpoint,
        new Blob([payload], { type: "application/json" }),
      );
      return queued
        ? { ok: true }
        : { ok: false, reason: "sendBeacon refused the payload" };
    },
  };
}
