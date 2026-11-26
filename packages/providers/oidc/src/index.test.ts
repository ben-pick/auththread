import { runProviderConformance } from "@auththread/adapter-kit";
import { parseTraceId } from "@auththread/schema";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { oidcAdapter } from "./index.ts";

const event = (over: Partial<Parameters<typeof oidcAdapter.classify>[0]>) => ({
  id: "e1",
  provider: "oidc",
  tenant: "acme",
  type: "login_success",
  atMs: 1,
  hints: {},
  attributes: {},
  ...over,
});

describe("oidc adapter", () => {
  it.effect("passes provider conformance", () =>
    Effect.gen(function* () {
      const report = yield* runProviderConformance(oidcAdapter, {
        settings: {},
        valid: [],
        invalid: [],
        classify: [
          { event: event({ type: "login_success" }), outcome: "success" },
          { event: event({ type: "login_failure" }), outcome: "failed" },
        ],
        pii: [],
        exact: [event({ traceId: parseTraceId("a".repeat(32)) })],
        hints: [event({})],
      });
      expect(report.failures).toEqual([]);
    }),
  );

  it("adds no authorize params, because the state round trip carries the trace", () => {
    expect(oidcAdapter.authorizeParams(parseTraceId("a".repeat(32)))).toEqual(
      {},
    );
  });
});
