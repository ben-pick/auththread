import type { Attributes, AttributeValue } from "./attributes.ts";
import { NEUTRAL_ATTRIBUTES } from "./attributes.ts";
import { sha256Hex } from "./sha256.ts";

const ALLOWED = new Set<string>(NEUTRAL_ATTRIBUTES);

const SECRET_KEY =
  /pass|password|secret|token|otp|credential|cookie|authorization|(^|\.)code$/i;
const USER_KEY = /(^|\.)(user_?id|email|username|user_email)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;
const BEARER = /bearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const MAX_TEXT = 200;

export interface RedactionSettings {
  /** Per tenant salt. Without one, user identifiers are dropped rather than stored raw. */
  readonly salt?: string;
}

export const isSecretKey = (key: string): boolean =>
  !ALLOWED.has(key) && SECRET_KEY.test(key);

export const isUserIdentifierKey = (key: string): boolean => USER_KEY.test(key);

export function hashUser(value: string, salt: string): string {
  return `u_${sha256Hex(`${salt}:${value}`).slice(0, 16)}`;
}

export function redactText(value: string): string {
  return value
    .replace(EMAIL, "[email]")
    .replace(JWT, "[token]")
    .replace(BEARER, "bearer [redacted]")
    .slice(0, MAX_TEXT);
}

function redactValue(value: AttributeValue): AttributeValue {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactText);
  return value;
}

/**
 * Applied twice on purpose: by the emitter and again by the stitcher. A customer
 * who forgets to configure a salt loses user hashes, not user identities.
 */
export function redactAttributes(
  attributes: Attributes,
  settings: RedactionSettings,
): Attributes {
  const out: Record<string, AttributeValue> = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (isSecretKey(key)) continue;

    if (key === "auth.user.hash") {
      out[key] = value;
      continue;
    }

    if (isUserIdentifierKey(key)) {
      if (typeof value !== "string" || settings.salt === undefined) continue;
      out["auth.user.hash"] = hashUser(value, settings.salt);
      continue;
    }

    out[key] = redactValue(value);
  }

  return out;
}
