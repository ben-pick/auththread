import { readFileSync } from "node:fs";
import {
  DEFAULT_SAMPLING,
  type SamplingPolicy,
  type Sink,
} from "@auththread/adapter-kit";
import { auth0Adapter } from "@auththread/auth0";
import { parseTenantConfig } from "@auththread/config";
import { oidcAdapter } from "@auththread/oidc";
import { createOtlpExporter } from "@auththread/otlp";
import { createNodeRuntime } from "@auththread/runtime-node";
import {
  createObjectStoreSink,
  createS3Store,
} from "@auththread/sink-object-store";
import { createOtlpSink } from "@auththread/sink-otlp";
import { createWebhookSink } from "@auththread/sink-webhook";
import { createWideEventSink } from "@auththread/sink-wide-event";

const env = (name: string): string | undefined => process.env[name];

const configSource = (): unknown => {
  const value = env("AUTHTHREAD_CONFIG") ?? "/etc/auththread/config.json";
  const trimmed = value.trim();
  const raw = trimmed.startsWith("{") ? trimmed : readFileSync(value, "utf8");
  return JSON.parse(raw) as unknown;
};

const sampling = (): SamplingPolicy => {
  const raw = Number(env("AUTHTHREAD_SAMPLE_SUCCESS") ?? "0.1");
  const successRate = Number.isFinite(raw)
    ? Math.min(Math.max(raw, 0), 1)
    : 0.1;
  return { ...DEFAULT_SAMPLING, successRate };
};

const sinks = (): Sink[] => {
  const policy = sampling();
  const all: Sink[] = [createWideEventSink({ sampling: policy })];

  const otlp = env("OTLP_ENDPOINT");
  if (otlp !== undefined) {
    all.push(
      createOtlpSink({
        sampling: policy,
        exporter: createOtlpExporter({
          endpoint: otlp,
          serviceName: env("OTEL_SERVICE_NAME") ?? "auththread",
          headers:
            env("OTLP_HEADERS") === undefined
              ? {}
              : (JSON.parse(env("OTLP_HEADERS") ?? "{}") as Record<
                  string,
                  string
                >),
        }),
      }),
    );
  }

  const webhook = env("WEBHOOK_URL");
  const secret = env("WEBHOOK_SECRET");
  if (webhook !== undefined && secret !== undefined) {
    all.push(createWebhookSink({ url: webhook, secret, sampling: policy }));
  }

  const s3 = {
    endpoint: env("AUTHTHREAD_S3_ENDPOINT"),
    region: env("AUTHTHREAD_S3_REGION"),
    bucket: env("AUTHTHREAD_S3_BUCKET"),
    accessKeyId: env("AUTHTHREAD_S3_ACCESS_KEY_ID"),
    secretAccessKey: env("AUTHTHREAD_S3_SECRET_ACCESS_KEY"),
  };
  if (
    s3.endpoint !== undefined &&
    s3.region !== undefined &&
    s3.bucket !== undefined &&
    s3.accessKeyId !== undefined &&
    s3.secretAccessKey !== undefined
  ) {
    all.push(
      createObjectStoreSink({
        sampling: policy,
        store: createS3Store({
          endpoint: s3.endpoint,
          region: s3.region,
          bucket: s3.bucket,
          accessKeyId: s3.accessKeyId,
          secretAccessKey: s3.secretAccessKey,
          forcePathStyle: env("AUTHTHREAD_S3_FORCE_PATH_STYLE") === "true",
        }),
        prefix: env("AUTHTHREAD_S3_PREFIX") ?? "auththread",
        onError: (error) => console.error("auththread object store:", error),
      }),
    );
  }

  return all;
};

const config = parseTenantConfig(configSource());
const dbPath = env("AUTHTHREAD_DB");

const runtime = createNodeRuntime({
  config,
  providers: [oidcAdapter, auth0Adapter],
  sinks: sinks(),
  storage:
    dbPath === undefined
      ? { type: "memory" }
      : { type: "sqlite", path: dbPath },
  ...(env("AUTHTHREAD_QUIET_MS") === undefined
    ? {}
    : { quietMs: Number(env("AUTHTHREAD_QUIET_MS")) }),
  ...(env("AUTHTHREAD_CORRELATION_WINDOW_MS") === undefined
    ? {}
    : {
        correlationWindowMs: Number(env("AUTHTHREAD_CORRELATION_WINDOW_MS")),
      }),
  ...(env("AUTHTHREAD_TTL_MS") === undefined
    ? {}
    : { ttlMs: Number(env("AUTHTHREAD_TTL_MS")) }),
  onError: (error) => console.error("auththread:", error),
});

const port = Number(env("PORT") ?? "8787");
const { port: bound } = await runtime.listen(port);
console.log(`auththread listening on :${bound}`);

let closing = false;
const stop = (): void => {
  if (closing) return;
  closing = true;
  void runtime.close().then(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
