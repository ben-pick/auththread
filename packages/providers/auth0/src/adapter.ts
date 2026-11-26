import type { ConfigSnapshot, ProviderAdapter } from "@auththread/adapter-kit";
import { ProviderError } from "@auththread/adapter-kit";
import { type ProviderEvent, sha256Hex } from "@auththread/schema";
import { Clock, Effect, Schema } from "effect";
import { auth0Browser } from "./browser.ts";
import {
  AUTH0_FEED_PATH,
  type Auth0FeedSettings,
  classifyAuth0Type,
  parseLogStream,
  verifyLogStream,
} from "./feed.ts";

const vendorCode = (event: ProviderEvent): string => {
  const value = event.attributes["auth.error.vendor_code"];
  return typeof value === "string" ? value : "";
};

const ActionSchema = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  version_id: Schema.optionalKey(Schema.String),
  updated_at: Schema.optionalKey(Schema.String),
});

const ActionsResponseSchema = Schema.Struct({
  actions: Schema.optionalKey(Schema.Array(ActionSchema)),
});

const nowMs = Clock.currentTimeMillis;

const fetchConfig = (
  settings: Auth0FeedSettings,
): Effect.Effect<ConfigSnapshot, ProviderError> =>
  Effect.gen(function* () {
    if (
      settings.domain === undefined ||
      settings.managementToken === undefined
    ) {
      return yield* new ProviderError({
        provider: "auth0",
        message: "auth0 config needs domain and managementToken",
      });
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        globalThis.fetch(
          `https://${settings.domain}/api/v2/actions/actions?per_page=100`,
          { headers: { authorization: `Bearer ${settings.managementToken}` } },
        ),
      catch: (cause) =>
        new ProviderError({
          provider: "auth0",
          message: "auth0 management request failed",
          cause,
        }),
    });
    if (!response.ok)
      return yield* new ProviderError({
        provider: "auth0",
        message: `auth0 management responded ${response.status}`,
      });

    const body = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new ProviderError({
          provider: "auth0",
          message: "auth0 management returned invalid JSON",
          cause,
        }),
    });
    const decoded = yield* Effect.fromResult(
      Schema.decodeUnknownResult(ActionsResponseSchema)(body),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderError({
            provider: "auth0",
            message: `invalid auth0 management response: ${cause.message}`,
          }),
      ),
    );

    const fetchedAt = yield* nowMs;
    const hooks = (decoded.actions ?? []).flatMap((action) => {
      const name = action.name;
      if (name === undefined) return [];
      const updatedAt =
        action.updated_at === undefined
          ? undefined
          : Date.parse(action.updated_at);
      return [
        {
          name,
          version: action.version_id ?? "unknown",
          updatedAt:
            updatedAt === undefined || Number.isNaN(updatedAt)
              ? fetchedAt
              : updatedAt,
        },
      ];
    });

    return {
      provider: "auth0",
      fetchedAt,
      hash: sha256Hex(JSON.stringify(hooks)),
      hooks,
    };
  });

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
