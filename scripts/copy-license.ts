import { copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
copyFileSync(join(repoRoot, "LICENSE"), join(process.cwd(), "LICENSE"));
