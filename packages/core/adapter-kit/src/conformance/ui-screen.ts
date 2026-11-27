import {
  type AuthMethod,
  type AuthUiStage,
  isAuthMethod,
  isAuthUiStage,
} from "@auththread/schema";
import type { ProviderAdapter } from "../provider.ts";
import type { ConformanceReport } from "./report.ts";
import { checker } from "./report.ts";

export interface UiScreenExpectation {
  readonly screen: string;
  readonly stage: AuthUiStage;
  readonly method?: AuthMethod;
  readonly methodVendorName?: string;
}

export interface UiScreenFixture {
  readonly provider: string;
  readonly screens: readonly UiScreenExpectation[];
  readonly paths?: ReadonlyArray<{
    readonly path: string;
    readonly stage: AuthUiStage;
    readonly method?: AuthMethod;
    readonly methodVendorName?: string;
  }>;
}

/**
 * Proves that a provider's hosted-page screen map covers every screen in the
 * fixture, returns the expected neutral stage, and never guesses for unknown
 * input. An unmapped screen is allowed at runtime, but it must be explicit in
 * the fixture, not silently defaulted.
 */
export function runUiScreenConformance<Settings>(
  adapter: ProviderAdapter<Settings>,
  fixture: UiScreenFixture,
): ConformanceReport {
  const result = checker(`ui-screen:${adapter.id}`);
  const classify = adapter.classifyUiScreen;

  result.check(adapter.id === fixture.provider, "fixture provider mismatch");
  result.check(classify !== undefined, "adapter has no classifyUiScreen");
  result.check(
    new Set(fixture.screens.map((entry) => entry.screen)).size ===
      fixture.screens.length,
    "fixture contains duplicate screens",
  );
  result.check(
    fixture.screens.every((entry) => isAuthUiStage(entry.stage)),
    "fixture contains an invalid stage",
  );
  result.check(
    fixture.screens.every(
      (entry) => entry.method === undefined || isAuthMethod(entry.method),
    ),
    "fixture contains an invalid method",
  );

  if (classify !== undefined) {
    for (const expected of fixture.screens) {
      const actual = classify({ vendorScreen: expected.screen });
      result.check(
        actual.stage === expected.stage,
        `${expected.screen} mapped to ${String(actual.stage)}, expected ${expected.stage}`,
      );
      result.check(
        actual.method === expected.method,
        `${expected.screen} method ${String(actual.method)}, expected ${String(expected.method)}`,
      );
      result.check(
        actual.methodVendorName === expected.methodVendorName,
        `${expected.screen} vendor method ${String(actual.methodVendorName)}, expected ${String(expected.methodVendorName)}`,
      );
    }

    for (const expected of fixture.paths ?? []) {
      const actual = classify({ vendorPath: expected.path });
      result.check(
        actual.stage === expected.stage,
        `${expected.path} mapped to ${String(actual.stage)}, expected ${expected.stage}`,
      );
      result.check(
        actual.method === expected.method,
        `${expected.path} method ${String(actual.method)}, expected ${String(expected.method)}`,
      );
    }

    const unknown = classify({ vendorScreen: "auththread-unknown-screen" });
    result.check(
      unknown.stage === undefined &&
        unknown.method === undefined &&
        unknown.methodVendorName === undefined,
      "unknown screen was given a default classification",
    );
  }

  return result.report();
}
