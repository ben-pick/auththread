import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, posix } from "node:path";

export const VENDOR_LOCK_PATH = ".agents/skills/vendor.lock.json";

export interface VendoredSkill {
  /** Skill name; equals the local directory name. */
  readonly name: string;
  /** Repo-relative local directory, for example `.agents/skills/wrangler`. */
  readonly dir: string;
  /** Upstream repository as `owner/repo` on github.com. */
  readonly repo: string;
  /** Skill directory inside the upstream repository. */
  readonly path: string;
  /** Upstream commit the copy was taken from. */
  readonly commit: string;
  /** SPDX identifier of the upstream license. */
  readonly license: string;
  /** Upstream license file, relative to the repository root. */
  readonly licenseFile: string;
  /** ISO date (YYYY-MM-DD) the copy was taken. */
  readonly vendoredAt: string;
  /** Hash of every file in `dir`, see {@link hashDirectory}. */
  readonly hash: string;
}

export interface VendorLock {
  readonly version: 1;
  readonly skills: VendoredSkill[];
}

export type ParseResult =
  | { readonly ok: true; readonly value: VendorLock }
  | { readonly ok: false; readonly error: string };

class LockError extends Error {}

function fail(path: string, message: string): never {
  throw new LockError(`${path}: ${message}`);
}

const asRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value as Record<string, unknown>;
};

const asString = (value: unknown, path: string): string => {
  if (typeof value !== "string") {
    fail(path, "must be a string");
  }
  return value;
};

/** A relative path with no `..` segment, empty segment or leading slash. */
const relativePath = (value: unknown, path: string): string => {
  const text = asString(value, path);
  if (
    text === "" ||
    isAbsolute(text) ||
    posix.normalize(text) !== text ||
    text === ".." ||
    text.startsWith("../")
  ) {
    fail(path, "must be a relative path");
  }
  return text;
};

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

const parseSkill = (value: unknown, index: number): VendoredSkill => {
  const path = `skills[${index}]`;
  const record = asRecord(value, path);

  const name = asString(record.name, `${path}.name`);
  if (!NAME_PATTERN.test(name)) {
    fail(`${path}.name`, "must be kebab-case");
  }

  const dir = asString(record.dir, `${path}.dir`);
  if (dir !== `.agents/skills/${name}`) {
    fail(`${path}.dir`, `must be ".agents/skills/${name}"`);
  }

  const repo = asString(record.repo, `${path}.repo`);
  if (!REPO_PATTERN.test(repo)) {
    fail(`${path}.repo`, "must be owner/repo");
  }

  const commit = asString(record.commit, `${path}.commit`);
  if (!COMMIT_PATTERN.test(commit)) {
    fail(`${path}.commit`, "must be a 40-character commit SHA");
  }

  const license = asString(record.license, `${path}.license`);
  if (license.length === 0) {
    fail(`${path}.license`, "must not be empty");
  }

  const vendoredAt = asString(record.vendoredAt, `${path}.vendoredAt`);
  if (!DATE_PATTERN.test(vendoredAt)) {
    fail(`${path}.vendoredAt`, "must be YYYY-MM-DD");
  }

  const hash = asString(record.hash, `${path}.hash`);
  if (!HASH_PATTERN.test(hash)) {
    fail(`${path}.hash`, "must be sha256:<hex>");
  }

  return {
    name,
    dir,
    repo,
    path: relativePath(record.path, `${path}.path`),
    commit,
    license,
    licenseFile: relativePath(record.licenseFile, `${path}.licenseFile`),
    vendoredAt,
    hash,
  };
};

/** Parse and validate the lock file. Never throws. */
export function parseVendorLock(source: string): ParseResult {
  try {
    const decoded: unknown = JSON.parse(source);
    const lock = asRecord(decoded, "lock");
    if (lock.version !== 1) {
      fail("version", "must be 1");
    }
    const rawSkills: unknown = lock.skills;
    if (!Array.isArray(rawSkills)) {
      fail("skills", "must be an array");
    }
    const skills = rawSkills.map((skill: unknown, index: number) =>
      parseSkill(skill, index),
    );
    const seen = new Set<string>();
    for (const [index, skill] of skills.entries()) {
      if (seen.has(skill.name)) {
        fail(`skills[${index}].name`, "duplicate name");
      }
      seen.add(skill.name);
    }
    return { ok: true, value: { version: 1, skills } };
  } catch (cause) {
    return {
      ok: false,
      error:
        cause instanceof Error
          ? cause.message
          : "vendor lock is not valid JSON",
    };
  }
}

export function serializeVendorLock(lock: VendorLock): string {
  const skills = [...lock.skills].sort((a, b) => a.name.localeCompare(b.name));
  return `${JSON.stringify({ version: 1, skills }, null, 2)}\n`;
}

/** Read the lock; a missing file is an empty lock. */
export function readVendorLock(root: string): ParseResult {
  const file = join(root, VENDOR_LOCK_PATH);
  if (!existsSync(file)) {
    return { ok: true, value: { version: 1, skills: [] } };
  }
  return parseVendorLock(readFileSync(file, "utf8"));
}

/** Repo-relative POSIX paths of every file under `directory`, sorted. */
export function listDirectoryFiles(directory: string): string[] {
  const files: string[] = [];
  const walk = (absolute: string, prefix: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(absolute, entry.name), relative);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  };
  if (existsSync(directory)) {
    walk(directory, "");
  }
  return files.sort();
}

/**
 * Deterministic content hash of a directory: sha256 over sorted
 * `<relative path>\0<sha256 of content>\n` records. Line endings are not
 * normalised; vendored copies are byte-for-byte upstream.
 */
export function hashFiles(
  entries: readonly { path: string; content: Uint8Array }[],
): string {
  const outer = createHash("sha256");
  for (const entry of [...entries].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )) {
    const inner = createHash("sha256").update(entry.content).digest("hex");
    outer.update(`${entry.path}\0${inner}\n`);
  }
  return `sha256:${outer.digest("hex")}`;
}

export function hashDirectory(directory: string): string {
  return hashFiles(
    listDirectoryFiles(directory).map((path) => ({
      path,
      content: readFileSync(join(directory, path)),
    })),
  );
}

export interface DriftFinding {
  readonly name: string;
  readonly dir: string;
  readonly message: string;
}

/** Compare each vendored directory against its locked hash. */
export function verifyVendored(root: string, lock: VendorLock): DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const skill of lock.skills) {
    const directory = join(root, skill.dir);
    if (!existsSync(directory)) {
      findings.push({
        name: skill.name,
        dir: skill.dir,
        message: "vendored directory is missing; run pnpm skills:update",
      });
      continue;
    }
    const actual = hashDirectory(directory);
    if (actual !== skill.hash) {
      findings.push({
        name: skill.name,
        dir: skill.dir,
        message:
          "contents differ from vendor.lock.json; vendored files are not edited by hand, run pnpm skills:update",
      });
    }
  }
  return findings;
}

/** True when a repo-relative file lives inside a vendored skill directory. */
export function isVendoredFile(
  file: string,
  lock: VendorLock | undefined,
): boolean {
  return (
    lock?.skills.some((skill) => file.startsWith(`${skill.dir}/`)) ?? false
  );
}
