import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const git = (root: string, args: readonly string[]) => {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  return result;
};

/**
 * Run `build` against a detached worktree of `ref`. The working tree is never
 * touched, and the worktree is removed even when the build throws. Async
 * because measuring the base bundles its source instead of reading a report.
 */
export async function withWorktree<T>(
  root: string,
  ref: string,
  build: (dir: string) => Promise<T>,
): Promise<T> {
  const temp = mkdtempSync(join(tmpdir(), "auththread-budget-"));
  const dir = join(temp, "base");
  const added = git(root, ["worktree", "add", "--detach", dir, ref]);
  if (added.status !== 0) {
    rmSync(temp, { recursive: true, force: true });
    throw new Error(`could not check out ${ref}: ${added.stderr.trim()}`);
  }

  try {
    return await build(dir);
  } finally {
    git(root, ["worktree", "remove", "--force", dir]);
    git(root, ["worktree", "prune"]);
    rmSync(temp, { recursive: true, force: true });
  }
}
