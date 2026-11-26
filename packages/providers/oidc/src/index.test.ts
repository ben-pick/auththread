import { runProviderConformance } from "@auththread/adapter-kit";
import { parseTraceId } from "@auththread/schema";
import { describe, expect, it } from "vitest";
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
  it("passes provider conformance", async () => {
    const report = await runProviderConformance(oidcAdapter, {
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
  });

  it("adds no authorize params, because the state round trip carries the trace", () => {
    expect(oidcAdapter.authorizeParams(parseTraceId("a".repeat(32)))).toEqual(
      {},
    );
  });
});
