import { DurableObject } from "cloudflare:workers";
import {
  DEFAULT_SAMPLING,
  type SamplingPolicy,
  SettingsError,
  SettingsStore,
  type Sink,
  staticSettings,
  type TenantSettings,
} from "@auththread/adapter-kit";
import {
  type Auth0FeedSettings,
  Auth0FeedSettingsSchema,
  auth0Adapter,
} from "@auththread/auth0";
import { oidcAdapter } from "@auththread/oidc";
import { createOtlpExporter } from "@auththread/otlp";
import {
  createJourneyDurableObject,
  createKeyDirectory,
  type JourneyDurableObjectInstance,
  type KeyDirectory,
} from "@auththread/runtime-cloudflare";
import { sha256Hex } from "@auththread/schema";
import { createOtlpSink } from "@auththread/sink-otlp";
import { createWideEventSink } from "@auththread/sink-wide-event";
import { Effect, Layer, Schema } from "effect";

const TenantSchema = Schema.Struct({
  tenant: Schema.String.check(Schema.isMinLength(1)),
  provider: Schema.String.check(Schema.isMinLength(1)),
  apiKey: Schema.String.check(Schema.isMinLength(1)),
  salt: Schema.String.check(Schema.isMinLength(8)),
  providerSettings: Schema.optionalKey(Auth0FeedSettingsSchema),
});

const TenantConfigSchema = Schema.fromJsonString(
  Schema.Struct({ tenants: Schema.Array(TenantSchema) }),
);

const HeadersSchema = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.String),
);

const configFor = (source: string) =>
  Schema.decodeUnknownResult(TenantConfigSchema)(source);

const samplingOf = (raw: string | undefined): SamplingPolicy => {
  const parsed = Number(raw ?? "0.1");
  return {
    ...DEFAULT_SAMPLING,
    successRate: Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 0), 1)
      : 0.1,
  };
};

const onError = (error: unknown): Effect.Effect<void> =>
  Effect.logError(
    JSON.stringify({
      message: "auththread runtime error",
      error: error instanceof Error ? error.message : String(error),
    }),
  );

const sinksFor = (env: Env): readonly Sink[] => {
  const sampling = samplingOf(env.AUTHTHREAD_SAMPLE_SUCCESS);
  const headers =
    env.OTLP_HEADERS === undefined
      ? {}
      : Schema.decodeUnknownSync(HeadersSchema)(env.OTLP_HEADERS);

  return [
    createWideEventSink({ sampling }),
    ...(env.OTLP_ENDPOINT === undefined
      ? []
      : [
          createOtlpSink({
            sampling,
            exporter: createOtlpExporter({
              endpoint: env.OTLP_ENDPOINT,
              serviceName: "auththread",
              headers,
            }),
          }),
        ]),
  ];
};

export class JourneyDurableObject extends DurableObject<Env> {
  readonly inner: JourneyDurableObjectInstance;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);

    const decoded = configFor(env.AUTHTHREAD_TENANTS);
    // The Worker validates the same config before routing. An invalid value
    // leaves this object with no tenants instead of throwing in a constructor.
    const tenants: TenantSettings<Auth0FeedSettings>[] =
      decoded._tag === "Success"
        ? decoded.success.tenants.map((tenant) => ({
            tenant: tenant.tenant,
            provider: tenant.provider,
            apiKeyHash: sha256Hex(tenant.apiKey),
            salt: tenant.salt,
            providerSettings: tenant.providerSettings ?? {},
          }))
        : [];

    const JourneyRuntime = createJourneyDurableObject({
      providers: [oidcAdapter, auth0Adapter],
      sinks: sinksFor(env),
      settings: Layer.succeed(SettingsStore, staticSettings(tenants)),
      captureBatches: false,
      quietMs: Number(env.AUTHTHREAD_QUIET_MS ?? "600000"),
      onError,
    });
    this.inner = new JourneyRuntime(state);
  }

  override fetch(request: Request): Promise<Response> {
    return this.inner.fetch(request);
  }

  override alarm(): Promise<void> {
    return this.inner.alarm();
  }
}

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers":
    "authorization, content-type, x-auththread-key",
  "access-control-max-age": "86400",
};

let cached: { sourceHash: string; directory: KeyDirectory } | null = null;

const directoryFor = (
  source: string,
): Effect.Effect<KeyDirectory, SettingsError> =>
  Effect.gen(function* () {
    const sourceHash = sha256Hex(source);
    if (cached?.sourceHash === sourceHash) return cached.directory;

    const decoded = configFor(source);
    if (decoded._tag === "Failure")
      return yield* new SettingsError({
        message: `invalid AUTHTHREAD_TENANTS: ${decoded.failure.message}`,
      });

    const directory = yield* createKeyDirectory(
      decoded.success.tenants.map((tenant) => ({
        tenant: tenant.tenant,
        apiKey: tenant.apiKey,
      })),
    );
    cached = { sourceHash, directory };
    return directory;
  });

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return Effect.runPromise(
      Effect.gen(function* () {
        if (request.method === "OPTIONS") {
          return new Response(null, { status: 204, headers: CORS });
        }
        if (new URL(request.url).pathname === "/healthz") {
          return Response.json({ ok: true });
        }

        return yield* Effect.gen(function* () {
          const directory = yield* directoryFor(env.AUTHTHREAD_TENANTS);
          const tenant = yield* directory.resolve(request);
          if (tenant === null)
            return Response.json(
              { error: "unauthorized" },
              { status: 401, headers: CORS },
            );

          const id = env.JOURNEY.idFromName(tenant);
          return yield* Effect.tryPromise({
            try: () => env.JOURNEY.get(id).fetch(request),
            catch: (cause) =>
              new SettingsError({
                message:
                  "the journey Durable Object could not serve the request",
                cause,
              }),
          });
        }).pipe(
          Effect.catchCause(() =>
            Effect.succeed(
              Response.json(
                { error: "internal" },
                { status: 500, headers: CORS },
              ),
            ),
          ),
        );
      }),
    );
  },
};
