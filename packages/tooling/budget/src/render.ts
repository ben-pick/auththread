import type { Measurement } from "./index.ts";

export const MARKER = "<!-- auththread-bundle -->";

export interface Comparison {
  readonly current: Measurement;
  readonly base?: Measurement;
}

const number = new Intl.NumberFormat("en-US");

const bytes = (value: number): string => `${number.format(value)} B`;

/** Comment bodies and table cells are one line; names are code constants but keep it safe. */
const label = (value: string): string =>
  value.replaceAll("`", "'").replaceAll("|", "\\|").replaceAll("\n", " ");

const change = (current: Measurement, base?: Measurement): string => {
  if (base === undefined) return "—";
  const delta = current.gzippedBytes - base.gzippedBytes;
  if (delta === 0) return "—";
  const sign = delta > 0 ? "+" : "-";
  const percent =
    base.gzippedBytes === 0
      ? ""
      : ` (${sign}${((Math.abs(delta) / base.gzippedBytes) * 100).toFixed(1)}%)`;
  return `${sign}${bytes(Math.abs(delta))}${percent}`;
};

export function renderMarkdown(
  rows: readonly Comparison[],
  baseRef?: string,
): string {
  const enforced = rows.filter((row) => row.current.budgetBytes !== undefined);
  const over = enforced.filter((row) => !row.current.ok).length;
  const base =
    rows.some((row) => row.base !== undefined) || baseRef !== undefined;

  const lines = [
    MARKER,
    "## Bundle size",
    "",
    baseRef === undefined
      ? "Gzipped bytes are what the budgets enforce."
      : `Compared with \`${label(baseRef)}\`. Gzipped bytes are what the budgets enforce.`,
    "",
    "| Bundle | Gzipped | Minified | Budget | Change | Result |",
    "| --- | ---: | ---: | ---: | ---: | :--- |",
  ];

  for (const row of rows) {
    const { current } = row;
    const cells = [
      label(current.name),
      bytes(current.gzippedBytes),
      bytes(current.minifiedBytes),
      current.budgetBytes === undefined
        ? "no budget"
        : bytes(current.budgetBytes),
      base ? change(current, row.base) : "—",
      current.ok ? "ok" : "**over**",
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push(
    "",
    `**Result:** ${enforced.length - over} within budget · ${over} over budget.`,
    "",
    "The budget gate is `pnpm check`; this report is informational.",
  );

  return lines.join("\n");
}
