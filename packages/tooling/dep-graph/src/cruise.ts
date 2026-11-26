import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collapse, listPackages } from "./collapse.ts";
import type { CruiseResult, Graph } from "./types.ts";

const run = (
  command: string,
  args: readonly string[],
  cwd: string,
): { stdout: string; stderr: string; status: number | null } => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  };
};

const depcruiseBin = (): string => {
  let dir = dirname(fileURLToPath(import.meta.resolve("dependency-cruiser")));
  while (dir !== dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
        name?: unknown;
      };
      if (pkg.name === "dependency-cruiser") {
        return join(dir, "bin", "dependency-cruiser.mjs");
      }
    }
    dir = dirname(dir);
  }
  throw new Error("could not find the dependency-cruiser package");
};

export const repoRoot = (cwd: string): string => {
  const result = run("git", ["rev-parse", "--show-toplevel"], cwd);
  if (result.status !== 0) {
    throw new Error(`not a git repository: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
};

const targets = (root: string): string[] =>
  ["packages", "examples"].filter((target) => existsSync(join(root, target)));

const cruise = (root: string, configPath: string): CruiseResult => {
  const result = run(
    process.execPath,
    [
      depcruiseBin(),
      "--config",
      configPath,
      "--output-type",
      "json",
      ...targets(root),
    ],
    root,
  );

  // Exit code 2 means the rules were violated; the JSON is still complete.
  if (result.status !== 0 && result.status !== 2) {
    throw new Error(
      `dependency-cruiser failed (${result.status}): ${result.stderr.trim()}`,
    );
  }

  try {
    return JSON.parse(result.stdout) as CruiseResult;
  } catch {
    throw new Error(
      `dependency-cruiser produced no usable JSON: ${result.stderr.trim()}`,
    );
  }
};

/** The package graph of a checkout. The head config is used for both sides. */
export const graphFor = (root: string, configPath: string): Graph =>
  collapse(cruise(root, configPath), listPackages(root));

/**
 * Run `build` against a detached worktree of `ref`. The working tree is never
 * touched, and the worktree is removed even when the build throws.
 */
export function withWorktree<T>(
  root: string,
  ref: string,
  build: (dir: string) => T,
): T {
  const temp = mkdtempSync(join(tmpdir(), "auththread-dep-graph-"));
  const dir = join(temp, "base");
  const added = run("git", ["worktree", "add", "--detach", dir, ref], root);
  if (added.status !== 0) {
    rmSync(temp, { recursive: true, force: true });
    throw new Error(`could not check out ${ref}: ${added.stderr.trim()}`);
  }

  try {
    return build(dir);
  } finally {
    run("git", ["worktree", "remove", "--force", dir], root);
    run("git", ["worktree", "prune"], root);
    rmSync(temp, { recursive: true, force: true });
  }
}
