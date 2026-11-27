import type { ProviderAdapter } from "@auththread/adapter-kit";
import {
  type Outcome,
  outcomeOfProviderEvent,
  type ProviderEvent,
} from "@auththread/schema";
import { Option, Schema } from "effect";

const classify = (
  event: ProviderEvent,
): { outcome?: Outcome; errorCode?: string } => {
  const outcome = outcomeOfProviderEvent(event.type);
  const vendorCode = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.String)(
      event.attributes["auth.error.vendor_code"],
    ),
  );
  return {
    ...(outcome === undefined ? {} : { outcome }),
    ...(vendorCode === undefined ? {} : { errorCode: vendorCode }),
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
