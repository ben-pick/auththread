import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  hashFiles,
  listDirectoryFiles,
  parseVendorLock,
  readVendorLock,
  serializeVendorLock,
  VENDOR_LOCK_PATH,
  type VendoredSkill,
  type VendorLock,
  verifyVendored,
} from "./vendor.ts";

/** `skills:update` could not complete (bad flags, git failure, missing SKILL.md). */
export class VendorUpdateError extends Error {
  override readonly name = "VendorUpdateError";
}

export interface UpdateOptions {
  readonly root: string;
  /** Limit the update to one upstream `owner/repo`. */
  readonly repo?: string;
  /** Limit the update to one skill by name. */
  readonly skill?: string;
  /** Pin to this commit instead of the remote default branch head. */
  readonly sha?: string;
  /** Resolve clone URLs; defaults to https://github.com/<repo>.git. */
  readonly remoteUrl?: (repo: string) => string;
  /** Date written to the lock, YYYY-MM-DD. */
  readonly today?: string;
  /** Print what would change without touching files. */
  readonly dryRun?: boolean;
}

export interface SkillChange {
  readonly name: string;
  readonly fromCommit: string;
  readonly toCommit: string;
  readonly added: string[];
  readonly removed: string[];
  readonly changed: string[];
}

export interface UpdateResult {
  readonly changes: SkillChange[];
  readonly messages: string[];
}

