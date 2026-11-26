import type { DiffEdge, DiffNode, GraphDiff, Tier } from "./types.ts";
import { TIERS } from "./types.ts";

export const MARKER = "<!-- auththread-dep-graph -->";

const tierLabel: Record<Tier, string> = {
  core: "core",
  providers: "providers",
  runtimes: "runtimes",
  sinks: "sinks",
  tooling: "tooling",
  examples: "examples",
};

const escapeLabel = (value: string): string =>
  value
    .replaceAll("&", "#amp;")
    .replaceAll('"', "#quot;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll("\n", " ");

/** Package metadata is PR-controlled: keep only npm-name characters. */
const safeName = (value: string): string =>
  value.replace(/[^A-Za-z0-9@/._-]/g, "");

const code = (value: string): string => `\`${safeName(value)}\``;

const idOf = (path: string): string =>
  `n_${path.replace(/[^A-Za-z0-9_]/g, "_")}`;

const byTier = (nodes: readonly DiffNode[], tier: Tier): DiffNode[] =>
  nodes.filter((node) => node.tier === tier);

const edgeStyle = (edge: DiffEdge): string | undefined => {
  if (edge.violations.length > 0) return "stroke:#d1242f,stroke-width:3px";
  if (edge.status === "added") return "stroke:#1a7f37,stroke-width:2px";
  if (edge.status === "removed") return "stroke:#8b949e,stroke-dasharray:4 3";
  return undefined;
};

export function renderMermaid(diff: GraphDiff): string {
  const lines = ["flowchart LR"];

  for (const tier of TIERS) {
    const nodes = byTier(diff.nodes, tier);
    if (nodes.length === 0) continue;
    lines.push(`  subgraph sg_${tier}["${tierLabel[tier]}"]`);
    for (const node of nodes) {
      const suffix = node.status === "same" ? "" : `:::${node.status}`;
      lines.push(
        `    ${idOf(node.path)}["${escapeLabel(safeName(node.name))}"]${suffix}`,
      );
    }
    lines.push("  end");
  }

  const styles: string[] = [];
  let linkIndex = 0;
  for (const edge of diff.edges) {
    const arrow = edge.status === "removed" ? "-.->" : "-->";
    lines.push(`  ${idOf(edge.from)} ${arrow} ${idOf(edge.to)}`);
    const style = edgeStyle(edge);
    if (style !== undefined) styles.push(`  linkStyle ${linkIndex} ${style}`);
    linkIndex += 1;
  }

  lines.push("  classDef added fill:#dafbe1,stroke:#1a7f37,stroke-width:2px");
  lines.push(
    "  classDef removed fill:#f6f8fa,stroke:#8b949e,stroke-dasharray:4 3,color:#57606a",
  );
  lines.push(...styles);
  return lines.join("\n");
}

const edgeLabel = (edge: DiffEdge): string =>
  `${code(edge.from)} -> ${code(edge.to)}`;

const list = (title: string, entries: readonly string[]): string[] =>
  entries.length === 0 ? [] : [`- **${title}:** ${entries.join(", ")}`];

export function renderMarkdown(diff: GraphDiff, baseRef?: string): string {
  const addedNodes = diff.nodes.filter((node) => node.status === "added");
  const removedNodes = diff.nodes.filter((node) => node.status === "removed");
  const addedEdges = diff.edges.filter((edge) => edge.status === "added");
  const removedEdges = diff.edges.filter((edge) => edge.status === "removed");
  const violations = diff.edges.filter((edge) => edge.violations.length > 0);

  const summary = [
    `${addedNodes.length} added / ${removedNodes.length} removed packages`,
    `${addedEdges.length} added / ${removedEdges.length} removed edges`,
    `${diff.violationCount} boundary violations`,
  ].join(" · ");

  const lines = [
    MARKER,
    "## Dependency graph",
    "",
    baseRef === undefined
      ? "Current workspace graph. Pass `--base <ref>` for a diff."
      : `Compared with \`${baseRef}\`.`,
    "",
    summary,
    "",
  ];

  lines.push(
    ...list(
      "Added packages",
      addedNodes.map((node) => code(node.name)),
    ),
    ...list(
      "Removed packages",
      removedNodes.map((node) => code(node.name)),
    ),
    ...list(
      "Added edges",
      addedEdges.map((edge) => edgeLabel(edge)),
    ),
    ...list(
      "Removed edges",
      removedEdges.map((edge) => edgeLabel(edge)),
    ),
  );

  if (violations.length > 0) {
    lines.push("", "### Boundary violations", "");
    for (const edge of violations) {
      lines.push(
        `- ${edgeLabel(edge)}: ${edge.violations.map((rule) => code(rule)).join(", ")}`,
      );
    }
  }

  lines.push(
    "",
    "<details><summary>Graph</summary>",
    "",
    "```mermaid",
    renderMermaid(diff),
    "```",
    "",
    "</details>",
    "",
    "Informational: `pnpm boundaries` is what fails the build.",
  );

  return lines.join("\n");
}
