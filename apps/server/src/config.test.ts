import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigProvider, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { loadServerConfig, type ServerConfig } from "./config.ts";

const configFile = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "auththread-config-"));
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

const run = (env: Record<string, string>): Promise<ServerConfig> => {
  const provider = ConfigProvider.fromUnknown({
    AUTHTHREAD_CONFIG: configFile(),
    ...env,
  });
  return Effect.runPromise(
    loadServerConfig.pipe(Effect.provide(ConfigProvider.layer(provider))),
  );
};

describe("loadServerConfig", () => {
  it("parses the minimal config with defaults", async () => {
    const config = await run({});
    expect(config.port).toBe(8787);
    expect(config.storage).toEqual({ type: "memory" });
    expect(config.sampling.successRate).toBe(0.1);
    expect(config.otlp).toBeUndefined();
    expect(config.webhook).toBeUndefined();
    expect(config.s3).toBeUndefined();
  });

  it("parses typed timings, storage and sampling", async () => {
    const config = await run({
      PORT: "9000",
      AUTHTHREAD_DB: "/tmp/auththread.db",
      AUTHTHREAD_QUIET_MS: "1000",
      AUTHTHREAD_CORRELATION_WINDOW_MS: "2000",
      AUTHTHREAD_TTL_MS: "3000",
      AUTHTHREAD_SAMPLE_SUCCESS: "0.5",
    });
    expect(config.port).toBe(9000);
    expect(config.storage).toEqual({
      type: "sqlite",
      path: "/tmp/auththread.db",
    });
    expect(config.quietMs).toBe(1000);
    expect(config.correlationWindowMs).toBe(2000);
    expect(config.ttlMs).toBe(3000);
    expect(config.sampling.successRate).toBe(0.5);
  });

  it("parses OTLP, webhook and S3 groups", async () => {
    const config = await run({
      OTLP_ENDPOINT: "http://collector:4318/v1/traces",
      OTLP_HEADERS: '{"authorization":"Bearer test"}',
      WEBHOOK_URL: "https://example.com/hook",
      WEBHOOK_SECRET: "secret",
      AUTHTHREAD_S3_ENDPOINT: "https://s3.example.com",
      AUTHTHREAD_S3_REGION: "auto",
      AUTHTHREAD_S3_BUCKET: "journeys",
      AUTHTHREAD_S3_ACCESS_KEY_ID: "key",
      AUTHTHREAD_S3_SECRET_ACCESS_KEY: "secret",
      AUTHTHREAD_S3_PREFIX: "tenant",
      AUTHTHREAD_S3_FORCE_PATH_STYLE: "true",
    });
    expect(config.otlp?.headers.authorization).toBe("Bearer test");
    expect(config.webhook?.url).toBe("https://example.com/hook");
    expect(config.s3?.bucket).toBe("journeys");
    expect(config.s3?.forcePathStyle).toBe(true);
    expect(config.s3?.prefix).toBe("tenant");
  });

  it("rejects a partial webhook group instead of silently disabling it", async () => {
    await expect(
      run({ WEBHOOK_URL: "https://example.com/hook" }),
    ).rejects.toThrow(/webhook needs all or none/);
    await expect(run({ WEBHOOK_SECRET: "secret" })).rejects.toThrow(
      /webhook needs all or none/,
    );
  });

  it("rejects a partial S3 group", async () => {
    await expect(
      run({
        AUTHTHREAD_S3_ENDPOINT: "https://s3.example.com",
        AUTHTHREAD_S3_REGION: "auto",
      }),
    ).rejects.toThrow(/object store needs all or none/);
  });

  it("rejects invalid numbers and sampling rates", async () => {
    await expect(run({ PORT: "abc" })).rejects.toThrow(/PORT/);
    await expect(run({ AUTHTHREAD_QUIET_MS: "abc" })).rejects.toThrow(
      /AUTHTHREAD_QUIET_MS/,
    );
    await expect(run({ AUTHTHREAD_SAMPLE_SUCCESS: "2" })).rejects.toThrow(
      /AUTHTHREAD_SAMPLE_SUCCESS must be a number between 0 and 1/,
    );
  });

  it("rejects invalid OTLP headers", async () => {
    await expect(
      run({
        OTLP_ENDPOINT: "http://collector:4318/v1/traces",
        OTLP_HEADERS: "not-json",
      }),
    ).rejects.toThrow(/OTLP_HEADERS is invalid/);
    await expect(
      run({ OTLP_HEADERS: '{"authorization":"test"}' }),
    ).rejects.toThrow(/OTLP_HEADERS requires OTLP_ENDPOINT/);
  });
});
