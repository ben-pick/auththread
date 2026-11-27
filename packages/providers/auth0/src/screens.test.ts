import { runUiScreenConformance } from "@auththread/adapter-kit";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { auth0Adapter } from "./adapter.ts";
import {
  AUTH0_SCREEN_PATHS,
  AUTH0_SCREENS,
  classifyAuth0Screen,
} from "./screens.ts";

const check = (name: string, body: () => void): void => {
  it.effect(name, () => Effect.sync(body));
};

/**
 * Vendored from the Management API `/prompts/{prompt}/screen/{screen}/rendering`
 * enum. Keeping this list independent of the map is what makes a missed screen
 * fail a test rather than disappear at runtime.
 */
const SCREENS = [
  "login",
  "login-id",
  "login-password",
  "login-passwordless-email-code",
  "login-passwordless-email-link",
  "login-passwordless-sms-otp",
  "login-email-verification",
  "signup",
  "signup-id",
  "signup-password",
  "phone-identifier-enrollment",
  "phone-identifier-challenge",
  "email-identifier-challenge",
  "reset-password-request",
  "reset-password-email",
  "reset-password",
  "reset-password-success",
  "reset-password-error",
  "reset-password-mfa-email-challenge",
  "reset-password-mfa-otp-challenge",
  "reset-password-mfa-phone-challenge",
  "reset-password-mfa-push-challenge-push",
  "reset-password-mfa-recovery-code-challenge",
  "reset-password-mfa-sms-challenge",
  "reset-password-mfa-voice-challenge",
  "reset-password-mfa-webauthn-platform-challenge",
  "reset-password-mfa-webauthn-roaming-challenge",
  "custom-form",
  "consent",
  "consent-tenant-scopes",
  "pending-consent",
  "customized-consent",
  "logout",
  "logout-complete",
  "logout-aborted",
  "mfa-push-welcome",
  "mfa-push-enrollment-qr",
  "mfa-push-enrollment-code",
  "mfa-push-success",
  "mfa-push-challenge-push",
  "mfa-push-list",
  "mfa-otp-enrollment-qr",
  "mfa-otp-enrollment-code",
  "mfa-otp-challenge",
  "mfa-voice-enrollment",
  "mfa-voice-challenge",
  "mfa-phone-challenge",
  "mfa-phone-enrollment",
  "mfa-webauthn-platform-enrollment",
  "mfa-webauthn-roaming-enrollment",
  "mfa-webauthn-platform-challenge",
  "mfa-webauthn-roaming-challenge",
  "mfa-webauthn-change-key-nickname",
  "mfa-webauthn-enrollment-success",
  "mfa-webauthn-error",
  "mfa-webauthn-not-available-error",
  "mfa-country-codes",
  "mfa-sms-enrollment",
  "mfa-sms-challenge",
  "mfa-sms-list",
  "mfa-email-challenge",
  "mfa-email-list",
  "mfa-recovery-code-enrollment",
  "mfa-recovery-code-challenge-new-code",
  "mfa-recovery-code-challenge",
  "mfa-detect-browser-capabilities",
  "mfa-enroll-result",
  "mfa-login-options",
  "mfa-begin-enroll-options",
  "status",
  "device-code-activation",
  "device-code-activation-allowed",
  "device-code-activation-denied",
  "device-code-confirmation",
  "email-verification-result",
  "email-otp-challenge",
  "organization-selection",
  "organization-picker",
  "pre-login-organization-picker",
  "accept-invitation",
  "redeem-ticket",
  "passkey-enrollment",
  "passkey-enrollment-local",
  "interstitial-captcha",
  "brute-force-protection-unblock",
  "brute-force-protection-unblock-success",
  "brute-force-protection-unblock-failure",
  "async-approval-error",
  "async-approval-accepted",
  "async-approval-denied",
  "confirmation",
  "async-approval-wrong-user",
] as const;

