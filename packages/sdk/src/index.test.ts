import { describe, expect, it } from "vitest";
import { createStitcher, parseTenantConfig } from "./index.ts";

describe("sdk facade", () => {
  it("exports the neutral stitcher", () => {
    expect(typeof createStitcher).toBe("function");
  });

  it("exports the shared config parser", () => {
    const config = parseTenantConfig({
      tenants: [
        { tenant: "acme", provider: "oidc", apiKey: "key", salt: "12345678" },
      ],
    });
    expect(config.tenants[0]?.tenant).toBe("acme");
  });
});
