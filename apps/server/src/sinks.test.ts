import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigProvider, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { loadServerConfig, type ServerConfig } from "./config.ts";
import { createSinks } from "./sinks.ts";

const configPath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "auththread-sinks-"));
  const path = join(directory, "config.json");
  writeFileSync(
    path,
    JSON.stringify({
      tenants: [
        {
          tenant: "acme",
          provider: "oidc",
          apiKey: "at_test",
          salt: "salt-salt",
        },
      ],
    }),
  );
  return path;
};

const load = (env: Record<string, string> = {}): Promise<ServerConfig> => {
  const provider = ConfigProvider.fromUnknown({
    AUTHTHREAD_CONFIG: configPath(),
    ...env,
  });
  return Effect.runPromise(
    loadServerConfig.pipe(Effect.provide(ConfigProvider.layer(provider))),
  );
};

describe("createSinks", () => {
  it("always includes the wide event sink", async () => {
    const sinks = createSinks(await load());
    expect(sinks.map((sink) => sink.id)).toEqual(["wide-event-stdout"]);
  });

  it("builds every configured sink", async () => {
    const sinks = createSinks(
      await load({
        OTLP_ENDPOINT: "http://collector:4318/v1/traces",
        WEBHOOK_URL: "https://example.com/hook",
        WEBHOOK_SECRET: "secret",
        AUTHTHREAD_S3_ENDPOINT: "https://s3.example.com",
        AUTHTHREAD_S3_REGION: "auto",
        AUTHTHREAD_S3_BUCKET: "journeys",
        AUTHTHREAD_S3_ACCESS_KEY_ID: "key",
        AUTHTHREAD_S3_SECRET_ACCESS_KEY: "secret",
      }),
    );
    expect(sinks.map((sink) => sink.id)).toEqual([
      "wide-event-stdout",
      "otlp",
      "webhook",
      "object-store",
    ]);
  });
});
