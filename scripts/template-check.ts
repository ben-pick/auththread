import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const workerPackage = JSON.parse(
  read("templates/cloudflare-worker/package.json"),
) as {
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

assert(
  workerPackage.dependencies?.["@auththread/sdk"]?.startsWith("^") === true,
  "the Worker template must install a published @auththread/sdk version",
);
assert(
  workerPackage.scripts?.deploy === "wrangler deploy",
  "the Worker template must deploy with Wrangler",
);

const wrangler = read("templates/cloudflare-worker/wrangler.jsonc");
assert(
  wrangler.includes('"AUTHTHREAD_TENANTS"'),
  "the Worker template must declare AUTHTHREAD_TENANTS",
);
assert(
  wrangler.includes('"JourneyDurableObject"'),
  "the Worker template must bind the Durable Object class",
);
assert(
  !(wrangler.includes('"exports"') && wrangler.includes('"migrations"')),
  "wrangler.jsonc must not declare both exports and migrations",
);

const workerSource = read("templates/cloudflare-worker/src/index.ts");
assert(
  workerSource.includes("createCloudflareRuntime"),
  "the Worker template must use the SDK runtime entrypoint",
);

const compose = read("examples/local-compose/compose.yaml");
assert(
  compose.includes("ghcr.io/ben-pick/auththread"),
  "compose must pin the published image",
);
assert(
  compose.includes("AUTHTHREAD_CONFIG"),
  "compose must mount the tenant config contract",
);

console.log("deployment templates are consistent");

// Typecheck the template against the workspace source. Published packages use
// dist declarations, but the source exports are enough to catch API drift.
const temp = mkdtempSync(join(tmpdir(), "auththread-template-"));
try {
  cpSync(join(root, "templates/cloudflare-worker"), temp, { recursive: true });
  const modules = join(temp, "node_modules/@auththread");
  mkdirSync(modules, { recursive: true });
  const packageDirs = [
    "packages/core/schema",
    "packages/core/otlp",
    "packages/core/adapter-kit",
    "packages/core/stitcher",
    "packages/core/config",
    "packages/sdk",
    "packages/providers/auth0",
    "packages/providers/oidc",
    "packages/runtimes/node",
    "packages/runtimes/cloudflare",
    "packages/sinks/otlp",
    "packages/sinks/wide-event",
    "packages/sinks/webhook",
    "packages/sinks/object-store",
  ];
  for (const directory of packageDirs) {
    const manifest = JSON.parse(
      readFileSync(join(root, directory, "package.json"), "utf8"),
    ) as { name: string };
    symlinkSync(
      join(root, directory),
      join(modules, manifest.name.replace("@auththread/", "")),
      "dir",
    );
  }
  execFileSync("pnpm", ["exec", "tsc", "-p", join(temp, "tsconfig.json")], {
    cwd: root,
    stdio: "pipe",
  });
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log("Cloudflare template typechecks");
