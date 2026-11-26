import type {
  FeedError,
  FeedRequest,
  ParseContext,
} from "@auththread/adapter-kit";
import {
  isTraceId,
  type Outcome,
  type ProviderEvent,
} from "@auththread/schema";
import { Effect, Option, Schema } from "effect";

export interface Auth0FeedSettings {
  /** Auth0 log stream custom header value. Without it, every feed request is rejected. */
  readonly feedSecret?: string;
  readonly domain?: string;
  readonly managementToken?: string;
}

export const AUTH0_FEED_PATH = "/log-stream";
export const AUTH0_FEED_SECRET_HEADER = "x-auththread-feed-secret";

const NEUTRAL_TYPE: Record<string, string> = {
  s: "login_success",
  ss: "signup_success",
  slo: "logout_success",
  f: "login_failure",
  fp: "login_failure",
  fu: "signup_failure",
  fco: "login_failure",
  flk: "login_failure",
  fsa: "login_failure",
  fs: "login_failure",
  limit_mu: "rate_limited",
  limit_wc: "rate_limited",
  gd: "token_exchange",
};

const ERROR_CODE: Record<string, string> = {
  f: "login_failed",
  fp: "invalid_password",
  fu: "signup_failed",
  fco: "invalid_connection",
  flk: "account_locked",
  fsa: "too_many_attempts",
  fs: "invalid_signup",
  limit_mu: "rate_limited",
  limit_wc: "rate_limited",
};

const LogEntrySchema = Schema.Struct({
  log_id: Schema.optionalKey(Schema.String),
  date: Schema.String,
  type: Schema.String,
  user_id: Schema.optionalKey(Schema.String),
  client_id: Schema.optionalKey(Schema.String),
  connection: Schema.optionalKey(Schema.String),
  details: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

const EnvelopeSchema = Schema.Struct({
  log_id: Schema.optionalKey(Schema.String),
  data: Schema.Unknown,
});

const entriesOf = (body: unknown): readonly unknown[] => {
  const array = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown))(body);
  if (Option.isSome(array)) return array.value;

  const logs = Schema.decodeUnknownOption(
    Schema.Struct({ logs: Schema.Array(Schema.Unknown) }),
  )(body);
  if (Option.isSome(logs)) return logs.value.logs;

  return [body];
};

const readTraceId = (details: Record<string, unknown>) => {
  for (const key of ["ext-trace_id", "ext_trace_id", "trace_id"]) {
    const value = details[key];
    if (typeof value === "string" && isTraceId(value)) return value;
  }
  return undefined;
};

const eventOf = (
  entry: typeof LogEntrySchema.Type,
  traceId: ReturnType<typeof readTraceId>,
  context: ParseContext,
): ProviderEvent[] => {
  const atMs = Date.parse(entry.date);
  if (Number.isNaN(atMs)) return [];

  const details = entry.details ?? {};
  const userId = entry.user_id;
  const clientId = entry.client_id;
  const connection = entry.connection;
  const transactionId =
    typeof details.transaction_id === "string"
      ? details.transaction_id
      : undefined;
  const neutral = NEUTRAL_TYPE[entry.type] ?? "provider_event";
  const kind = neutral.startsWith("signup_") ? "signup" : undefined;
  const logId = entry.log_id;
  if (logId === undefined) return [];

  return [
    {
      id: `auth0_${logId}`,
      provider: "auth0",
      tenant: "",
      type: neutral,
      atMs,
      ...(traceId === undefined ? {} : { traceId }),
      hints: {
        ...(userId === undefined ? {} : { userHash: context.hashUser(userId) }),
        ...(clientId === undefined ? {} : { clientId }),
      },
      attributes: {
        "auth.provider": "auth0",
        ...(kind === undefined ? {} : { "auth.journey.kind": kind }),
        ...(clientId === undefined ? {} : { "auth.client_id": clientId }),
        ...(connection === undefined
          ? {}
          : { "auth.method.vendor_name": connection }),
        ...(transactionId === undefined
          ? {}
          : { "auth.transaction.id": transactionId }),
        ...(userId === undefined
          ? {}
          : { "auth.user.hash": context.hashUser(userId) }),
        "auth.error.vendor_code": entry.type,
        ...(neutral.includes("failure")
          ? { "auth.error.source": "provider" }
          : {}),
      },
    },
  ];
};

const decodeEntry = (raw: unknown): typeof LogEntrySchema.Type | undefined => {
  const envelope = Schema.decodeUnknownOption(EnvelopeSchema)(raw);
  if (Option.isSome(envelope)) {
    const inner = Schema.decodeUnknownOption(LogEntrySchema)(
      envelope.value.data,
    );
    if (Option.isSome(inner)) {
      const logId = inner.value.log_id ?? envelope.value.log_id;
      return {
        ...inner.value,
        ...(logId === undefined ? {} : { log_id: logId }),
      };
    }
  }
  const direct = Schema.decodeUnknownOption(LogEntrySchema)(raw);
  return Option.isSome(direct) ? direct.value : undefined;
};

export const parseLogStream = (
  body: unknown,
  context: ParseContext,
): Effect.Effect<ProviderEvent[], FeedError> =>
  Effect.sync(() => {
    const events: ProviderEvent[] = [];
    for (const raw of entriesOf(body)) {
      const entry = decodeEntry(raw);
      if (entry === undefined) continue;
      const details = entry.details ?? {};
      const traceId = readTraceId(details);
      events.push(...eventOf(entry, traceId, context));
    }
    return events;
  });

export const verifyLogStream = (
  request: FeedRequest,
  settings: Auth0FeedSettings,
): Effect.Effect<boolean, FeedError> =>
  Effect.succeed(
    settings.feedSecret !== undefined &&
      settings.feedSecret.length > 0 &&
      request.headers[AUTH0_FEED_SECRET_HEADER] === settings.feedSecret,
  );

export function classifyAuth0Type(code: string): {
  outcome?: Outcome;
  errorCode?: string;
} {
  const neutral = NEUTRAL_TYPE[code] ?? "";
  const outcome: Outcome | undefined = neutral.includes("success")
    ? "success"
    : neutral.includes("failure") || neutral === "rate_limited"
      ? "failed"
      : undefined;
  return {
    ...(outcome === undefined ? {} : { outcome }),
    ...(ERROR_CODE[code] === undefined ? {} : { errorCode: ERROR_CODE[code] }),
  };
}
