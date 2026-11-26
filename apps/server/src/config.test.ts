import { describe, expect, it } from "vitest";
import { ConfigError, loadServerConfig } from "./config.ts";

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

const base = { AUTHTHREAD_CONFIG: tenants } as const;

const expectConfigError = (env: Record<string, string>): string => {
  try {
    loadServerConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).message;
  }
  throw new Error("expected a ConfigError");
};

describe("loadServerConfig", () => {
  it("parses the minimal config with defaults", () => {
    const config = loadServerConfig(base);
    expect(config.port).toBe(8787);
    expect(config.storage).toEqual({ type: "memory" });
    expect(config.sampling.successRate).toBe(0.1);
    expect(config.otlp).toBeUndefined();
    expect(config.webhook).toBeUndefined();
    expect(config.s3).toBeUndefined();
    expect(config.tenants.tenants[0]?.tenant).toBe("acme");
  });

  it("parses typed timings, storage and sampling", () => {
    const config = loadServerConfig({
      ...base,
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

  it("parses OTLP, webhook and S3 groups", () => {
    const config = loadServerConfig({
      ...base,
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

  it("rejects a partial webhook group instead of silently disabling it", () => {
    expect(() =>
      loadServerConfig({ ...base, WEBHOOK_URL: "https://example.com/hook" }),
    ).toThrow(/webhook needs all or none/);
    expect(() =>
      loadServerConfig({ ...base, WEBHOOK_SECRET: "secret" }),
    ).toThrow(/webhook needs all or none/);
  });

  it("rejects a partial S3 group", () => {
    expect(() =>
      loadServerConfig({
        ...base,
        AUTHTHREAD_S3_ENDPOINT: "https://s3.example.com",
        AUTHTHREAD_S3_REGION: "auto",
      }),
    ).toThrow(/object store needs all or none/);
  });

  it("rejects invalid numbers and sampling rates", () => {
    expect(() => loadServerConfig({ ...base, PORT: "abc" })).toThrow(
      /PORT must be an integer/,
    );
    expect(() =>
      loadServerConfig({ ...base, AUTHTHREAD_QUIET_MS: "0" }),
    ).toThrow(/AUTHTHREAD_QUIET_MS must be between/);
    expect(() =>
      loadServerConfig({ ...base, AUTHTHREAD_SAMPLE_SUCCESS: "2" }),
    ).toThrow(/AUTHTHREAD_SAMPLE_SUCCESS must be a number between 0 and 1/);
  });

  it("rejects invalid OTLP headers", () => {
    expect(() =>
      loadServerConfig({
        ...base,
        OTLP_ENDPOINT: "http://collector:4318/v1/traces",
        OTLP_HEADERS: "not-json",
      }),
    ).toThrow(/OTLP_HEADERS must be valid JSON/);
    expect(() =>
      loadServerConfig({
        ...base,
        OTLP_HEADERS: '{"authorization":"test"}',
      }),
    ).toThrow(/OTLP_HEADERS requires OTLP_ENDPOINT/);
  });

  it("reports all config problems at once", () => {
    const message = expectConfigError({
      AUTHTHREAD_CONFIG: tenants,
      PORT: "abc",
      WEBHOOK_URL: "https://example.com/hook",
    });
    expect(message).toContain("PORT must be an integer");
    expect(message).toContain("webhook needs all or none");
  });
});
