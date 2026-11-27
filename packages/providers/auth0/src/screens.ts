import { defineScreenMap, type UiScreenRule } from "@auththread/adapter-kit";

/**
 * Auth0's hosted-page screen vocabulary, taken from the Management API
 * `/prompts/{prompt}/screen/{screen}/rendering` enum (92 screens).
 *
 * `prompt.screen.name` is the authoritative input. The map is server-side so a
 * new Auth0 screen can be supported without republishing the SRI-pinned page
 * snippet. Unknown screens keep their vendor name and get no stage.
 */
export const AUTH0_SCREENS = {
  login: { stage: "identify" },
  "login-id": { stage: "identify" },
  "login-password": { stage: "authenticate", method: "password" },
  "login-passwordless-email-code": {
    stage: "verify",
    method: "passwordless",
    methodVendorName: "email",
  },
  "login-passwordless-email-link": {
    stage: "status",
    method: "passwordless",
    methodVendorName: "email",
  },
  "login-passwordless-sms-otp": {
    stage: "verify",
    method: "passwordless",
    methodVendorName: "sms",
  },
  "login-email-verification": { stage: "verify" },
  signup: { stage: "identify" },
  "signup-id": { stage: "identify" },
  "signup-password": { stage: "authenticate", method: "password" },
  "phone-identifier-enrollment": {
    stage: "enroll",
    method: "passwordless",
    methodVendorName: "phone",
  },
  "phone-identifier-challenge": {
    stage: "verify",
    method: "passwordless",
    methodVendorName: "phone",
  },
  "email-identifier-challenge": {
    stage: "verify",
    method: "passwordless",
    methodVendorName: "email",
  },
  "reset-password-request": { stage: "recover" },
  // Judgement call: the "email sent" screen, not the credential form.
  "reset-password-email": { stage: "status" },
  "reset-password": { stage: "recover", method: "password" },
  "reset-password-success": { stage: "status" },
  "reset-password-error": { stage: "status" },
  "reset-password-mfa-email-challenge": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "email",
  },
  "reset-password-mfa-otp-challenge": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "otp",
  },
  "reset-password-mfa-phone-challenge": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "phone",
  },
  "reset-password-mfa-push-challenge-push": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "push",
  },
  "reset-password-mfa-recovery-code-challenge": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "recovery-code",
  },
  "reset-password-mfa-sms-challenge": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "sms",
  },
  "reset-password-mfa-voice-challenge": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "voice",
  },
  "reset-password-mfa-webauthn-platform-challenge": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "webauthn-platform",
  },
  "reset-password-mfa-webauthn-roaming-challenge": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "webauthn-roaming",
  },
  "custom-form": { stage: "custom" },
  consent: { stage: "consent" },
  "consent-tenant-scopes": { stage: "consent" },
  "pending-consent": { stage: "consent" },
  "customized-consent": { stage: "consent" },
  logout: { stage: "status" },
  "logout-complete": { stage: "status" },
  "logout-aborted": { stage: "status" },
  "mfa-push-welcome": {
    stage: "enroll",
    method: "mfa",
    methodVendorName: "push",
  },
  "mfa-push-enrollment-qr": {
    stage: "enroll",
    method: "mfa",
    methodVendorName: "push",
  },
  "mfa-push-enrollment-code": {
    stage: "enroll",
    method: "mfa",
    methodVendorName: "push",
  },
  "mfa-push-success": {
    stage: "status",
    method: "mfa",
    methodVendorName: "push",
  },
  "mfa-push-challenge-push": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "push",
  },
  "mfa-push-list": { stage: "select", method: "mfa", methodVendorName: "push" },
  "mfa-otp-enrollment-qr": {
    stage: "enroll",
    method: "mfa",
    methodVendorName: "otp",
  },
  "mfa-otp-enrollment-code": {
    stage: "enroll",
    method: "mfa",
    methodVendorName: "otp",
  },
  "mfa-otp-challenge": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "otp",
  },
  "mfa-voice-enrollment": {
    stage: "enroll",
    method: "mfa",
    methodVendorName: "voice",
  },
  "mfa-voice-challenge": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "voice",
  },
  "mfa-phone-challenge": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "phone",
  },
  "mfa-phone-enrollment": {
    stage: "enroll",
    method: "mfa",
    methodVendorName: "phone",
  },
  "mfa-webauthn-platform-enrollment": {
    stage: "enroll",
    method: "mfa",
    methodVendorName: "webauthn-platform",
  },
  "mfa-webauthn-roaming-enrollment": {
    stage: "enroll",
    method: "mfa",
    methodVendorName: "webauthn-roaming",
  },
  "mfa-webauthn-platform-challenge": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "webauthn-platform",
  },
  "mfa-webauthn-roaming-challenge": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "webauthn-roaming",
  },
  "mfa-webauthn-change-key-nickname": {
    stage: "enroll",
    method: "mfa",
    methodVendorName: "webauthn",
  },
  "mfa-webauthn-enrollment-success": {
    stage: "status",
    method: "mfa",
    methodVendorName: "webauthn",
  },
  "mfa-webauthn-error": {
    stage: "status",
    method: "mfa",
    methodVendorName: "webauthn",
  },
  "mfa-webauthn-not-available-error": {
    stage: "status",
    method: "mfa",
    methodVendorName: "webauthn",
  },
  "mfa-country-codes": {
    stage: "select",
    method: "mfa",
    methodVendorName: "phone",
  },
  "mfa-sms-enrollment": {
    stage: "enroll",
    method: "mfa",
    methodVendorName: "sms",
  },
  "mfa-sms-challenge": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "sms",
  },
  "mfa-sms-list": { stage: "select", method: "mfa", methodVendorName: "sms" },
  "mfa-email-challenge": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "email",
  },
  "mfa-email-list": {
    stage: "select",
    method: "mfa",
    methodVendorName: "email",
  },
  "mfa-recovery-code-enrollment": {
    stage: "enroll",
    method: "mfa",
    methodVendorName: "recovery-code",
  },
  "mfa-recovery-code-challenge-new-code": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "recovery-code",
  },
  "mfa-recovery-code-challenge": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "recovery-code",
  },
  "mfa-detect-browser-capabilities": { stage: "status" },
  "mfa-enroll-result": { stage: "status" },
  "mfa-login-options": { stage: "select", method: "mfa" },
  "mfa-begin-enroll-options": { stage: "enroll", method: "mfa" },
  status: { stage: "status" },
  // Judgement call: entering the user code shown on the device.
  "device-code-activation": { stage: "identify" },
  "device-code-activation-allowed": { stage: "status" },
  "device-code-activation-denied": { stage: "status" },
  "device-code-confirmation": { stage: "consent" },
  "email-verification-result": { stage: "status" },
  "email-otp-challenge": {
    stage: "verify",
    method: "passwordless",
    methodVendorName: "email",
  },
  "organization-selection": { stage: "select" },
  "organization-picker": { stage: "select" },
  "pre-login-organization-picker": { stage: "select" },
  "accept-invitation": { stage: "consent" },
  // Judgement call: a ticket redemption interstitial.
  "redeem-ticket": { stage: "status" },
  "passkey-enrollment": {
    stage: "enroll",
    method: "passkey",
    methodVendorName: "platform",
  },
  "passkey-enrollment-local": {
    stage: "enroll",
    method: "passkey",
    methodVendorName: "local",
  },
  "interstitial-captcha": { stage: "status" },
  "brute-force-protection-unblock": { stage: "recover" },
  "brute-force-protection-unblock-success": { stage: "status" },
  "brute-force-protection-unblock-failure": { stage: "status" },
  "async-approval-error": { stage: "status" },
  "async-approval-accepted": { stage: "status" },
  "async-approval-denied": { stage: "status" },
  // Judgement call: a generic confirmation interstitial.
  confirmation: { stage: "consent" },
  "async-approval-wrong-user": { stage: "status" },
} as const satisfies Record<string, UiScreenRule>;

