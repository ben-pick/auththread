import { runProviderConformance } from "@auththread/adapter-kit";
import { parseTraceId } from "@auththread/schema";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { auth0Browser } from "./browser.ts";
import {
  AUTH0_FEED_SECRET_HEADER,
  auth0Adapter,
  classifyAuth0Type,
  parseLogStream,
  verifyLogStream,
} from "./index.ts";

const TRACE = "a1".repeat(16);
const TRACE_ID = parseTraceId(TRACE);

const log = (over: Record<string, unknown> = {}) => ({
  log_id: "64f0c1e2",
  date: "2026-11-26T10:00:00.000Z",
  type: "fp",
  description: "Wrong email or password",
  connection: "Username-Password-Authentication",
  client_id: "client_abc",
  user_id: "auth0|64f0",
  user_name: "alice@example.com",
  details: { error: { message: "Wrong email or password" } },
  ...over,
});

const hashUser = (value: string) => `u_${value.length}`;

describe("parseLogStream", () => {
  it.effect("normalises a failure without keeping identifiers", () =>
    Effect.gen(function* () {
      const [event] = yield* parseLogStream(log(), { hashUser });

      expect(event).toMatchObject({
        id: "auth0_64f0c1e2",
        provider: "auth0",
        type: "login_failure",
        atMs: Date.parse("2026-11-26T10:00:00.000Z"),
        hints: { userHash: "u_10", clientId: "client_abc" },
        attributes: {
          "auth.provider": "auth0",
          "auth.client_id": "client_abc",
          "auth.method.vendor_name": "Username-Password-Authentication",
          "auth.user.hash": "u_10",
          "auth.error.vendor_code": "fp",
          "auth.error.source": "provider",
        },
      });
      expect(JSON.stringify(event)).not.toContain("alice@example.com");
      expect(JSON.stringify(event)).not.toContain("auth0|64f0");
    }),
  );

  it.effect("reads an exact trace ID when the log carries one", () =>
    Effect.gen(function* () {
      const [event] = yield* parseLogStream(
        log({ type: "s", details: { ext_trace_id: TRACE } }),
        { hashUser },
      );
      expect(event?.traceId).toBe(TRACE);
      expect(event?.type).toBe("login_success");
    }),
  );

  it.effect("marks a signup event as a signup journey", () =>
    Effect.gen(function* () {
      const [event] = yield* parseLogStream(log({ type: "ss" }), { hashUser });
      expect(event?.type).toBe("signup_success");
      expect(event?.attributes["auth.journey.kind"]).toBe("signup");
    }),
  );

  it.effect("unwraps the log stream envelope", () =>
    Effect.gen(function* () {
      const [event] = yield* parseLogStream(
        { log_id: "outer", data: log() },
        { hashUser },
      );

      expect(event).toMatchObject({
        id: "auth0_64f0c1e2",
        type: "login_failure",
        hints: { userHash: "u_10", clientId: "client_abc" },
      });
      expect(event?.attributes["auth.error.vendor_code"]).toBe("fp");
    }),
  );

  it.effect("keeps the transaction ID for an exact join", () =>
    Effect.gen(function* () {
      const [event] = yield* parseLogStream(
        log({ details: { transaction_id: "tx_1" } }),
        { hashUser },
      );
      expect(event?.attributes["auth.transaction.id"]).toBe("tx_1");
    }),
  );

  it.effect("accepts arrays and batches, and skips malformed entries", () =>
    Effect.gen(function* () {
      expect(
        yield* parseLogStream([log(), log({ log_id: "other" })], { hashUser }),
      ).toHaveLength(2);
      expect(
        yield* parseLogStream({ logs: [log(), { nope: true }] }, { hashUser }),
      ).toHaveLength(1);
      expect(yield* parseLogStream("nope", { hashUser })).toEqual([]);
      expect(
        yield* parseLogStream(log({ date: "not a date" }), { hashUser }),
      ).toEqual([]);
    }),
  );
});

describe("verifyLogStream", () => {
  it.effect("fails closed without a configured secret", () =>
    Effect.gen(function* () {
      expect(
        yield* verifyLogStream(
          { headers: { [AUTH0_FEED_SECRET_HEADER]: "x" } },
          {},
        ),
      ).toBe(false);
    }),
  );

  it.effect("compares the custom header", () =>
    Effect.gen(function* () {
      expect(
        yield* verifyLogStream(
          { headers: { [AUTH0_FEED_SECRET_HEADER]: "x" } },
          { feedSecret: "x" },
        ),
      ).toBe(true);
      expect(
        yield* verifyLogStream(
          { headers: { [AUTH0_FEED_SECRET_HEADER]: "y" } },
          { feedSecret: "x" },
        ),
      ).toBe(false);
    }),
  );
});

describe("classifyAuth0Type", () => {
  it("maps vendor codes to neutral outcomes", () => {
    expect(classifyAuth0Type("fp")).toEqual({
      outcome: "failed",
      errorCode: "invalid_password",
    });
    expect(classifyAuth0Type("s")).toEqual({ outcome: "success" });
    expect(classifyAuth0Type("gd")).toEqual({});
  });
});

describe("auth0 adapter", () => {
  it("carries the trace ID as an ext- authorize param", () => {
    expect(auth0Browser.authorizeParams(TRACE_ID)).toEqual({
      "ext-trace_id": TRACE,
    });
  });

  it.effect("passes provider conformance", () =>
    Effect.gen(function* () {
      const exactEvent = {
        id: "auth0_exact",
        provider: "auth0",
        tenant: "acme",
        type: "login_success",
        atMs: 1,
        traceId: TRACE_ID,
        hints: {},
        attributes: {},
      };
      const hintEvent = {
        id: "auth0_hint",
        provider: "auth0",
        tenant: "acme",
        type: "login_failure",
        atMs: 1,
        hints: { userHash: "u_9" },
        attributes: {},
      };

      const report = yield* runProviderConformance(auth0Adapter, {
        settings: { feedSecret: "feed-secret" },
        valid: [
          {
            request: {
              headers: { [AUTH0_FEED_SECRET_HEADER]: "feed-secret" },
            },
            body: {
              logs: [
                log(),
                log({
                  log_id: "2",
                  type: "s",
                  details: { ext_trace_id: TRACE },
                }),
              ],
            },
          },
        ],
        invalid: [{ headers: { [AUTH0_FEED_SECRET_HEADER]: "wrong" } }],
        classify: [
          {
            event: {
              ...hintEvent,
              attributes: { "auth.error.vendor_code": "fp" },
            },
            outcome: "failed",
            errorCode: "invalid_password",
          },
        ],
        pii: ["alice@example.com", "auth0|64f0"],
        exact: [exactEvent],
        hints: [hintEvent],
      });

      expect(report.failures).toEqual([]);
      expect(hashUser("auth0|64f0")).toBe("u_10");
    }),
  );
});
