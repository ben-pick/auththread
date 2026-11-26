import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { build, transform } from "esbuild";

export const BUDGETS = {
  browserSdk: 5 * 1024,
  pageSnippet: 8 * 1024,
} as const;

export interface Measurement {
  readonly name: string;
  readonly shippedBytes: number;
  readonly minifiedBytes: number;
  readonly gzippedBytes: number;
  readonly budgetBytes?: number;
  readonly ok: boolean;
}

export interface BundleResult {
  readonly code: Uint8Array;
  readonly minifiedBytes: number;
  readonly gzippedBytes: number;
}

const root = resolve(import.meta.dirname, "../../../..");
const keycloakDir = resolve(root, "examples/keycloak-compose");

export const withinBudget = (
  gzippedBytes: number,
  budgetBytes: number,
): boolean => gzippedBytes <= budgetBytes;

const run = async (
  options: Parameters<typeof build>[0],
): Promise<BundleResult> => {
  const result = await build({ ...options, logLevel: "silent", write: false });
  const code = result.outputFiles?.[0]?.contents;
  if (code === undefined) throw new Error("esbuild produced no output");
  return {
    code,
    minifiedBytes: code.length,
    gzippedBytes: gzipSync(code).length,
  };
};

/** Bundles a file exactly as a customer would: minified, ES2020, no polyfills. */
export const bundleFile = (entry: string): Promise<BundleResult> =>
  run({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2020",
  });

/**
 * The SDK alone, with no demo app code, so the budget measures the library and
 * not the example that happens to import it.
 */
export const bundleBrowserSdk = (): Promise<BundleResult> =>
  run({
    stdin: {
      contents: [
        'import { init } from "@auththread/browser";',
        'import { oidcBrowser } from "@auththread/oidc/browser";',
        "globalThis.auththread = { init, oidcBrowser };",
      ].join("\n"),
      resolveDir: keycloakDir,
      loader: "ts",
      sourcefile: "sdk-budget.ts",
    },
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2020",
  });

export async function measureSnippet(): Promise<Measurement> {
  const path = resolve(root, "packages/providers/auth0/page/snippet.js");
  const shipped = readFileSync(path);
  const minified = await transform(shipped, { loader: "js", minify: true });
  const gzipped = gzipSync(shipped).length;

  return {
    name: "page snippet",
    shippedBytes: shipped.length,
    minifiedBytes: minified.code.length,
    gzippedBytes: gzipped,
    budgetBytes: BUDGETS.pageSnippet,
    ok: withinBudget(gzipped, BUDGETS.pageSnippet),
  };
}

export async function measureAll(): Promise<Measurement[]> {
  const sdk = await bundleBrowserSdk();
  const app = await bundleFile(resolve(keycloakDir, "web/app.ts"));
  const snippet = await measureSnippet();

  return [
    {
      name: "browser SDK",
      shippedBytes: sdk.minifiedBytes,
      minifiedBytes: sdk.minifiedBytes,
      gzippedBytes: sdk.gzippedBytes,
      budgetBytes: BUDGETS.browserSdk,
      ok: withinBudget(sdk.gzippedBytes, BUDGETS.browserSdk),
    },
    {
      name: "keycloak example app (informational)",
      shippedBytes: app.minifiedBytes,
      minifiedBytes: app.minifiedBytes,
      gzippedBytes: app.gzippedBytes,
      ok: true,
    },
    snippet,
  ];
}
