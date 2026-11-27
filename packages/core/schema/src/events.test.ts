import { describe, expect, it } from "vitest";
import {
  isSignupEventType,
  outcomeOfProviderEvent,
  PROVIDER_EVENT_TYPES,
} from "./attributes.ts";

describe("provider event types", () => {
  it("maps neutral event types to terminal outcomes", () => {
    expect(outcomeOfProviderEvent("login_success")).toBe("success");
    expect(outcomeOfProviderEvent("signup_success")).toBe("success");
    expect(outcomeOfProviderEvent("login_failure")).toBe("failed");
    expect(outcomeOfProviderEvent("signup_failure")).toBe("failed");
    expect(outcomeOfProviderEvent("rate_limited")).toBe("failed");
    expect(outcomeOfProviderEvent("logout_success")).toBeUndefined();
    expect(outcomeOfProviderEvent("token_exchange")).toBeUndefined();
    expect(outcomeOfProviderEvent("provider_event")).toBeUndefined();
  });

  it("identifies signup events for kind derivation", () => {
    expect(isSignupEventType("signup_success")).toBe(true);
    expect(isSignupEventType("signup_failure")).toBe(true);
    expect(isSignupEventType("login_success")).toBe(false);
  });

  it("keeps the vocabulary closed", () => {
    expect(PROVIDER_EVENT_TYPES).toContain("provider_event");
    expect(new Set(PROVIDER_EVENT_TYPES).size).toBe(
      PROVIDER_EVENT_TYPES.length,
    );
  });
});
