import type { Sink } from "@auththread/adapter-kit";
import { createOtlpExporter } from "@auththread/otlp";
import {
  createObjectStoreSink,
  createS3Store,
} from "@auththread/sink-object-store";
import { createOtlpSink } from "@auththread/sink-otlp";
import { createWebhookSink } from "@auththread/sink-webhook";
import { createWideEventSink } from "@auththread/sink-wide-event";
import type { ServerConfig } from "./config.ts";

/** Build sinks from the resolved server config, never from raw env. */
export function createSinks(config: ServerConfig): Sink[] {
  const sinks: Sink[] = [createWideEventSink({ sampling: config.sampling })];

  if (config.otlp !== undefined) {
    sinks.push(
      createOtlpSink({
        sampling: config.sampling,
        exporter: createOtlpExporter({
          endpoint: config.otlp.endpoint,
          serviceName: config.otlp.serviceName,
          headers: config.otlp.headers,
        }),
      }),
    );
  }

  if (config.webhook !== undefined) {
    sinks.push(
      createWebhookSink({
        url: config.webhook.url,
        secret: config.webhook.secret,
        sampling: config.sampling,
      }),
    );
  }

  if (config.s3 !== undefined) {
    sinks.push(
      createObjectStoreSink({
        sampling: config.sampling,
        store: createS3Store({
          endpoint: config.s3.endpoint,
          region: config.s3.region,
          bucket: config.s3.bucket,
          accessKeyId: config.s3.accessKeyId,
          secretAccessKey: config.s3.secretAccessKey,
          forcePathStyle: config.s3.forcePathStyle,
        }),
        prefix: config.s3.prefix,
      }),
    );
  }

  return sinks;
}
