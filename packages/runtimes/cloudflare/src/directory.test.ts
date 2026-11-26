import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { createKeyDirectory } from "./directory.ts";

const tenants = [
  { tenant: "acme", apiKey: "at_acme" },
  { tenant: "globex", apiKey: "at_globex" },
] as const;

const directory = () => createKeyDirectory(tenants);

const request = (headers: Record<string, string>): Request =>
  new Request("https://auththread.example.com/v1/spans", { headers });

describe("createKeyDirectory", () => {
  it.effect("resolves each tenant from its bearer key", () =>
    Effect.gen(function* () {
      const keys = yield* directory();
      expect(
        yield* keys.resolve(request({ authorization: "Bearer at_acme" })),
      ).toBe("acme");
      expect(
        yield* keys.resolve(request({ authorization: "Bearer at_globex" })),
      ).toBe("globex");
    }),
  );

  it.effect("accepts the fallback header", () =>
    Effect.gen(function* () {
      const keys = yield* directory();
      expect(
        yield* keys.resolve(request({ "x-auththread-key": "at_acme" })),
      ).toBe("acme");
    }),
  );

  it.effect("returns null for a missing or unknown key", () =>
    Effect.gen(function* () {
      const keys = yield* directory();
      expect(yield* keys.resolve(request({}))).toBeNull();
      expect(
        yield* keys.resolve(request({ authorization: "Bearer nope" })),
      ).toBeNull();
      expect(
        yield* keys.resolve(request({ authorization: "Bearer " })),
      ).toBeNull();
    }),
  );

  it.effect("refuses a directory where two tenants share a key or a name", () =>
    Effect.gen(function* () {
      const shared = yield* createKeyDirectory([
        { tenant: "a", apiKey: "same" },
        { tenant: "b", apiKey: "same" },
      ]).pipe(Effect.flip);
      expect(shared.message).toContain("same API key");

      const duplicate = yield* createKeyDirectory([
        { tenant: "a", apiKey: "one" },
        { tenant: "a", apiKey: "two" },
      ]).pipe(Effect.flip);
      expect(duplicate.message).toContain("duplicate tenant");
    }),
  );
});
