import { parseArgs } from "node:util";
import { measureAll, REPO_ROOT } from "./index.ts";
import { renderMarkdown } from "./render.ts";
import { withWorktree } from "./worktree.ts";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    format: { type: "string", default: "text" },
  },
});

const format = values.format;
if (format !== "text" && format !== "markdown") {
  console.error("budget: --format must be text or markdown");
  process.exit(2);
}

const current = await measureAll();
const base =
  values.base === undefined
    ? undefined
    : await withWorktree(REPO_ROOT, values.base, (dir) => measureAll(dir));

if (format === "markdown") {
  const rows = current.map((measurement) => {
    const match = base?.find((entry) => entry.name === measurement.name);
    return match === undefined
      ? { current: measurement }
      : { current: measurement, base: match };
  });
  console.log(renderMarkdown(rows, values.base));
} else {
  let failed = false;

  for (const result of current) {
    const budget =
      result.budgetBytes === undefined
        ? "no budget"
        : `${result.gzippedBytes} / ${result.budgetBytes} B gzipped`;
    const status = result.ok ? "ok" : "OVER";
    console.log(
      `${result.name}: raw ${result.shippedBytes} B, minified ${result.minifiedBytes} B, gzipped ${result.gzippedBytes} B (${budget}) ${status}`,
    );
    if (!result.ok) failed = true;
  }

  if (failed) {
    console.error("bundle budget exceeded");
    process.exit(1);
  }
}

// A markdown report still prints every row and its over/ok state. It does not
// fail: the gate is `pnpm check`, and the PR comment has to post when over.
