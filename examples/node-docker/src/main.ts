import type { Sink } from "@auththread/adapter-kit";
import { auth0Adapter } from "@auththread/auth0";
import { oidcAdapter } from "@auththread/oidc";
import { createOtlpExporter } from "@auththread/otlp";
import { createFileSettings, createNodeServer } from "@auththread/runtime-node";
import { createOtlpSink } from "@auththread/sink-otlp";
import { createWebhookSink } from "@auththread/sink-webhook";
import { createWideEventSink } from "@auththread/sink-wide-event";

const env = (name: string): string | undefined => process.env[name];

const sinks = (): Sink[] => {
  const all: Sink[] = [createWideEventSink()];

  const otlp = env("OTLP_ENDPOINT");
  if (otlp !== undefined) {
    all.push(
      createOtlpSink({
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
    all.push(createWebhookSink({ url: webhook, secret }));
  }

  return all;
};

const server = createNodeServer({
  providers: [oidcAdapter, auth0Adapter],
  sinks: sinks(),
  settings: createFileSettings(
    env("AUTHTHREAD_CONFIG") ?? "/etc/auththread/config.json",
  ),
  onError: (error) => console.error("auththread:", error),
});

const port = Number(env("PORT") ?? "8787");
const { port: bound } = await server.listen(port);
console.log(`auththread listening on :${bound}`);

const stop = (): void => {
  void server.close().then(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
