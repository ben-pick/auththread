import {
  DEFAULT_SAMPLING,
  type SamplingPolicy,
  SettingsError,
  SettingsStore,
  type Sink,
  staticSettings,
  type TenantSettings,
} from "@auththread/adapter-kit";
import { type Auth0FeedSettings, auth0Adapter } from "@auththread/auth0";
import { oidcAdapter } from "@auththread/oidc";
import { createOtlpExporter } from "@auththread/otlp";
import {
  createJourneyDurableObject,
  createKeyDirectory,
  type DurableObjectStateLike,
  type JourneyDurableObjectInstance,
  type KeyDirectory,
} from "@auththread/runtime-cloudflare";
import { sha256Hex } from "@auththread/schema";
import { createOtlpSink } from "@auththread/sink-otlp";
import { createWideEventSink } from "@auththread/sink-wide-event";
import { Effect, Layer, Option, Schema } from "effect";

export interface Env {
  readonly JOURNEY: DurableObjectNamespace;
  readonly AUTHTHREAD_TENANTS: string;
  readonly AUTHTHREAD_QUIET_MS?: string;
  readonly AUTHTHREAD_SAMPLE_SUCCESS?: string;
  readonly OTLP_ENDPOINT?: string;
  readonly OTLP_HEADERS?: string;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
}

interface DurableObjectId {
  readonly name?: string;
}

const TenantSchema = Schema.Struct({
  tenant: Schema.String.check(Schema.isMinLength(1)),
  provider: Schema.String.check(Schema.isMinLength(1)),
  apiKey: Schema.String.check(Schema.isMinLength(1)),
  salt: Schema.String.check(Schema.isMinLength(8)),
  providerSettings: Schema.optionalKey(Schema.Unknown),
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

const sinksFor = (env: Env): readonly Sink[] => {
  const sampling = samplingOf(env.AUTHTHREAD_SAMPLE_SUCCESS);
  const headers =
    env.OTLP_HEADERS === undefined
      ? {}
      : Option.getOrElse(
          Schema.decodeUnknownOption(HeadersSchema)(env.OTLP_HEADERS),
          () => ({}),
        );

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

export class JourneyDurableObject {
  readonly inner: JourneyDurableObjectInstance;

  constructor(state: unknown, env: Env) {
    const decoded = configFor(env.AUTHTHREAD_TENANTS);
    if (decoded._tag === "Failure")
      throw new Error(`invalid AUTHTHREAD_TENANTS: ${decoded.failure.message}`);

    const tenants: TenantSettings<Auth0FeedSettings>[] =
      decoded.success.tenants.map((tenant) => ({
        tenant: tenant.tenant,
        provider: tenant.provider,
        apiKeyHash: sha256Hex(tenant.apiKey),
        salt: tenant.salt,
        providerSettings:
          (tenant.providerSettings as Auth0FeedSettings | undefined) ?? {},
      }));

    const DurableObject = createJourneyDurableObject({
      providers: [oidcAdapter, auth0Adapter],
      sinks: sinksFor(env),
      settings: Layer.succeed(SettingsStore, staticSettings(tenants)),
      captureBatches: false,
      quietMs: Number(env.AUTHTHREAD_QUIET_MS ?? "600000"),
    });
    this.inner = new DurableObject(state as DurableObjectStateLike);
  }

  fetch(request: Request): Promise<Response> {
    return this.inner.fetch(request);
  }

  alarm(): Promise<void> {
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

let cached: { source: string; directory: KeyDirectory } | null = null;

const directoryFor = (
  source: string,
): Effect.Effect<KeyDirectory, SettingsError> =>
  Effect.gen(function* () {
    if (cached?.source === source) return cached.directory;
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
    cached = { source, directory };
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
