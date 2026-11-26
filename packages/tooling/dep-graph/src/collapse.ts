import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CruiseResult,
  Graph,
  GraphEdge,
  PackageInfo,
  Tier,
} from "./types.ts";
import { TIERS } from "./types.ts";

const PACKAGE_PATTERN =
  /^(packages\/(?:core|providers|runtimes|sinks|tooling)\/[^/]+|examples\/[^/]+)(?:\/|$)/;

export const compare = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

const tierRank = new Map<Tier, number>(
  TIERS.map((tier, index) => [tier, index]),
);

const compareNodes = (
  a: { tier: Tier; path: string },
  b: { tier: Tier; path: string },
): number =>
  (tierRank.get(a.tier) ?? TIERS.length) -
    (tierRank.get(b.tier) ?? TIERS.length) || compare(a.path, b.path);

/** Repo-relative file path -> workspace package directory. */
export function packageOf(file: string): string | undefined {
  return PACKAGE_PATTERN.exec(file)?.[1];
}

export function tierOf(packagePath: string): Tier {
  if (packagePath.startsWith("examples/")) return "examples";
  return packagePath.split("/")[1] as Tier;
}

/** `@auththread/x/sub` -> `@auththread/x`; `pkg/sub` -> `pkg`. */
export function bareSpecifier(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : (parts[0] ?? "");
}

/** Read every workspace package from the directory layout, not from a glob. */
export function listPackages(root: string): PackageInfo[] {
  const found: PackageInfo[] = [];
  const add = (relative: string): void => {
    try {
      const raw = JSON.parse(
        readFileSync(join(root, relative, "package.json"), "utf8"),
      ) as { name?: unknown };
      if (typeof raw.name !== "string" || raw.name.length === 0) return;
      found.push({
        path: relative,
        name: raw.name,
        tier: tierOf(relative),
      });
    } catch {
      // A directory without a package.json is not a workspace package.
    }
  };

  for (const tier of ["core", "providers", "runtimes", "sinks", "tooling"]) {
    for (const child of children(join(root, "packages", tier))) {
      add(`packages/${tier}/${child}`);
    }
  }
  for (const child of children(join(root, "examples"))) {
    add(`examples/${child}`);
  }

  return found.sort(compareNodes);
}

function children(dir: string): string[] {
  try {
    // Synchronous fs is fine: this tool runs once per PR.
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compare);
  } catch {
    return [];
  }
}

/**
 * Collapse file-level cruise output to workspace packages. A dependency that
 * could not be followed (the base checkout has no node_modules) falls back to
 * the import specifier, which is enough for workspace package names.
 */
export function collapse(
  result: CruiseResult,
  packages: readonly PackageInfo[],
): Graph {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg.path]));
  const nodes = new Map(
    packages.map((pkg) => [
      pkg.path,
      { path: pkg.path, name: pkg.name, tier: pkg.tier },
    ]),
  );

  const edges = new Map<string, GraphEdge>();
  for (const module of result.modules) {
    const from = packageOf(module.source);
    if (from === undefined) continue;

    for (const dependency of module.dependencies) {
      const to =
        packageOf(dependency.resolved ?? "") ??
        byName.get(bareSpecifier(dependency.module));
      if (to === undefined || to === from) continue;

      const key = `${from}\u0000${to}`;
      const edge = edges.get(key) ?? { from, to, violations: [] };
      for (const rule of dependency.rules ?? []) {
        if (!edge.violations.includes(rule.name)) {
          edge.violations.push(rule.name);
        }
      }
      edges.set(key, edge);
    }
  }

  return {
    nodes: [...nodes.values()].sort(compareNodes),
    edges: [...edges.values()].sort(
      (a, b) => compare(a.from, b.from) || compare(a.to, b.to),
    ),
    violationCount: result.summary?.violations?.length ?? 0,
  };
}
