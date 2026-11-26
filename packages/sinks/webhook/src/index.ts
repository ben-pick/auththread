import {
  DEFAULT_SAMPLING,
  type SamplingPolicy,
  type Sink,
  shouldKeep,
} from "@auththread/adapter-kit";
import { type Journey, toWideEvent } from "@auththread/schema";

export interface WebhookSinkOptions {
  readonly url: string;
  /** Shared secret. Receivers verify the signature with the same value. */
  readonly secret: string;
  readonly sampling?: SamplingPolicy;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

const encoder = new TextEncoder();

export async function hmacSha256Hex(
  secret: string,
  body: string,
): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(body),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function createWebhookSink(options: WebhookSinkOptions): Sink {
  const sampling = options.sampling ?? DEFAULT_SAMPLING;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const retries = options.retries ?? 1;

  return {
    id: "webhook",
    accepts: ["journey"],
    sampling,
    render(journey: Journey) {
      if (!shouldKeep(sampling, journey)) return null;
      return {
        sinkId: "webhook",
        journeyId: journey.traceId,
        wideEvent: toWideEvent(journey),
      };
    },
    async write(batch) {
      if (batch.wideEvent === undefined) return;
      const body = JSON.stringify(batch.wideEvent);
      const signature = await hmacSha256Hex(options.secret, body);
      let lastError: unknown;

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const response = await fetchImpl(options.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-auththread-signature": `sha256=${signature}`,
              "x-auththread-idempotency-key": batch.journeyId,
              ...options.headers,
            },
            body,
            signal: AbortSignal.timeout(options.timeoutMs ?? 3000),
          });
          if (response.ok) return;
          lastError = new Error(`webhook responded ${response.status}`);
          if (response.status < 500 && response.status !== 429) break;
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error("webhook delivery failed");
    },
    idempotencyKey: (batch) => batch.journeyId,
  };
}
