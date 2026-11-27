import {
  type AuthMethod,
  type AuthUiStage,
  type AuthUiStep,
  isAuthUiStep,
} from "@auththread/schema";

/** What a provider page means in the neutral model. */
export interface UiScreenRule {
  readonly stage: AuthUiStage;
  readonly method?: AuthMethod;
  /** Provider's own factor or connection name, for auth.method.vendor_name. */
  readonly methodVendorName?: string;
}

export interface UiScreenInput {
  readonly vendorScreen?: string;
  readonly vendorPath?: string;
  /** Legacy auth.ui.step, accepted from old page snippets. */
  readonly legacyStep?: string;
}

export interface UiScreenClassification {
  readonly stage?: AuthUiStage;
  readonly method?: AuthMethod;
  readonly methodVendorName?: string;
}

export interface ScreenMap {
  readonly exact: Readonly<Record<string, UiScreenRule>>;
  readonly prefixes?: ReadonlyArray<readonly [string, UiScreenRule]>;
  readonly paths?: Readonly<Record<string, UiScreenRule>>;
}

const LEGACY_STAGE = {
  identifier: "identify",
  password: "authenticate",
  mfa_challenge: "verify",
  consent: "consent",
  signup: "identify",
  reset: "recover",
} as const satisfies Record<AuthUiStep, AuthUiStage>;

const classify = (rule: UiScreenRule): UiScreenClassification => ({
  stage: rule.stage,
  ...(rule.method === undefined ? {} : { method: rule.method }),
  ...(rule.methodVendorName === undefined
    ? {}
    : { methodVendorName: rule.methodVendorName }),
});

/**
 * Builds a provider screen classifier. Resolution is exact screen, exact path,
 * longest matching screen prefix, then the legacy step vocabulary. Unknown
 * input returns an empty classification: callers keep the vendor name and omit
 * the neutral stage rather than guessing.
 */
export function defineScreenMap(
  map: ScreenMap,
): (input: UiScreenInput) => UiScreenClassification {
  const prefixes = [...(map.prefixes ?? [])].sort(
    ([left], [right]) => right.length - left.length,
  );

  return (input) => {
    const screen = input.vendorScreen;
    if (screen !== undefined) {
      const exact = map.exact[screen];
      if (exact !== undefined) return classify(exact);
    }

    const path = input.vendorPath;
    if (path !== undefined) {
      const exact = map.paths?.[path];
      if (exact !== undefined) return classify(exact);
    }

    if (screen !== undefined) {
      for (const [prefix, rule] of prefixes) {
        if (screen.startsWith(prefix)) return classify(rule);
      }
    }

    const legacyStep = input.legacyStep;
    return isAuthUiStep(legacyStep) ? { stage: LEGACY_STAGE[legacyStep] } : {};
  };
}
