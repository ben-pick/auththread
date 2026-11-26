export type { BrowserProvider } from "./browser.ts";
export { oidcBrowser } from "./browser.ts";

import type { ProviderAdapter } from "@auththread/adapter-kit";
import type { Outcome, ProviderEvent } from "@auththread/schema";

const OUTCOMES: Record<string, Outcome> = {
  login_success: "success",
  signup_success: "success",
  login_failure: "failed",
  signup_failure: "failed",
};

const classify = (
  event: ProviderEvent,
): { outcome?: Outcome; errorCode?: string } => {
  const outcome = OUTCOMES[event.type];
  const vendorCode = event.attributes["auth.error.vendor_code"];
  return {
    ...(outcome === undefined ? {} : { outcome }),
    ...(typeof vendorCode === "string" ? { errorCode: vendorCode } : {}),
  };
};

export const oidcAdapter: ProviderAdapter<Record<string, never>> = {
  id: "oidc",
  capabilities: ["browser"],
  authorizeParams: () => ({}),
  correlate: (event) =>
    event.traceId === undefined
      ? { kind: "hints", hints: event.hints }
      : { kind: "exact", traceId: event.traceId },
  classify,
};
