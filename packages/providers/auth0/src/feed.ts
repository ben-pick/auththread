import type { FeedRequest, ParseContext } from "@auththread/adapter-kit";
import {
  isTraceId,
  type Outcome,
  type ProviderEvent,
  parseTraceId,
} from "@auththread/schema";

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const logsOf = (body: unknown): Record<string, unknown>[] => {
  if (Array.isArray(body)) return body.filter(isRecord);
  if (!isRecord(body)) return [];
  if (Array.isArray(body.logs)) return body.logs.filter(isRecord);
  return [body];
};

const readTraceId = (details: Record<string, unknown>) => {
  for (const key of ["ext-trace_id", "ext_trace_id", "trace_id"]) {
    const value = details[key];
    if (typeof value === "string" && isTraceId(value))
      return parseTraceId(value);
  }
  return undefined;
};

export function parseLogStream(
  body: unknown,
  context: ParseContext,
): ProviderEvent[] {
  return logsOf(body).flatMap((raw): ProviderEvent[] => {
    const log = isRecord(raw.data)
      ? {
          ...raw.data,
          log_id:
            typeof raw.data.log_id === "string" ? raw.data.log_id : raw.log_id,
        }
      : raw;
    const logId = log.log_id;
    const date = log.date;
    const type = log.type;
    if (
      typeof logId !== "string" ||
      typeof date !== "string" ||
      typeof type !== "string"
    ) {
      return [];
    }
    const atMs = Date.parse(date);
    if (Number.isNaN(atMs)) return [];

    const details = isRecord(log.details) ? log.details : {};
    const userId = typeof log.user_id === "string" ? log.user_id : undefined;
    const clientId =
      typeof log.client_id === "string" ? log.client_id : undefined;
    const connection =
      typeof log.connection === "string" ? log.connection : undefined;
    const transactionId =
      typeof details.transaction_id === "string"
        ? details.transaction_id
        : undefined;
    const neutral = NEUTRAL_TYPE[type] ?? "provider_event";
    const kind = neutral.startsWith("signup_") ? "signup" : undefined;
    const traceId = readTraceId(details);

    return [
      {
        id: `auth0_${logId}`,
        provider: "auth0",
        tenant: "",
        type: neutral,
        atMs,
        ...(traceId === undefined ? {} : { traceId }),
        hints: {
          ...(userId === undefined
            ? {}
            : { userHash: context.hashUser(userId) }),
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
          "auth.error.vendor_code": type,
          ...(neutral.includes("failure")
            ? { "auth.error.source": "provider" }
            : {}),
        },
      },
    ];
  });
}

export function verifyLogStream(
  request: FeedRequest,
  settings: Auth0FeedSettings,
): boolean {
  if (settings.feedSecret === undefined || settings.feedSecret.length === 0)
    return false;
  return request.headers[AUTH0_FEED_SECRET_HEADER] === settings.feedSecret;
}

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
