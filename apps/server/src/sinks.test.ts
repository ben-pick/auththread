import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./config.ts";
import { createSinks } from "./sinks.ts";

const tenants = JSON.stringify({
  tenants: [
    {
      tenant: "acme",
      provider: "oidc",
      apiKey: "at_test",
      salt: "salt-salt",
    },
  ],
});

describe("createSinks", () => {
  it("always includes the wide event sink", () => {
    const sinks = createSinks(loadServerConfig({ AUTHTHREAD_CONFIG: tenants }));
    expect(sinks.map((sink) => sink.id)).toEqual(["wide-event-stdout"]);
  });

  it("builds every configured sink", () => {
    const config = loadServerConfig({
      AUTHTHREAD_CONFIG: tenants,
      OTLP_ENDPOINT: "http://collector:4318/v1/traces",
      WEBHOOK_URL: "https://example.com/hook",
      WEBHOOK_SECRET: "secret",
      AUTHTHREAD_S3_ENDPOINT: "https://s3.example.com",
      AUTHTHREAD_S3_REGION: "auto",
      AUTHTHREAD_S3_BUCKET: "journeys",
      AUTHTHREAD_S3_ACCESS_KEY_ID: "key",
      AUTHTHREAD_S3_SECRET_ACCESS_KEY: "secret",
    });
    expect(createSinks(config).map((sink) => sink.id)).toEqual([
      "wide-event-stdout",
      "otlp",
      "webhook",
      "object-store",
    ]);
  });
});
