import type { ConfigSnapshot, ProviderAdapter } from "@auththread/adapter-kit";
import {
  type ProviderEvent,
  sha256Hex,
  type TraceId,
} from "@auththread/schema";
import {
  AUTH0_FEED_PATH,
  type Auth0FeedSettings,
  classifyAuth0Type,
  parseLogStream,
  verifyLogStream,
} from "./feed.ts";

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

const vendorCode = (event: ProviderEvent): string => {
  const value = event.attributes["auth.error.vendor_code"];
  return typeof value === "string" ? value : "";
};

async function fetchConfig(
  settings: Auth0FeedSettings,
): Promise<ConfigSnapshot> {
  if (settings.domain === undefined || settings.managementToken === undefined) {
    throw new Error("auth0 config needs domain and managementToken");
  }
  const response = await globalThis.fetch(
    `https://${settings.domain}/api/v2/actions/actions?per_page=100`,
    { headers: { authorization: `Bearer ${settings.managementToken}` } },
  );
  if (!response.ok)
    throw new Error(`auth0 management responded ${response.status}`);

  const body = (await response.json()) as {
    actions?: Array<{
      name?: string;
      version_id?: string;
      updated_at?: string;
    }>;
  };
  const hooks = (body.actions ?? []).flatMap((action) =>
    typeof action.name === "string"
      ? [
          {
            name: action.name,
            version: action.version_id ?? "unknown",
            updatedAt:
              typeof action.updated_at === "string"
                ? Date.parse(action.updated_at)
                : Date.now(),
          },
        ]
      : [],
  );

  return {
    provider: "auth0",
    fetchedAt: Date.now(),
    hash: sha256Hex(JSON.stringify(hooks)),
    hooks,
  };
}

export const auth0Adapter: ProviderAdapter<Auth0FeedSettings> = {
  id: "auth0",
  capabilities: ["browser", "event-feed", "hooks", "hosted-page", "config"],
  authorizeParams: (traceId) => auth0Browser.authorizeParams(traceId),
  feeds: [
    {
      path: AUTH0_FEED_PATH,
      verify: verifyLogStream,
      parse: parseLogStream,
    },
  ],
  correlate: (event) =>
    event.traceId === undefined
      ? { kind: "hints", hints: event.hints }
      : { kind: "exact", traceId: event.traceId },
  classify: (event) => classifyAuth0Type(vendorCode(event)),
  fetchConfig,
};
