import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "@auththread/schema";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { createFileSettings } from "./settings.ts";

const write = (content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "auththread-"));
  const path = join(dir, "config.json");
  writeFileSync(path, content);
  return path;
};

const load = (path: string) =>
  createFileSettings(path).pipe(Effect.provide(NodeServices.layer));

describe("createFileSettings", () => {
  it.effect("hashes the raw key and serves the tenant", () =>
    Effect.gen(function* () {
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
      const settings = yield* load(path);
      const tenant = yield* settings.getTenant(sha256Hex("at_live_123"));
      expect(tenant?.tenant).toBe("acme");
      expect(tenant?.providerSettings).toEqual({ feedSecret: "x" });
      expect(yield* settings.getTenant(sha256Hex("wrong"))).toBeNull();
    }),
  );

  it.effect("accepts a pre-hashed key", () =>
    Effect.gen(function* () {
      const hash = sha256Hex("at_live_123");
      const settings = yield* load(
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
      expect((yield* settings.getTenant(hash))?.tenant).toBe("acme");
    }),
  );

  it.effect("rejects a config that would fail open", () =>
    Effect.gen(function* () {
      const missingSalt = yield* load(
        write(
          JSON.stringify({ tenants: [{ tenant: "acme", provider: "oidc" }] }),
        ),
      ).pipe(Effect.flip);
      expect(missingSalt.message).toContain("salt");

      const missingTenants = yield* load(write(JSON.stringify({}))).pipe(
        Effect.flip,
      );
      expect(missingTenants.message).toContain("tenants");

      const emptyKey = yield* load(
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
      ).pipe(Effect.flip);
      expect(emptyKey.message).toContain("apiKey");
    }),
  );
});
