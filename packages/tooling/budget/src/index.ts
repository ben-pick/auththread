import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { build, type Plugin, transform } from "esbuild";

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

export const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const keycloakDir = (root: string): string =>
  resolve(root, "examples/keycloak-compose");

export const withinBudget = (
  gzippedBytes: number,
  budgetBytes: number,
): boolean => gzippedBytes <= budgetBytes;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The import target of a workspace package, read from its manifest. */
const packageEntry = (dir: string, exportsField: unknown): string => {
  if (typeof exportsField === "string") return resolve(dir, exportsField);
  if (isRecord(exportsField)) {
    const root = exportsField["."];
    if (typeof root === "string") return resolve(dir, root);
    if (isRecord(root)) {
      for (const condition of ["import", "default", "module"]) {
        const target = root[condition];
        if (typeof target === "string") return resolve(dir, target);
      }
    }
  }
  return resolve(dir, "src/index.ts");
};

/**
 * Maps every workspace package to its source under `root`. The base worktree
 * has no `node_modules`, so resolving by name has to come from the manifests
 * rather than from pnpm's links.
 */
const workspaceEntries = (root: string): Map<string, string> => {
  const entries = new Map<string, string>();
  for (const tier of readdirSync(resolve(root, "packages"))) {
    const tierDir = resolve(root, "packages", tier);
    for (const name of readdirSync(tierDir)) {
      const dir = resolve(tierDir, name);
      const manifest = resolve(dir, "package.json");
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
        name?: unknown;
        exports?: unknown;
      };
      if (typeof pkg.name !== "string") continue;
      entries.set(pkg.name, packageEntry(dir, pkg.exports));
    }
  }
  return entries;
};

const workspacePlugin = (root: string): Plugin => ({
  name: "auththread-workspace",
  setup(build) {
    const entries = workspaceEntries(root);
    build.onResolve({ filter: /^@auththread\// }, (args) => {
      const entry = entries.get(args.path);
      return entry === undefined ? undefined : { path: entry };
    });
  },
});

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
export const bundleFile = (
  entry: string,
  root: string = REPO_ROOT,
): Promise<BundleResult> =>
  run({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2020",
    plugins: [workspacePlugin(root)],
  });

/**
 * The SDK alone, with no demo app code, so the budget measures the library and
 * not the example that happens to import it.
 */
export const bundleBrowserSdk = (
  root: string = REPO_ROOT,
): Promise<BundleResult> =>
  run({
    stdin: {
      contents: [
        'import { init } from "@auththread/browser";',
        'import { oidcBrowser } from "@auththread/oidc";',
        "globalThis.auththread = { init, oidcBrowser };",
      ].join("\n"),
      resolveDir: keycloakDir(root),
      loader: "ts",
      sourcefile: "sdk-budget.ts",
    },
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2020",
    plugins: [workspacePlugin(root)],
  });

export async function measureSnippet(
  root: string = REPO_ROOT,
): Promise<Measurement> {
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

export async function measureAll(
  root: string = REPO_ROOT,
): Promise<Measurement[]> {
  const sdk = await bundleBrowserSdk(root);
  const app = await bundleFile(resolve(keycloakDir(root), "web/app.ts"), root);
  const snippet = await measureSnippet(root);

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
