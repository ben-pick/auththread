export const AUTH_SCHEMA_VERSION = "1" as const;

export const NEUTRAL_ATTRIBUTES = [
  "auth.provider",
  "auth.tenant",
  "auth.client_id",
  "auth.journey.kind",
  "auth.user.hash",
  "auth.method",
  "auth.method.vendor_name",
  "auth.ui.step",
  "auth.ui.vendor_screen",
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
  "auth.correlation",
  "auth.passkey.result",
] as const;

export type AuthAttribute = (typeof NEUTRAL_ATTRIBUTES)[number];

export type AttributeValue = string | number | boolean | readonly string[];

/** Open map: neutral keys are typed, and OTel keys such as service.name pass through. */
export type Attributes = Readonly<Record<string, AttributeValue>>;

export const JOURNEY_KINDS = ["login", "signup", "reset", "step_up"] as const;
export type JourneyKind = (typeof JOURNEY_KINDS)[number];

export const AUTH_METHODS = [
  "password",
  "social",
  "enterprise_sso",
  "passwordless",
  "passkey",
  "mfa",
] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

export const AUTH_UI_STEPS = [
  "identifier",
  "password",
  "mfa_challenge",
  "consent",
  "signup",
  "reset",
] as const;
export type AuthUiStep = (typeof AUTH_UI_STEPS)[number];

export const AUTH_HOOK_STAGES = [
  "pre_signup",
  "post_signup",
  "pre_auth",
  "post_auth",
  "pre_token",
] as const;
export type AuthHookStage = (typeof AUTH_HOOK_STAGES)[number];

export const AUTH_HOOK_DECISIONS = [
  "continue",
  "deny",
  "redirect",
  "challenge",
] as const;
export type AuthHookDecision = (typeof AUTH_HOOK_DECISIONS)[number];

export const AUTH_ERROR_SOURCES = ["app", "ui", "hook", "provider"] as const;
export type AuthErrorSource = (typeof AUTH_ERROR_SOURCES)[number];

export const AUTH_OUTCOMES = [
  "success",
  "failed",
  "abandoned",
  "denied",
] as const;
export type Outcome = (typeof AUTH_OUTCOMES)[number];

export const AUTH_CORRELATIONS = ["exact", "inferred"] as const;
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
export const isAuthUiStep = (value: unknown): value is AuthUiStep =>
  has(AUTH_UI_STEPS, value);
export const isAuthHookStage = (value: unknown): value is AuthHookStage =>
  has(AUTH_HOOK_STAGES, value);
export const isAuthHookDecision = (value: unknown): value is AuthHookDecision =>
  has(AUTH_HOOK_DECISIONS, value);
export const isAuthErrorSource = (value: unknown): value is AuthErrorSource =>
  has(AUTH_ERROR_SOURCES, value);
export const isCorrelationKind = (value: unknown): value is CorrelationKind =>
  has(AUTH_CORRELATIONS, value);
