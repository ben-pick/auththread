import { sha256Hex } from "@auththread/schema";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { createS3Store, signRequest } from "./s3.ts";

const EMPTY = sha256Hex("");

const ACCESS_KEY_ID = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
const SECRET_ACCESS_KEY = ["wJalrXUtnFEMI", "/K7MDENG/bPxRfiCYEXAMPLEKEY"].join(
  "",
);

describe("signRequest", () => {
  it("matches the published AWS S3 example", async () => {
    const headers = await signRequest({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { range: "bytes=0-9" },
      payloadHash: EMPTY,
      region: "us-east-1",
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      now: new Date("2013-05-24T00:00:00Z"),
    });

    expect(headers["x-amz-date"]).toBe("20130524T000000Z");
    expect(headers["x-amz-content-sha256"]).toBe(EMPTY);
    expect(headers.authorization).toContain(
      "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });
});

describe("createS3Store", () => {
  it.effect("sends a signed path-style PUT", () =>
    Effect.gen(function* () {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      const store = createS3Store({
        endpoint: "https://account.r2.cloudflarestorage.com",
        region: "auto",
        bucket: "journeys",
        accessKeyId: "key",
        secretAccessKey: "secret",
        now: () => new Date("2026-11-26T05:00:00Z"),
        fetchImpl: (async (url, init) => {
          calls.push({ url: String(url), init: init ?? {} });
          return new Response(null, { status: 200 });
        }) as typeof fetch,
      });

      yield* store.put(
        "auththread/dt=2026-11-26/hour=05/batch-abc.ndjson",
        '{"traceId":"a"}\n',
        "application/x-ndjson",
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(
        "https://account.r2.cloudflarestorage.com/journeys/auththread/dt%3D2026-11-26/hour%3D05/batch-abc.ndjson",
      );
      const headers = calls[0]?.init.headers as Record<string, string>;
      expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
      expect(headers["content-type"]).toBe("application/x-ndjson");
      expect(calls[0]?.init.method).toBe("PUT");
    }),
  );

  it.effect("uses a virtual-host URL when configured", () =>
    Effect.gen(function* () {
      const urls: string[] = [];
      const store = createS3Store({
        endpoint: "https://s3.us-east-1.amazonaws.com",
        region: "us-east-1",
        bucket: "journeys",
        accessKeyId: "key",
        secretAccessKey: "secret",
        forcePathStyle: false,
        now: () => new Date("2026-11-26T05:00:00Z"),
        fetchImpl: (async (url) => {
          urls.push(String(url));
          return new Response(null, { status: 200 });
        }) as typeof fetch,
      });

      yield* store.put("a/b.ndjson", "{}\n", "application/x-ndjson");
      expect(urls[0]).toBe(
        "https://journeys.s3.us-east-1.amazonaws.com/a/b.ndjson",
      );
    }),
  );

  it.effect("fails with the store status", () =>
    Effect.gen(function* () {
      const store = createS3Store({
        endpoint: "https://s3.example.com",
        region: "us-east-1",
        bucket: "journeys",
        accessKeyId: "key",
        secretAccessKey: "secret",
        fetchImpl: (async () =>
          new Response("denied", { status: 403 })) as typeof fetch,
      });

      const error = yield* store
        .put("a.ndjson", "{}\n", "application/x-ndjson")
        .pipe(Effect.flip);
      expect(error.message).toContain("403");
    }),
  );
});
