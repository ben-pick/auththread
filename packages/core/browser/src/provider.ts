import type { TraceId } from "@auththread/schema";

export interface BrowserProvider {
  readonly id: string;
  authorizeParams(traceId: TraceId): Record<string, string>;
}
