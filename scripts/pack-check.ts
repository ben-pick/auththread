import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

interface PublicPackage {
  readonly directory: string;
  readonly required: readonly string[];
}

const root = resolve(import.meta.dirname, "..");

const schemaFiles = readdirSync(join(root, "packages/core/schema/schema"))
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => `schema/${file}`);

const packages: readonly PublicPackage[] = [
  {
    directory: "packages/core/schema",
    required: ["dist/index.js", "dist/index.d.ts", ...schemaFiles],
  },
  {
    directory: "packages/core/otlp",
    required: ["dist/index.js", "dist/index.d.ts"],
  },
  {
    directory: "packages/core/adapter-kit",
    required: ["dist/index.js", "dist/index.d.ts"],
  },
  {
    directory: "packages/core/stitcher",
    required: ["dist/index.js", "dist/index.d.ts"],
  },
  {
    directory: "packages/core/browser",
    required: ["dist/index.js", "dist/index.d.ts"],
  },
  {
    directory: "packages/sdk",
    required: [
      "dist/index.js",
      "dist/index.d.ts",
      "dist/node.js",
      "dist/node.d.ts",
      "dist/cloudflare.js",
      "dist/cloudflare.d.ts",
    ],
  },
  {
    directory: "packages/providers/auth0-actions",
    required: ["dist/index.js"],
  },
  {
    directory: "packages/providers/auth0",
    required: [
      "dist/index.js",
      "dist/index.d.ts",
      "dist/browser.js",
      "dist/browser.d.ts",
      "dist/actions.js",
      "dist/actions.d.ts",
      "dist/actions.cjs",
      "page/snippet.js",
    ],
  },
  {
    directory: "packages/providers/oidc",
    required: [
      "dist/index.js",
      "dist/index.d.ts",
      "dist/browser.js",
      "dist/browser.d.ts",
    ],
  },
  {
    directory: "packages/runtimes/node",
    required: ["dist/index.js", "dist/index.d.ts"],
  },
  {
    directory: "packages/runtimes/cloudflare",
    required: ["dist/index.js", "dist/index.d.ts"],
  },
  {
    directory: "packages/sinks/otlp",
    required: ["dist/index.js", "dist/index.d.ts"],
  },
  {
    directory: "packages/sinks/wide-event",
    required: ["dist/index.js", "dist/index.d.ts"],
  },
  {
    directory: "packages/sinks/webhook",
    required: ["dist/index.js", "dist/index.d.ts"],
  },
  {
    directory: "packages/sinks/object-store",
    required: ["dist/index.js", "dist/index.d.ts"],
  },
];

const filesInTarball = (tarball: string): string[] =>
  execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 0);

const readManifest = (tarball: string): string => {
  const extract = mkdtempSync(join(tmpdir(), "auththread-pack-manifest-"));
  try {
    execFileSync("tar", [
      "-xzf",
      tarball,
      "-C",
      extract,
      "package/package.json",
    ]);
    return readFileSync(join(extract, "package/package.json"), "utf8");
  } finally {
    rmSync(extract, { recursive: true, force: true });
  }
};

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const main = (): void => {
  const output = mkdtempSync(join(tmpdir(), "auththread-pack-"));
  let failures = 0;

  try {
    for (const entry of packages) {
      const directory = join(root, entry.directory);
      try {
        execFileSync("pnpm", ["pack", "--pack-destination", output], {
          cwd: directory,
          stdio: "pipe",
        });
        const tarball = join(
          output,
          readdirSync(output)
            .filter((file) => file.endsWith(".tgz"))
            .sort()
            .at(-1) ?? "",
        );
        assert(tarball.endsWith(".tgz"), "pnpm pack produced no tarball");

        const files = filesInTarball(tarball);
        const names = new Set(
          files.map((file) => file.replace(/^package\//, "")),
        );
        assert(
          names.has("README.md"),
          `${entry.directory} is missing README.md`,
        );
        assert(names.has("LICENSE"), `${entry.directory} is missing LICENSE`);
        for (const required of entry.required) {
          assert(
            names.has(required),
            `${entry.directory} is missing ${required}`,
          );
        }
        assert(
          !files.some((file) => file.includes(".test.")),
          `${entry.directory} packs test files`,
        );
        assert(
          !files.some((file) => file.startsWith("package/src/")),
          `${entry.directory} packs TypeScript source`,
        );

        const packedLicense = execFileSync(
          "tar",
          ["-xOf", tarball, "package/LICENSE"],
          { encoding: "utf8" },
        );
        assert(
          packedLicense.trimEnd() ===
            readFileSync(join(root, "LICENSE"), "utf8").trimEnd(),
          `${entry.directory} ships a different LICENSE`,
        );

        const manifestText = readManifest(tarball);
        const manifest = JSON.parse(manifestText) as {
          dependencies?: Record<string, string>;
          exports?: Record<string, unknown>;
          publishConfig?: { exports?: Record<string, unknown> };
        };
        assert(
          !manifestText.includes("workspace:"),
          `${entry.directory} packs workspace protocol`,
        );
        assert(
          !manifestText.includes("catalog:"),
          `${entry.directory} packs catalog protocol`,
        );
        const exports = manifest.publishConfig?.exports ?? manifest.exports;
        assert(
          exports !== undefined && JSON.stringify(exports).includes("./dist/"),
          `${entry.directory} does not publish dist exports`,
        );

        const declarations = files.filter((file) => file.endsWith(".d.ts"));
        for (const declaration of declarations) {
          const extract = mkdtempSync(join(tmpdir(), "auththread-dts-"));
          try {
            execFileSync("tar", ["-xzf", tarball, "-C", extract, declaration]);
            const text = readFileSync(join(extract, declaration), "utf8");
            assert(
              !text.includes('.ts"') && !text.includes(".ts'"),
              `${entry.directory} declaration ${declaration} still imports .ts`,
            );
          } finally {
            rmSync(extract, { recursive: true, force: true });
          }
        }

        rmSync(tarball, { force: true });
        execFileSync("pnpm", ["exec", "publint", directory], {
          cwd: root,
          stdio: "pipe",
        });
        console.log(`ok ${entry.directory}`);
      } catch (error) {
        failures += 1;
        console.error(`FAIL ${entry.directory}: ${(error as Error).message}`);
      }
    }
  } finally {
    rmSync(output, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`${failures} package(s) failed`);
    process.exit(1);
  }
  console.log(`${packages.length} packages packed and verified`);
};

main();
