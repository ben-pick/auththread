import type { TraceId } from "@auththread/schema";

export interface Auth0Browser {
  readonly id: string;
  authorizeParams(traceId: TraceId): Record<string, string>;
}

/**
 * Auth0 accepts custom authorize params prefixed ext- and keeps them on the
 * authorization request, where a Universal Login template can read them.
 */
export const auth0Browser: Auth0Browser = {
  id: "auth0",
  authorizeParams: (traceId) => ({ "ext-trace_id": traceId }),
};
