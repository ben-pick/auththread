import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { defineScreenMap } from "./screen-map.ts";

const classify = defineScreenMap({
  exact: {
    "login-password": { stage: "authenticate", method: "password" },
    "mfa-login-options": { stage: "select", method: "mfa" },
  },
  paths: {
    "/u/login/password": { stage: "authenticate", method: "password" },
  },
  prefixes: [
    ["mfa-", { stage: "verify", method: "mfa" }],
    ["mfa-enroll-", { stage: "enroll", method: "mfa" }],
  ],
});

describe("defineScreenMap", () => {
  it.effect("prefers an exact screen over a path", () =>
    Effect.sync(() => {
      expect(
        classify({
          vendorScreen: "mfa-login-options",
          vendorPath: "/u/login/password",
        }),
      ).toEqual({ stage: "select", method: "mfa" });
    }),
  );

  it.effect("uses the path when the screen is unknown", () =>
    Effect.sync(() => {
      expect(classify({ vendorPath: "/u/login/password" })).toEqual({
        stage: "authenticate",
        method: "password",
      });
    }),
  );

  it.effect("uses the longest matching prefix", () =>
    Effect.sync(() => {
      expect(classify({ vendorScreen: "mfa-enroll-sms" })).toEqual({
        stage: "enroll",
        method: "mfa",
      });
      expect(classify({ vendorScreen: "mfa-sms-challenge" })).toEqual({
        stage: "verify",
        method: "mfa",
      });
    }),
  );

  it.effect("maps the legacy step vocabulary", () =>
    Effect.sync(() => {
      expect(classify({ legacyStep: "mfa_challenge" })).toEqual({
        stage: "verify",
      });
    }),
  );

  it.effect("returns nothing for an unknown screen", () =>
    Effect.sync(() => {
      expect(classify({ vendorScreen: "something-new" })).toEqual({});
    }),
  );
});
