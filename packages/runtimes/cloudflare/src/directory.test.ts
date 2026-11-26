import { describe, expect, it } from "vitest";
import { createKeyDirectory } from "./directory.ts";

const directory = createKeyDirectory([
  { tenant: "acme", apiKey: "at_acme" },
  { tenant: "globex", apiKey: "at_globex" },
]);

const request = (headers: Record<string, string>): Request =>
  new Request("https://auththread.example.com/v1/spans", { headers });

describe("createKeyDirectory", () => {
  it("resolves each tenant from its bearer key", async () => {
    expect(
      await directory.resolve(request({ authorization: "Bearer at_acme" })),
    ).toBe("acme");
    expect(
      await directory.resolve(request({ authorization: "Bearer at_globex" })),
    ).toBe("globex");
  });

  it("accepts the fallback header", async () => {
    expect(
      await directory.resolve(request({ "x-auththread-key": "at_acme" })),
    ).toBe("acme");
  });

  it("returns null for a missing or unknown key", async () => {
    expect(await directory.resolve(request({}))).toBeNull();
    expect(
      await directory.resolve(request({ authorization: "Bearer nope" })),
    ).toBeNull();
    expect(
      await directory.resolve(request({ authorization: "Bearer " })),
    ).toBeNull();
  });

  it("refuses a directory where two tenants share a key or a name", () => {
    expect(() =>
      createKeyDirectory([
        { tenant: "a", apiKey: "same" },
        { tenant: "b", apiKey: "same" },
      ]),
    ).toThrow("same API key");
    expect(() =>
      createKeyDirectory([
        { tenant: "a", apiKey: "one" },
        { tenant: "a", apiKey: "two" },
      ]),
    ).toThrow("duplicate tenant");
  });
});
