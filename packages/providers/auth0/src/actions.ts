import {
  isTraceId,
  parseTraceId,
  rootSpanId,
  sha256Hex,
} from "@auththread/schema";

export interface ActionTraceOptions {
  readonly name: string;
  readonly version: string;
  readonly transport?: "console" | "http";
  readonly endpoint?: string;
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface Recorded {
  readonly calls: string[];
  readonly claims: string[];
  denied: boolean;
  redirect: string | null;
  challenge: boolean;
}

const record = (): Recorded => ({
  calls: [],
  claims: [],
  denied: false,
  redirect: null,
  challenge: false,
});

const proxied = <T extends object>(target: T, recorded: Recorded): T =>
  new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property);
      if (typeof property !== "string") return value;

      if (typeof value === "object" && value !== null) {
        return proxied(value as object, recorded);
      }

      if (typeof value !== "function") return value;

      return (...args: unknown[]) => {
        recorded.calls.push(property);
        if (property === "deny") recorded.denied = true;
        if (property === "sendUserTo") {
          recorded.redirect =
            typeof args[0] === "string" ? args[0] : "redirect";
        }
        if (property === "setCustomClaim" && typeof args[0] === "string") {
          recorded.claims.push(args[0]);
        }
        if (property === "enable" || property === "challengeWithAny")
          recorded.challenge = true;
        return value.apply(object, args);
      };
    },
  });

const traceIdOf = (event: unknown) => {
  const candidate = event as {
    request?: { query?: Record<string, unknown> };
    transaction?: { params?: Record<string, unknown> };
  };
  const query = candidate.request?.query ?? {};
  const params = candidate.transaction?.params ?? {};
  const raw =
    query["ext-trace_id"] ??
    query.ext_trace_id ??
    params["ext-trace_id"] ??
    params.ext_trace_id;
  return typeof raw === "string" && isTraceId(raw)
    ? parseTraceId(raw)
    : undefined;
};

const decision = (recorded: Recorded): string => {
  if (recorded.denied) return "deny";
  if (recorded.redirect !== null) return "redirect";
  if (recorded.challenge) return "challenge";
  return "continue";
};

const errorText = (error: unknown): string =>
  error instanceof Error
    ? `${error.name}: ${error.message}`.slice(0, 200)
    : "unknown error";

/**
 * Wraps an Auth0 Action so its run becomes one auth.hook.execute span. The
 * handler's result and errors are unchanged. The transport never throws.
 */
export function withTrace<Event, Api, Result>(
  options: ActionTraceOptions,
  handler: (event: Event, api: Api) => Promise<Result> | Result,
): (event: Event, api: Api) => Promise<Result> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 250;

  return async (event, api) => {
    const recorded = record();
    const startedAt = Date.now();
    let result: Result | undefined;
    let failure: unknown;

    try {
      result = await handler(event, proxied(api as object, recorded) as Api);
    } catch (error) {
      failure = error;
    }

    const traceId = traceIdOf(event);
    const payload = {
      traceId: traceId ?? null,
      hook: { name: options.name, version: options.version },
      startedAt,
      durationMs: Date.now() - startedAt,
      decision: decision(recorded),
      claims: recorded.claims,
      calls: recorded.calls,
      error: failure === undefined ? null : errorText(failure),
    };

    try {
      if (
        options.transport === "http" &&
        traceId !== undefined &&
        options.endpoint !== undefined
      ) {
        const span = {
          traceId,
          spanId: sha256Hex(
            `hook:${traceId}:${options.name}:${startedAt}`,
          ).slice(0, 16),
          parentSpanId: rootSpanId(traceId),
          name: "auth.hook.execute",
          startMs: startedAt,
          durationMs: Date.now() - startedAt,
          attributes: {
            "auth.provider": "auth0",
            "auth.hook.name": options.name,
            "auth.hook.type": "auth0.action",
            "auth.hook.version": options.version,
            "auth.hook.stage": "post_auth",
            "auth.hook.decision": decision(recorded),
            ...(recorded.claims.length === 0
              ? {}
              : { "auth.hook.claims_set": recorded.claims }),
            ...(failure === undefined
              ? {}
              : {
                  "auth.error.code": "hook_error",
                  "auth.error.source": "hook",
                }),
          },
          status:
            failure === undefined
              ? { code: "ok" }
              : { code: "error", message: errorText(failure) },
        };

        await fetchImpl(
          `${options.endpoint.replace(/\/$/, "")}/v1/compact-spans`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(options.token === undefined
                ? {}
                : { authorization: `Bearer ${options.token}` }),
            },
            body: JSON.stringify({ spans: [span] }),
            signal: AbortSignal.timeout(timeoutMs),
          },
        );
      } else if (options.transport !== "http") {
        console.log(JSON.stringify({ event: "auth.hook", ...payload }));
      }
    } catch {
      // Never in the login path: a missing stitcher must not fail the Action.
    }

    if (failure !== undefined) throw failure;
    return result as Result;
  };
}
