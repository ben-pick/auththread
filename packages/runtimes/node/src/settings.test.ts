import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "@auththread/schema";
import { describe, expect, it } from "vitest";
import { createFileSettings } from "./settings.ts";

const write = (content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "auththread-"));
  const path = join(dir, "config.json");
  writeFileSync(path, content);
  return path;
};

describe("createFileSettings", () => {
  it("hashes the raw key and serves the tenant", async () => {
    const path = write(
      JSON.stringify({
        tenants: [
          {
            tenant: "acme",
            provider: "auth0",
            apiKey: "at_live_123",
            salt: "a-long-enough-salt",
            providerSettings: { feedSecret: "x" },
          },
        ],
      }),
    );
    const settings = createFileSettings(path);
    const tenant = await settings.getTenant(sha256Hex("at_live_123"));
    expect(tenant?.tenant).toBe("acme");
    expect(tenant?.providerSettings).toEqual({ feedSecret: "x" });
    expect(await settings.getTenant(sha256Hex("wrong"))).toBeNull();
  });

  it("accepts a pre-hashed key", async () => {
    const hash = sha256Hex("at_live_123");
    const settings = createFileSettings(
      write(
        JSON.stringify({
          tenants: [
            {
              tenant: "acme",
              provider: "oidc",
              apiKeyHash: hash,
              salt: "a-long-enough-salt",
            },
          ],
        }),
      ),
    );
    expect((await settings.getTenant(hash))?.tenant).toBe("acme");
  });

  it("rejects a config that would fail open", () => {
    expect(() =>
      createFileSettings(
        write(
          JSON.stringify({ tenants: [{ tenant: "acme", provider: "oidc" }] }),
        ),
      ),
    ).toThrow("salt");
    expect(() => createFileSettings(write(JSON.stringify({})))).toThrow(
      "tenants",
    );
    expect(() =>
      createFileSettings(
        write(
          JSON.stringify({
            tenants: [
              {
                tenant: "acme",
                provider: "oidc",
                apiKey: "",
                salt: "a-long-enough-salt",
              },
            ],
          }),
        ),
      ),
    ).toThrow("empty apiKey");
  });
});
