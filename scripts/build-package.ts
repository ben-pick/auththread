import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const repoRoot = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");

execFileSync("tsc", ["-p", "tsconfig.build.json"], { stdio: "inherit" });
copyFileSync(join(repoRoot, "LICENSE"), join(root, "LICENSE"));

const rewrite = (directory: string): void => {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      rewrite(path);
      continue;
    }
    if (!entry.endsWith(".d.ts")) continue;
    const before = readFileSync(path, "utf8");
    const after = before.replace(/(["'][^"']+)\.ts(["'])/g, "$1.js$2");
    if (after !== before) writeFileSync(path, after);
  }
};

rewrite(dist);
