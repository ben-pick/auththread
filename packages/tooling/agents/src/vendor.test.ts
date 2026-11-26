import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hashDirectory,
  hashFiles,
  isVendoredFile,
  parseVendorLock,
  readVendorLock,
  serializeVendorLock,
  VENDOR_LOCK_PATH,
  verifyVendored,
} from "./vendor.ts";
import { updateVendored } from "./vendor-update.ts";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const ENTRY = {
  name: "demo",
  dir: ".agents/skills/demo",
  repo: "acme/skills",
  path: "skills/demo",
  commit: "b".repeat(40),
  license: "MIT",
  licenseFile: "LICENSE",
  vendoredAt: "2026-11-02",
  hash: `sha256:${"0".repeat(64)}`,
};

function lockSource(entry: Record<string, unknown> = ENTRY): string {
  return JSON.stringify({ version: 1, skills: [entry] });
}

function expectLock(root: string) {
  const parsed = readVendorLock(root);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
}

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "agents-vendor-"));
  temporaryRoots.push(root);
  return root;
}

function write(root: string, relative: string, content: string): void {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe("parseVendorLock", () => {
  it("accepts a valid lock and round-trips through serialize", () => {
    const parsed = parseVendorLock(lockSource());
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(parsed.value.skills[0]?.name).toBe("demo");
    expect(parseVendorLock(serializeVendorLock(parsed.value))).toEqual(parsed);
  });

  it.each([
    ["invalid JSON", "{"],
    ["wrong version", JSON.stringify({ version: 2, skills: [] })],
    ["short commit", lockSource({ ...ENTRY, commit: "abc" })],
    [
      "dir not matching name",
      lockSource({ ...ENTRY, dir: ".agents/skills/x" }),
    ],
    ["path traversal", lockSource({ ...ENTRY, path: "../etc" })],
    ["bad hash", lockSource({ ...ENTRY, hash: "md5:1" })],
    ["bad date", lockSource({ ...ENTRY, vendoredAt: "yesterday" })],
    ["missing license", lockSource({ ...ENTRY, license: "" })],
    ["duplicate name", JSON.stringify({ version: 1, skills: [ENTRY, ENTRY] })],
  ])("rejects %s", (_label, source) => {
    expect(parseVendorLock(source).ok).toBe(false);
  });

  it("treats a missing lock file as empty", () => {
    const root = tempDir();
    expect(readVendorLock(root)).toEqual({
      ok: true,
      value: { version: 1, skills: [] },
    });
  });
});

describe("hashing", () => {
  const encoder = new TextEncoder();

  it("is independent of entry order", () => {
    const a = { path: "a", content: encoder.encode("1") };
    const b = { path: "b", content: encoder.encode("2") };
    expect(hashFiles([a, b])).toBe(hashFiles([b, a]));
  });

  it("changes with content and with path", () => {
    const base = hashFiles([{ path: "a", content: encoder.encode("1") }]);
    expect(hashFiles([{ path: "a", content: encoder.encode("2") }])).not.toBe(
      base,
    );
    expect(hashFiles([{ path: "b", content: encoder.encode("1") }])).not.toBe(
      base,
    );
  });

  it("hashes a directory the same as the equivalent file list", () => {
    const root = tempDir();
    write(root, "d/SKILL.md", "x");
    write(root, "d/references/a.md", "y");
    expect(hashDirectory(join(root, "d"))).toBe(
      hashFiles([
        { path: "SKILL.md", content: encoder.encode("x") },
        { path: "references/a.md", content: encoder.encode("y") },
      ]),
    );
  });
});

describe("verifyVendored", () => {
  it("reports a changed file and a missing directory", () => {
    const root = tempDir();
    write(root, ".agents/skills/demo/SKILL.md", "x");
    const hash = hashDirectory(join(root, ".agents/skills/demo"));
    const lock = { version: 1 as const, skills: [{ ...ENTRY, hash }] };
    expect(verifyVendored(root, lock)).toEqual([]);

    write(root, ".agents/skills/demo/SKILL.md", "changed");
    expect(verifyVendored(root, lock)).toHaveLength(1);

    rmSync(join(root, ".agents/skills/demo"), { recursive: true });
    expect(verifyVendored(root, lock)[0]?.message).toContain("missing");
  });

  it("identifies vendored files by directory prefix", () => {
    const lock = { version: 1 as const, skills: [ENTRY] };
    expect(isVendoredFile(".agents/skills/demo/SKILL.md", lock)).toBe(true);
    expect(isVendoredFile(".agents/skills/demo-two/SKILL.md", lock)).toBe(
      false,
    );
    expect(isVendoredFile("AGENTS.md", undefined)).toBe(false);
  });
});

describe("updateVendored", () => {
  it("dry run writes nothing", () => {
    const upstream = makeUpstream();
    const root = tempDir();
    write(
      root,
      VENDOR_LOCK_PATH,
      lockSource({ ...ENTRY, commit: upstream.commit }),
    );
    const before = readFileSync(join(root, VENDOR_LOCK_PATH), "utf8");

    const result = updateVendored({
      root,
      remoteUrl: () => upstream.dir,
      dryRun: true,
    });

    expect(result.changes[0]?.added).toContain("SKILL.md");
    expect(readFileSync(join(root, VENDOR_LOCK_PATH), "utf8")).toBe(before);
    expect(existsSync(join(root, ".agents/skills/demo"))).toBe(false);
  });

  it("copies the skill and the upstream LICENSE, then verifies", () => {
    const upstream = makeUpstream();
    const root = tempDir();
    write(
      root,
      VENDOR_LOCK_PATH,
      lockSource({ ...ENTRY, commit: upstream.commit }),
    );

    updateVendored({ root, remoteUrl: () => upstream.dir });

    expect(
      readFileSync(join(root, ".agents/skills/demo/LICENSE"), "utf8"),
    ).toBe("MIT license\n");
    expect(
      readFileSync(join(root, ".agents/skills/demo/SKILL.md"), "utf8"),
    ).toContain("demo");
    expect(verifyVendored(root, expectLock(root))).toEqual([]);
  });
});

function makeUpstream(): { dir: string; commit: string } {
  const dir = tempDir();
  const git = (...args: string[]): string =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.com",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "init.defaultBranch=main",
        ...args,
      ],
      { cwd: dir, encoding: "utf8" },
    ).trim();
  git("init", "--quiet");
  write(dir, "LICENSE", "MIT license\n");
  write(
    dir,
    "skills/demo/SKILL.md",
    "---\nname: demo\ndescription: d\n---\nv1\n",
  );
  write(dir, "skills/demo/references/a.md", "a\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "one");
  return { dir, commit: git("rev-parse", "HEAD") };
}
