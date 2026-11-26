import {
  DEFAULT_SAMPLING,
  type SamplingPolicy,
  type Sink,
  SinkError,
  shouldKeep,
} from "@auththread/adapter-kit";
import { type Journey, toWideEvent } from "@auththread/schema";
import { Effect, Schema } from "effect";

class WebhookStatus extends Schema.TaggedError<WebhookStatus>()(
  "WebhookStatus",
  {
    status: Schema.Number,
  },
) {}

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

export const createWebhookSink = (options: WebhookSinkOptions): Sink => {
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
    write: (batch) => {
      if (batch.wideEvent === undefined) return Effect.void;
      const body = JSON.stringify(batch.wideEvent);

      return Effect.gen(function* () {
        const signature = yield* Effect.tryPromise({
          try: () => hmacSha256Hex(options.secret, body),
          catch: (cause) =>
            new SinkError({
              sink: "webhook",
              message: "could not sign the payload",
              cause,
            }),
        });

        const deliver = Effect.gen(function* () {
          const response = yield* Effect.tryPromise({
            try: () =>
              fetchImpl(options.url, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-auththread-signature": `sha256=${signature}`,
                  "x-auththread-idempotency-key": batch.journeyId,
                  ...options.headers,
                },
                body,
                signal: AbortSignal.timeout(options.timeoutMs ?? 3000),
              }),
            catch: (cause) =>
              new SinkError({
                sink: "webhook",
                message: "webhook request failed",
                cause,
              }),
          });
          if (!response.ok)
            return yield* new WebhookStatus({ status: response.status });
        });

        yield* Effect.retry(deliver, {
          times: retries,
          while: (error) =>
            error._tag === "SinkError" ||
            error.status === 429 ||
            error.status >= 500,
        }).pipe(
          Effect.catchTag("WebhookStatus", (error) =>
            Effect.fail(
              new SinkError({
                sink: "webhook",
                message: `webhook responded ${error.status}`,
              }),
            ),
          ),
        );
      });
    },
    idempotencyKey: (batch) => batch.journeyId,
  };
};
