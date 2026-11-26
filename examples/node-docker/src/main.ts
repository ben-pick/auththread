import {
  DEFAULT_SAMPLING,
  memoryBufferLayer,
  memorySchedulerLayer,
  type SamplingPolicy,
  SettingsError,
  type Sink,
} from "@auththread/adapter-kit";
import { auth0Adapter } from "@auththread/auth0";
import { oidcAdapter } from "@auththread/oidc";
import { createOtlpExporter } from "@auththread/otlp";
import {
  fileSettingsLayer,
  nodeServerLayer,
  sqliteStoreLayer,
} from "@auththread/runtime-node";
import { createOtlpSink } from "@auththread/sink-otlp";
import { createWebhookSink } from "@auththread/sink-webhook";
import { createWideEventSink } from "@auththread/sink-wide-event";
import { stitcherLayer } from "@auththread/stitcher";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Effect, Layer, Option, Schema } from "effect";

interface Env {
  readonly port: number;
  readonly quietMs: number;
  readonly configPath: string;
  readonly dbPath: string | undefined;
  readonly sampling: SamplingPolicy;
  readonly otlpEndpoint: string | undefined;
  readonly otlpHeaders: Readonly<Record<string, string>>;
  readonly webhookUrl: string | undefined;
  readonly webhookSecret: string | undefined;
}

const HeadersSchema = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.String),
);

const optionalString = (name: string) =>
  Config.String(name).pipe(Config.option, Effect.map(Option.getOrUndefined));

const loadEnv = Effect.gen(function* () {
  const port = yield* Config.Port("PORT").pipe(Config.withDefault(8787));
  const quietMs = yield* Config.Number("AUTHTHREAD_QUIET_MS").pipe(
    Config.withDefault(600_000),
  );
  const configPath = yield* Config.String("AUTHTHREAD_CONFIG").pipe(
    Config.withDefault("/etc/auththread/config.json"),
  );
  const dbPath = yield* optionalString("AUTHTHREAD_DB");
  const sampleSuccess = yield* Config.Number("AUTHTHREAD_SAMPLE_SUCCESS").pipe(
    Config.withDefault(0.1),
  );
  const otlpEndpoint = yield* optionalString("OTLP_ENDPOINT");
  const otlpHeadersRaw = yield* Config.String("OTLP_HEADERS").pipe(
    Config.withDefault("{}"),
  );
  const webhookUrl = yield* optionalString("WEBHOOK_URL");
  const webhookSecret = yield* optionalString("WEBHOOK_SECRET");

  const otlpHeaders = yield* Effect.fromResult(
    Schema.decodeUnknownResult(HeadersSchema)(otlpHeadersRaw),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new SettingsError({
          message: `OTLP_HEADERS is not a JSON object: ${cause.message}`,
        }),
    ),
  );

  const sampling: SamplingPolicy = {
    ...DEFAULT_SAMPLING,
    successRate: Number.isFinite(sampleSuccess)
      ? Math.min(Math.max(sampleSuccess, 0), 1)
      : 0.1,
  };

  return {
    port,
    quietMs,
    configPath,
    dbPath,
    sampling,
    otlpEndpoint,
    otlpHeaders,
    webhookUrl,
    webhookSecret,
  } satisfies Env;
});

const sinksFor = (env: Env): readonly Sink[] => {
  const sinks: Sink[] = [createWideEventSink({ sampling: env.sampling })];

  if (env.otlpEndpoint !== undefined) {
    sinks.push(
      createOtlpSink({
        sampling: env.sampling,
        exporter: createOtlpExporter({
          endpoint: env.otlpEndpoint,
          serviceName: "auththread",
          headers: env.otlpHeaders,
        }),
      }),
    );
  }

  if (env.webhookUrl !== undefined && env.webhookSecret !== undefined) {
    sinks.push(
      createWebhookSink({
        url: env.webhookUrl,
        secret: env.webhookSecret,
        sampling: env.sampling,
      }),
    );
  }

  return sinks;
};

const program = Effect.gen(function* () {
  const env = yield* loadEnv;

  const stores =
    env.dbPath === undefined
      ? Layer.mergeAll(memoryBufferLayer, memorySchedulerLayer)
      : sqliteStoreLayer({ path: env.dbPath, quietMs: env.quietMs });

  const http = nodeServerLayer({ port: env.port }).pipe(
    Layer.provide(
      stitcherLayer({
        providers: [oidcAdapter, auth0Adapter],
        sinks: sinksFor(env),
        quietMs: env.quietMs,
        onError: (error) => Effect.logError("auththread", error),
      }).pipe(
        Layer.provide(stores),
        Layer.provide(fileSettingsLayer(env.configPath)),
      ),
    ),
  );

  return yield* Layer.launch(http);
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
