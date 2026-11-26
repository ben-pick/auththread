import { join } from "node:path";
import { parseArgs } from "node:util";
import { graphFor, repoRoot, withWorktree } from "./cruise.ts";
import { diffGraphs } from "./diff.ts";
import { renderMarkdown, renderMermaid } from "./render.ts";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    format: { type: "string", default: "mermaid" },
  },
});

const format = values.format;
if (format !== "mermaid" && format !== "markdown") {
  console.error("graph: --format must be mermaid or markdown");
  process.exit(2);
}

const root = repoRoot(process.cwd());
const configPath = join(root, ".dependency-cruiser.cjs");
const head = graphFor(root, configPath);
const base =
  values.base === undefined
    ? undefined
    : withWorktree(root, values.base, (dir) => graphFor(dir, configPath));

const diff = diffGraphs(base, head);
console.log(
  format === "markdown"
    ? renderMarkdown(diff, values.base)
    : renderMermaid(diff),
);