/** Re-fetch pinned sources, rewrite vendored copies and refresh the lock. */
export function updateVendored(options: UpdateOptions): UpdateResult {
  const parsed = readVendorLock(options.root);
  if (!parsed.ok) {
    throw new VendorUpdateError(`${VENDOR_LOCK_PATH}: ${parsed.error}`);
  }
  if (options.sha !== undefined && !/^[0-9a-f]{40}$/.test(options.sha)) {
    throw new VendorUpdateError("--sha must be a full 40-character commit SHA");
  }
  if (options.sha !== undefined && options.repo === undefined) {
    throw new VendorUpdateError("--sha requires --repo <owner/repo>");
  }
  const selected = parsed.value.skills.filter(
    (skill) =>
      (options.repo === undefined || skill.repo === options.repo) &&
      (options.skill === undefined || skill.name === options.skill),
  );
  if (selected.length === 0) {
    throw new VendorUpdateError(
      "no vendored skills match the given --repo/--skill",
    );
  }

  const remoteUrl =
    options.remoteUrl ?? ((repo: string) => `https://github.com/${repo}.git`);
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const scratch = mkdtempSync(join(tmpdir(), "agents-vendor-"));
  const changes: SkillChange[] = [];
  const messages: string[] = [];
  const updated = new Map<string, VendoredSkill>();

  try {
    const repos = [...new Set(selected.map((skill) => skill.repo))];
    for (const repo of repos) {
      const checkout = join(scratch, repo.replace("/", "__"));
      const commit = fetchSource(remoteUrl(repo), checkout, options.sha);
      for (const skill of selected.filter((entry) => entry.repo === repo)) {
        const files = collectUpstream(checkout, skill);
        const local = new Map(
          listDirectoryFiles(join(options.root, skill.dir)).map((path) => [
            path,
            readFileSync(join(options.root, skill.dir, path)),
          ]),
        );
        const next = new Map(files.map((file) => [file.path, file.content]));
        const change: SkillChange = {
          name: skill.name,
          fromCommit: skill.commit,
          toCommit: commit,
          added: [...next.keys()].filter((path) => !local.has(path)),
          removed: [...local.keys()].filter((path) => !next.has(path)),
          changed: [...next.keys()].filter((path) => {
            const before = local.get(path);
            const after = next.get(path);
            return (
              before !== undefined &&
              after !== undefined &&
              !before.equals(after)
            );
          }),
        };
        changes.push(change);
        updated.set(skill.name, {
          ...skill,
          commit,
          vendoredAt:
            skill.commit === commit &&
            change.added.length +
              change.removed.length +
              change.changed.length ===
              0
              ? skill.vendoredAt
              : today,
          hash: hashFiles(files),
        });
        if (options.dryRun !== true) {
          writeSkillDirectory(join(options.root, skill.dir), files);
        }
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  if (options.dryRun !== true) {
    const lock: VendorLock = {
      version: 1,
      skills: parsed.value.skills.map(
        (skill) => updated.get(skill.name) ?? skill,
      ),
    };
    const serialized = serializeVendorLock(lock);
    const reparsed = parseVendorLock(serialized);
    if (!reparsed.ok) {
      throw new VendorUpdateError(
        `refusing to write invalid lock: ${reparsed.error}`,
      );
    }
    mkdirSync(dirname(join(options.root, VENDOR_LOCK_PATH)), {
      recursive: true,
    });
    writeFileSync(join(options.root, VENDOR_LOCK_PATH), serialized);
    const drift = verifyVendored(options.root, {
      version: 1,
      skills: reparsed.value.skills.filter((skill) => updated.has(skill.name)),
    });
    if (drift.length > 0) {
      throw new VendorUpdateError(
        `post-update verification failed: ${drift[0]?.message}`,
      );
    }
  }

  for (const change of changes) {
    messages.push(describeChange(change));
  }
  if (options.dryRun === true) {
    messages.push("dry run: no files were written");
  } else {
    messages.push("review with git diff, then run pnpm agents:check");
  }
  return { changes, messages };
}

function describeChange(change: SkillChange): string {
  const total =
    change.added.length + change.removed.length + change.changed.length;
  const range =
    change.fromCommit === change.toCommit
      ? change.toCommit.slice(0, 12)
      : `${change.fromCommit.slice(0, 12)} -> ${change.toCommit.slice(0, 12)}`;
  if (total === 0) {
    return `${change.name}: unchanged (${range})`;
  }
  const parts = [
    `${change.added.length} added`,
    `${change.changed.length} changed`,
    `${change.removed.length} removed`,
  ];
  const lines = [`${change.name}: ${range}, ${parts.join(", ")}`];
  for (const path of change.added) {
    lines.push(`  + ${path}`);
  }
  for (const path of change.changed) {
    lines.push(`  ~ ${path}`);
  }
  for (const path of change.removed) {
    lines.push(`  - ${path}`);
  }
  return lines.join("\n");
}

/**
 * Fetch a repository into `target` with git only. Nothing from the clone is ever
 * executed: hooks are disabled and no package manager or script is run.
 */
function fetchSource(url: string, target: string, sha?: string): string {
  const git = (cwd: string | undefined, args: string[]): string =>
    execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "protocol.ext.allow=never",
        ...args,
      ],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  if (sha === undefined) {
    git(undefined, ["clone", "--depth", "1", "--quiet", url, target]);
  } else {
    mkdirSync(target, { recursive: true });
    git(target, ["init", "--quiet"]);
    git(target, ["remote", "add", "origin", url]);
    git(target, ["fetch", "--depth", "1", "--quiet", "origin", sha]);
    git(target, ["checkout", "--quiet", "FETCH_HEAD"]);
  }
  return git(target, ["rev-parse", "HEAD"]);
}

interface UpstreamFile {
  readonly path: string;
  readonly content: Buffer;
}

function collectUpstream(
  checkout: string,
  skill: VendoredSkill,
): UpstreamFile[] {
  const source = join(checkout, skill.path);
  const paths = listDirectoryFiles(source);
  if (!paths.includes("SKILL.md")) {
    throw new VendorUpdateError(
      `${skill.repo}:${skill.path} has no SKILL.md at that commit`,
    );
  }
  if (paths.includes("LICENSE")) {
    throw new VendorUpdateError(
      `${skill.repo}:${skill.path} ships its own LICENSE; extend skills:update before vendoring`,
    );
  }
  const link = readdirSync(source, {
    recursive: true,
    withFileTypes: true,
  }).find((entry) => entry.isSymbolicLink());
  if (link !== undefined) {
    throw new VendorUpdateError(
      `${skill.repo}:${skill.path} contains symlink ${link.name}`,
    );
  }
  const files: UpstreamFile[] = paths.map((path) => ({
    path,
    content: readFileSync(join(source, path)),
  }));
  files.push({
    path: "LICENSE",
    content: readFileSync(join(checkout, skill.licenseFile)),
  });
  return files;
}

function writeSkillDirectory(directory: string, files: UpstreamFile[]): void {
  rmSync(directory, { recursive: true, force: true });
  for (const file of files) {
    const target = join(directory, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
}
