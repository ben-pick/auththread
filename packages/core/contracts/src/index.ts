import {
  AUTH_CORRELATIONS,
  AUTH_ERROR_SOURCES,
  AUTH_HOOK_DECISIONS,
  AUTH_HOOK_STAGES,
  AUTH_METHODS,
  AUTH_OUTCOMES,
  AUTH_PASSKEY_RESULTS,
  AUTH_UI_STAGES,
  AUTH_UI_STEPS,
  JOURNEY_KINDS,
  NEUTRAL_ATTRIBUTES,
  PROVIDER_EVENT_TYPES,
  WIDE_EVENT_EVENT_NAME,
  WIDE_EVENT_SCHEMA_VERSION,
  WIDE_EVENT_STEP_TYPES,
} from "@auththread/schema";
import { Schema } from "effect";

/**
 * The canonical Effect Schema for the neutral auth journey contract.
 *
 * This package is private and server-only. The enum tuples live in the
 * zero-dependency @auththread/schema package and are imported here; this
 * package projects them into Effect schemas and generates the published
 * wide-event JSON Schema. Do not import it from browser packages.
 */

export { WIDE_EVENT_EVENT_NAME, WIDE_EVENT_SCHEMA_VERSION };

const TRACE_ID = /^[0-9a-f]{32}$/u;
const SPAN_ID = /^[0-9a-f]{16}$/u;
const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);

export const TraceIdSchema = Schema.String.check(Schema.isPattern(TRACE_ID))
  .check(Schema.makeFilter((value: string) => value !== ZERO_TRACE))
  .pipe(Schema.brand("auththread/TraceId"));

export const SpanIdSchema = Schema.String.check(Schema.isPattern(SPAN_ID))
  .check(Schema.makeFilter((value: string) => value !== ZERO_SPAN))
  .pipe(Schema.brand("auththread/SpanId"));

export const AttributeValueSchema = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.Array(Schema.String),
]);

export const AttributesSchema = Schema.Record(
  Schema.String,
  AttributeValueSchema,
);

export const JourneyKindSchema = Schema.Literals(JOURNEY_KINDS);
export type JourneyKind = Schema.Schema.Type<typeof JourneyKindSchema>;

export const AuthUiStageSchema = Schema.Literals(AUTH_UI_STAGES);
export type AuthUiStage = Schema.Schema.Type<typeof AuthUiStageSchema>;

export const AuthMethodSchema = Schema.Literals(AUTH_METHODS);
export type AuthMethod = Schema.Schema.Type<typeof AuthMethodSchema>;

export const AuthOutcomeSchema = Schema.Literals(AUTH_OUTCOMES);
export type Outcome = Schema.Schema.Type<typeof AuthOutcomeSchema>;

export const AuthErrorSourceSchema = Schema.Literals(AUTH_ERROR_SOURCES);
export type AuthErrorSource = Schema.Schema.Type<typeof AuthErrorSourceSchema>;

export const AuthHookStageSchema = Schema.Literals(AUTH_HOOK_STAGES);
export type AuthHookStage = Schema.Schema.Type<typeof AuthHookStageSchema>;

export const AuthHookDecisionSchema = Schema.Literals(AUTH_HOOK_DECISIONS);
export type AuthHookDecision = Schema.Schema.Type<
  typeof AuthHookDecisionSchema
>;

export const AuthCorrelationSchema = Schema.Literals(AUTH_CORRELATIONS);
export type CorrelationKind = Schema.Schema.Type<typeof AuthCorrelationSchema>;

export const AuthPasskeyResultSchema = Schema.Literals(AUTH_PASSKEY_RESULTS);
export type AuthPasskeyResult = Schema.Schema.Type<
  typeof AuthPasskeyResultSchema
>;

export const AuthUiStepSchema = Schema.Literals(AUTH_UI_STEPS);
export type AuthUiStep = Schema.Schema.Type<typeof AuthUiStepSchema>;

export const ProviderEventTypeSchema = Schema.Literals(PROVIDER_EVENT_TYPES);
export type ProviderEventType = Schema.Schema.Type<
  typeof ProviderEventTypeSchema
>;

export const WideEventStepTypeSchema = Schema.Literals(WIDE_EVENT_STEP_TYPES);
export type WideEventStepType = Schema.Schema.Type<
  typeof WideEventStepTypeSchema
>;

export const NeutralAttributeSchema = Schema.Literals(NEUTRAL_ATTRIBUTES);
export type AuthAttribute = Schema.Schema.Type<typeof NeutralAttributeSchema>;

const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const WideEventStepSchema = Schema.Struct({
  name: Schema.String,
  type: WideEventStepTypeSchema,
  startOffsetMs: NonNegative,
  durationMs: NonNegative,
  stage: Schema.optionalKey(AuthUiStageSchema),
  method: Schema.optionalKey(AuthMethodSchema),
  vendorScreen: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,95}$/u)),
  ),
  decision: Schema.optionalKey(Schema.String),
  errorCode: Schema.optionalKey(Schema.String),
});
export type WideEventStep = Schema.Schema.Type<typeof WideEventStepSchema>;

export const WideEventSchema = Schema.Struct({
  schemaVersion: Schema.Literal(WIDE_EVENT_SCHEMA_VERSION),
  event: Schema.Literal(WIDE_EVENT_EVENT_NAME),
  traceId: TraceIdSchema,
  spanId: SpanIdSchema,
  kind: JourneyKindSchema,
  outcome: AuthOutcomeSchema,
  provider: Schema.String.check(Schema.isMinLength(1)),
  tenant: Schema.String.check(Schema.isMinLength(1)),
  startedAt: Schema.String,
  durationMs: NonNegative,
  attributes: AttributesSchema,
  steps: Schema.Array(WideEventStepSchema),
  correlationCounts: Schema.Struct({
    exact: NonNegativeInt,
    inferred: NonNegativeInt,
  }),
});
export type WideEvent = Schema.Schema.Type<typeof WideEventSchema>;
