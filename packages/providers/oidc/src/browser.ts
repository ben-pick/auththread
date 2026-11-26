import type { TraceId } from "@auththread/schema";

export interface BrowserProvider {
  readonly id: string;
  authorizeParams(traceId: TraceId): Record<string, string>;
}

/** Any OIDC client: no extra authorize params, the browser SDK keys the journey on its state. */
export const oidcBrowser: BrowserProvider = {
  id: "oidc",
  authorizeParams: () => ({}),
};
