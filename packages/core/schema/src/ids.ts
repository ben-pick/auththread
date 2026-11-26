import { sha256Hex } from "./sha256.ts";

/**
 * Structurally identical to Effect's `Brand.Brand<"auththread/TraceId">`, so a
 * schema in the server zone can produce a TraceId without importing Effect
 * types into this package.
 */
export type TraceId = string & {
  readonly "~effect/Brand": {
    readonly "auththread/TraceId": "auththread/TraceId";
  };
};
export type SpanId = string & {
  readonly "~effect/Brand": {
    readonly "auththread/SpanId": "auththread/SpanId";
  };
};

const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;
const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);

export const isTraceId = (value: string): value is TraceId =>
  TRACE_ID.test(value) && value !== ZERO_TRACE;

export const isSpanId = (value: string): value is SpanId =>
  SPAN_ID.test(value) && value !== ZERO_SPAN;

export function parseTraceId(value: string): TraceId {
  if (!isTraceId(value)) throw new Error("invalid trace id");
  return value;
}

export function parseSpanId(value: string): SpanId {
  if (!isSpanId(value)) throw new Error("invalid span id");
  return value;
}

/** Test seam: production code gets IDs from crypto. */
export type RandomBytes = (length: number) => Uint8Array;

const cryptoRandom: RandomBytes = (length) => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

const fromBytes = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const newTraceId = (random: RandomBytes = cryptoRandom): TraceId =>
  parseTraceId(fromBytes(random(16)));

export const newSpanId = (random: RandomBytes = cryptoRandom): SpanId =>
  parseSpanId(fromBytes(random(8)));

/**
 * The root span of a journey is derived, not stored, so every emitter in the
 * browser, the hook and the stitcher agrees on the same parent without a round trip.
 */
export const rootSpanId = (traceId: TraceId): SpanId =>
  parseSpanId(sha256Hex(`root:${traceId}`).slice(0, 16));