/** URL fallback for ACUL without `use_page_template` and old templates. */
export const AUTH0_SCREEN_PATHS = {
  "/u/login": { stage: "identify" },
  "/u/login/password": { stage: "authenticate", method: "password" },
  "/u/login-email-verification": { stage: "verify" },
  "/u/signup": { stage: "identify" },
  "/u/signup/password": { stage: "authenticate", method: "password" },
  "/u/consent": { stage: "consent" },
  "/u/customized-consent": { stage: "consent" },
  "/u/reset-password": { stage: "recover" },
  "/u/reset-password/request": { stage: "recover" },
  "/u/reset-password/change": { stage: "recover", method: "password" },
  "/u/reset-verify": { stage: "recover" },
  "/u/mfa-begin-enroll-options": { stage: "enroll", method: "mfa" },
  "/u/mfa-enroll-options": { stage: "enroll", method: "mfa" },
  "/u/mfa-otp": { stage: "verify", method: "mfa", methodVendorName: "otp" },
  "/u/mfa-push": { stage: "verify", method: "mfa", methodVendorName: "push" },
  "/u/mfa-webauthn": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "webauthn",
  },
  "/u/mfa-recovery-code": {
    stage: "verify",
    method: "mfa",
    methodVendorName: "recovery-code",
  },
  "/u/mfa-sms": { stage: "verify", method: "mfa", methodVendorName: "sms" },
  "/u/mfa-email": { stage: "verify", method: "mfa", methodVendorName: "email" },
  "/u/mfa-voice": { stage: "verify", method: "mfa", methodVendorName: "voice" },
  "/u/passkey-enrollment": { stage: "enroll", method: "passkey" },
  "/u/email-verification": { stage: "verify" },
  "/u/organization": { stage: "select" },
  "/u/organization-picker": { stage: "select" },
  "/u/pre-organization-picker": { stage: "select" },
} as const satisfies Record<string, UiScreenRule>;

export const classifyAuth0Screen = defineScreenMap({
  exact: AUTH0_SCREENS,
  paths: AUTH0_SCREEN_PATHS,
});