const PATHS = [
  "/u/login",
  "/u/login/password",
  "/u/login-email-verification",
  "/u/signup",
  "/u/signup/password",
  "/u/consent",
  "/u/customized-consent",
  "/u/reset-password",
  "/u/reset-password/request",
  "/u/reset-password/change",
  "/u/reset-verify",
  "/u/mfa-begin-enroll-options",
  "/u/mfa-enroll-options",
  "/u/mfa-otp",
  "/u/mfa-push",
  "/u/mfa-webauthn",
  "/u/mfa-recovery-code",
  "/u/mfa-sms",
  "/u/mfa-email",
  "/u/mfa-voice",
  "/u/passkey-enrollment",
  "/u/email-verification",
  "/u/organization",
  "/u/organization-picker",
  "/u/pre-organization-picker",
] as const;

describe("Auth0 screen map", () => {
  check("covers every documented screen and nothing else", () => {
    expect(Object.keys(AUTH0_SCREENS).sort()).toEqual([...SCREENS].sort());
  });

  check("maps every screen to a stage", () => {
    for (const screen of SCREENS) {
      expect(
        classifyAuth0Screen({ vendorScreen: screen }).stage,
        screen,
      ).toBeDefined();
    }
  });

  check("keeps the stage distribution deliberate", () => {
    const counts: Record<string, number> = {};
    for (const rule of Object.values(AUTH0_SCREENS)) {
      counts[rule.stage] = (counts[rule.stage] ?? 0) + 1;
    }
    expect(counts).toEqual({
      identify: 5,
      authenticate: 2,
      verify: 25,
      enroll: 16,
      select: 8,
      consent: 7,
      recover: 3,
      status: 25,
      custom: 1,
    });
  });

  check("does not guess for an unknown screen", () => {
    expect(classifyAuth0Screen({ vendorScreen: "brand-new-screen" })).toEqual(
      {},
    );
  });

  check("falls back to the page path and the legacy step", () => {
    expect(classifyAuth0Screen({ vendorPath: "/u/login/password" })).toEqual({
      stage: "authenticate",
      method: "password",
    });
    expect(classifyAuth0Screen({ legacyStep: "mfa_challenge" })).toEqual({
      stage: "verify",
    });
  });

  check("prefers the vendor screen over the path", () => {
    expect(
      classifyAuth0Screen({
        vendorScreen: "mfa-sms-challenge",
        vendorPath: "/u/login/password",
      }),
    ).toEqual({ stage: "verify", method: "mfa", methodVendorName: "sms" });
  });

  it.effect("passes the provider screen conformance suite", () =>
    Effect.promise(async () => {
      const report = await runUiScreenConformance(auth0Adapter, {
        provider: "auth0",
        screens: [
          { screen: "login-id", stage: "identify" },
          {
            screen: "login-password",
            stage: "authenticate",
            method: "password",
          },
          {
            screen: "login-passwordless-email-code",
            stage: "verify",
            method: "passwordless",
            methodVendorName: "email",
          },
          {
            screen: "signup-password",
            stage: "authenticate",
            method: "password",
          },
          {
            screen: "reset-password",
            stage: "recover",
            method: "password",
          },
          {
            screen: "mfa-sms-challenge",
            stage: "verify",
            method: "mfa",
            methodVendorName: "sms",
          },
          {
            screen: "mfa-webauthn-platform-enrollment",
            stage: "enroll",
            method: "mfa",
            methodVendorName: "webauthn-platform",
          },
          { screen: "mfa-login-options", stage: "select", method: "mfa" },
          { screen: "consent", stage: "consent" },
          { screen: "brute-force-protection-unblock", stage: "recover" },
          {
            screen: "passkey-enrollment",
            stage: "enroll",
            method: "passkey",
            methodVendorName: "platform",
          },
          { screen: "custom-form", stage: "custom" },
        ],
        paths: [
          { path: "/u/login", stage: "identify" },
          {
            path: "/u/login/password",
            stage: "authenticate",
            method: "password",
          },
          { path: "/u/mfa-sms", stage: "verify", method: "mfa" },
        ],
      });
      expect(report.ok, report.failures.join("; ")).toBe(true);
    }),
  );

  check("keeps path coverage for the documented routes", () => {
    expect(Object.keys(AUTH0_SCREEN_PATHS).sort()).toEqual([...PATHS].sort());
  });
});
