import { describe, expect, it } from "vitest";
import { hashUser, redactAttributes, redactText } from "./redact.ts";

describe("redactAttributes", () => {
  const salt = "tenant-salt";

  it("drops credential material", () => {
    const out = redactAttributes(
      {
        "http.request.password": "hunter2",
        "http.request.headers.authorization": "Bearer abc",
        "auth.token": "abc",
        "auth.error.code": "invalid_password",
      },
      { salt },
    );

    expect(out).toEqual({ "auth.error.code": "invalid_password" });
  });

  it("hashes user identifiers with the tenant salt", () => {
    const out = redactAttributes(
      { user_id: "auth0|123", email: "a@b.co" },
      { salt },
    );

    expect(out["auth.user.hash"]).toBe(hashUser("a@b.co", salt));
    expect(Object.keys(out)).toEqual(["auth.user.hash"]);
    expect(JSON.stringify(out)).not.toContain("@");
  });

  it("drops user identifiers when no salt is configured", () => {
    expect(redactAttributes({ user_id: "auth0|123" }, {})).toEqual({});
  });

  it("keeps a hash the emitter already computed", () => {
    const hash = `u_${"a".repeat(16)}`;
    const out = redactAttributes({ "auth.user.hash": hash }, {});
    expect(out["auth.user.hash"]).toBe(hash);
  });

  it("rehashes a value that only looks like a hash", () => {
    const out = redactAttributes(
      { "auth.user.hash": "alice@example.com" },
      { salt: "salt" },
    );
    expect(out["auth.user.hash"]).toBe(hashUser("alice@example.com", "salt"));
  });

  it("masks free text", () => {
    expect(redactText("mail me at a@b.co")).toBe("mail me at [email]");
    expect(
      redactText(
        `token eyJ${"a".repeat(10)}.${"b".repeat(10)}.${"c".repeat(6)} ok`,
      ),
    ).toBe("token [token] ok");
    expect(redactText("x".repeat(400))).toHaveLength(200);
  });
});
