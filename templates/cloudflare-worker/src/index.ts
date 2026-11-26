import {
  DEFAULT_SAMPLING,
  type SamplingPolicy,
  type Sink,
} from "@auththread/adapter-kit";
import { auth0Adapter } from "@auththread/auth0";
import { oidcAdapter } from "@auththread/oidc";
import { createOtlpExporter } from "@auththread/otlp";
import {
  type CloudflareEnv,
  createCloudflareRuntime,
} from "@auththread/sdk/cloudflare";
import { createOtlpSink } from "@auththread/sink-otlp";
import { createWideEventSink } from "@auththread/sink-wide-event";

export interface Env extends CloudflareEnv {
  readonly AUTHTHREAD_SAMPLE_SUCCESS?: string;
}

const sampling = (env: Env): SamplingPolicy => {
  const raw = Number(env.AUTHTHREAD_SAMPLE_SUCCESS ?? "0.1");
  return {
    ...DEFAULT_SAMPLING,
    successRate: Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0.1,
  };
};

const sinks = (env: Env): Sink[] => {
  const policy = sampling(env);
  return [
    createWideEventSink({ sampling: policy }),
    ...(env.OTLP_ENDPOINT === undefined
      ? []
      : [
          createOtlpSink({
            sampling: policy,
            exporter: createOtlpExporter({
              endpoint: env.OTLP_ENDPOINT,
              serviceName: "auththread",
              headers:
                env.OTLP_HEADERS === undefined
                  ? {}
                  : (JSON.parse(env.OTLP_HEADERS) as Record<string, string>),
            }),
          }),
        ]),
  ];
};

const runtime = createCloudflareRuntime({
  providers: [oidcAdapter, auth0Adapter],
  sinks,
  quietMs: (env) => Number(env.AUTHTHREAD_QUIET_MS ?? "600000"),
});

export const JourneyDurableObject = runtime.JourneyDurableObject;
export default { fetch: runtime.fetch };
