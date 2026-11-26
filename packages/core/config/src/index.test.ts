import { describe, expect, it } from "vitest";
import { parseTenantConfig, toTenantSettings } from "./index.ts";

const valid = {
  tenants: [
    {
      tenant: "acme",
      provider: "auth0",
      apiKey: "at_live_test",
      salt: "a long tenant salt",
      providerSettings: { domain: "acme.auth0.com" },
    },
  ],
};

describe("parseTenantConfig", () => {
  it("parses a tenant and hashes the raw key", () => {
    const config = parseTenantConfig(valid);
    expect(config.tenants).toHaveLength(1);
    const [tenant] = toTenantSettings(config);
    expect(tenant?.tenant).toBe("acme");
    expect(tenant?.apiKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tenant?.apiKeyHash).not.toBe("at_live_test");
  });

  it("accepts a pre-hashed key", () => {
    const hash = "a".repeat(64);
    const config = parseTenantConfig({
      tenants: [
        {
          tenant: "acme",
          provider: "oidc",
          apiKeyHash: hash,
          salt: "12345678",
        },
      ],
    });
    expect(toTenantSettings(config)[0]?.apiKeyHash).toBe(hash);
  });

  it("rejects a missing key", () => {
    expect(() =>
      parseTenantConfig({
        tenants: [{ tenant: "acme", provider: "auth0", salt: "12345678" }],
      }),
    ).toThrow(/apiKey or apiKeyHash/);
  });

  it("rejects a short salt", () => {
    expect(() =>
      parseTenantConfig({
        tenants: [
          { tenant: "acme", provider: "auth0", apiKey: "x", salt: "short" },
        ],
      }),
    ).toThrow(/salt/);
  });

  it("keeps timing overrides", () => {
    const config = parseTenantConfig({ ...valid, quietMs: 1000, ttlMs: 5000 });
    expect(config.quietMs).toBe(1000);
    expect(config.ttlMs).toBe(5000);
  });
});
