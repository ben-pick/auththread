/** The single source of neutral enum values for the browser edge and the server contract. */

export const WIDE_EVENT_SCHEMA_VERSION = "2" as const;
export const WIDE_EVENT_EVENT_NAME = "auth.journey" as const;

export const NEUTRAL_ATTRIBUTES = [
  "auth.provider",
  "auth.tenant",
  "auth.client_id",
  "auth.journey.kind",
  "auth.transaction.id",
  "auth.user.hash",
  "auth.method",
  "auth.method.vendor_name",
  "auth.ui.stage",
  "auth.ui.vendor_screen",
  "auth.ui.vendor_path",
  "auth.ui.locale",
  "auth.ui.load_ms",
  "auth.ui.ttfb_ms",
  "auth.ui.transition_ms",
  "auth.ui.first_input_ms",
  "auth.ui.hidden_ms",
  "auth.ui.passkey_ms",
  "auth.ui.submits",
  "auth.ui.validation_errors",
  "auth.ui.exceptions",
  "auth.ui.exception",
  "auth.ui.visibility_changes",
  "auth.ui.passkey_attempts",
  "auth.ui.repeat",
  "auth.ui.autofill",
  "auth.ui.delegated",
  "auth.hook.name",
  "auth.hook.type",
  "auth.hook.stage",
  "auth.hook.version",
  "auth.hook.decision",
  "auth.hook.claims_set",
  "auth.error.code",
  "auth.error.vendor_code",
  "auth.error.source",
  "auth.outcome",
  "auth.abandoned_at",
  "auth.abandoned_screen",
  "auth.correlation",
  "auth.passkey.result",
] as const;

export const JOURNEY_KINDS = ["login", "signup", "reset", "step_up"] as const;
export const WIDE_EVENT_STEP_TYPES = ["ui", "hook", "app", "provider"] as const;
export const AUTH_METHODS = [
  "password",
  "social",
  "enterprise_sso",
  "passwordless",
  "passkey",
  "mfa",
] as const;
export const AUTH_UI_STAGES = [
  "identify",
  "authenticate",
  "verify",
  "enroll",
  "select",
  "consent",
  "recover",
  "status",
  "custom",
] as const;
/** Legacy step vocabulary. Accepted inbound and mapped to a stage; never emitted. */
export const AUTH_UI_STEPS = [
  "identifier",
  "password",
  "mfa_challenge",
  "consent",
  "signup",
  "reset",
] as const;
export const AUTH_PASSKEY_RESULTS = [
  "ok",
  "cancelled",
  "timeout",
  "unsupported",
  "NotAllowedError",
  "InvalidStateError",
  "NotSupportedError",
  "SecurityError",
  "AbortError",
  "ConstraintError",
  "UnknownError",
] as const;
export const AUTH_HOOK_STAGES = [
  "pre_signup",
  "post_signup",
  "pre_auth",
  "post_auth",
  "pre_token",
] as const;
export const AUTH_HOOK_DECISIONS = [
  "continue",
  "deny",
  "redirect",
  "challenge",
] as const;
export const AUTH_ERROR_SOURCES = ["app", "ui", "hook", "provider"] as const;
export const AUTH_OUTCOMES = [
  "success",
  "failed",
  "abandoned",
  "denied",
] as const;
export const AUTH_CORRELATIONS = ["exact", "inferred"] as const;
export const PROVIDER_EVENT_TYPES = [
  "login_success",
  "signup_success",
  "logout_success",
  "login_failure",
  "signup_failure",
  "rate_limited",
  "token_exchange",
  "provider_event",
] as const;

export const AUTH_SCHEMA_VERSION = WIDE_EVENT_SCHEMA_VERSION;
export type WideEventSchemaVersion = typeof WIDE_EVENT_SCHEMA_VERSION;

export type AuthAttribute = (typeof NEUTRAL_ATTRIBUTES)[number];

export type AttributeValue = string | number | boolean | readonly string[];

/** Open map: neutral keys are typed, and OTel keys such as service.name pass through. */
export type Attributes = Readonly<Record<string, AttributeValue>>;

export type JourneyKind = (typeof JOURNEY_KINDS)[number];

export type WideEventStepType = (typeof WIDE_EVENT_STEP_TYPES)[number];

export type AuthMethod = (typeof AUTH_METHODS)[number];

export type AuthUiStage = (typeof AUTH_UI_STAGES)[number];

export type AuthUiStep = (typeof AUTH_UI_STEPS)[number];

export type ProviderEventType = (typeof PROVIDER_EVENT_TYPES)[number];

export type AuthPasskeyResult = (typeof AUTH_PASSKEY_RESULTS)[number];

export type AuthHookStage = (typeof AUTH_HOOK_STAGES)[number];

export type AuthHookDecision = (typeof AUTH_HOOK_DECISIONS)[number];

export type AuthErrorSource = (typeof AUTH_ERROR_SOURCES)[number];

export type Outcome = (typeof AUTH_OUTCOMES)[number];

export type CorrelationKind = (typeof AUTH_CORRELATIONS)[number];

export const SPAN_NAMES = {
  journey: "auth.journey",
  loginStart: "auth.app.login_start",
  callback: "auth.app.callback",
  tokenExchange: "auth.app.token_exchange",
  uiScreen: "auth.ui.screen",
  hookExecute: "auth.hook.execute",
  providerEvent: "auth.provider.event",
} as const;
export type SpanName = (typeof SPAN_NAMES)[keyof typeof SPAN_NAMES];

const has = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

export const isOutcome = (value: unknown): value is Outcome =>
  has(AUTH_OUTCOMES, value);
export const isJourneyKind = (value: unknown): value is JourneyKind =>
  has(JOURNEY_KINDS, value);
export const isAuthMethod = (value: unknown): value is AuthMethod =>
  has(AUTH_METHODS, value);
export const isAuthUiStage = (value: unknown): value is AuthUiStage =>
  has(AUTH_UI_STAGES, value);
export const isAuthUiStep = (value: unknown): value is AuthUiStep =>
  has(AUTH_UI_STEPS, value);
export const isAuthPasskeyResult = (
  value: unknown,
): value is AuthPasskeyResult => has(AUTH_PASSKEY_RESULTS, value);
export const isAuthHookStage = (value: unknown): value is AuthHookStage =>
  has(AUTH_HOOK_STAGES, value);
export const isAuthHookDecision = (value: unknown): value is AuthHookDecision =>
  has(AUTH_HOOK_DECISIONS, value);
export const isAuthErrorSource = (value: unknown): value is AuthErrorSource =>
  has(AUTH_ERROR_SOURCES, value);
export const isCorrelationKind = (value: unknown): value is CorrelationKind =>
  has(AUTH_CORRELATIONS, value);
export const isProviderEventType = (
  value: unknown,
): value is ProviderEventType => has(PROVIDER_EVENT_TYPES, value);

/** The terminal outcome a neutral provider event contributes, if any. */
export const outcomeOfProviderEvent = (type: string): Outcome | undefined => {
  switch (type) {
    case "login_success":
    case "signup_success":
      return "success";
    case "login_failure":
    case "signup_failure":
    case "rate_limited":
      return "failed";
    default:
      return undefined;
  }
};

export const isSignupEventType = (type: string): boolean =>
  type === "signup_success" || type === "signup_failure";
