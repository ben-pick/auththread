import { describe, expect, it } from "vitest";
import {
  collapse,
  diffGraphs,
  packageOf,
  renderMarkdown,
  renderMermaid,
  tierOf,
} from "./index.ts";
import type { CruiseResult, Graph, PackageInfo } from "./types.ts";

const packages: PackageInfo[] = [
  { path: "packages/core/schema", name: "@auththread/schema", tier: "core" },
  { path: "packages/core/browser", name: "@auththread/browser", tier: "core" },
  {
    path: "packages/core/stitcher",
    name: "@auththread/stitcher",
    tier: "core",
  },
  {
    path: "packages/providers/auth0",
    name: "@auththread/auth0",
    tier: "providers",
  },
  {
    path: "examples/node-docker",
    name: "@auththread/example-node-docker",
    tier: "examples",
  },
];

const cruise: CruiseResult = {
  modules: [
    {
      source: "packages/core/stitcher/src/stitcher.ts",
      dependencies: [
        {
          module: "@auththread/schema",
          resolved: "packages/core/schema/src/index.ts",
        },
        {
          module: "@auththread/auth0",
          resolved: "packages/providers/auth0/src/index.ts",
          rules: [{ name: "core-no-adapters" }],
        },
        {
          module: "./decode.ts",
          resolved: "packages/core/stitcher/src/decode.ts",
        },
      ],
    },
    {
      source: "packages/providers/auth0/src/index.ts",
      dependencies: [{ module: "@auththread/schema", resolved: "unknown" }],
    },
    {
      source: "packages/core/stitcher/src/stitcher.test.ts",
      dependencies: [
        {
          module: "@auththread/browser",
          resolved: "packages/core/browser/src/index.ts",
        },
      ],
    },
  ],
  summary: { violations: [{ rule: "core-no-adapters" }] },
};

const graph = (overrides: Partial<Graph>): Graph => ({
  nodes: [
    { path: "packages/core/schema", name: "@auththread/schema", tier: "core" },
    {
      path: "packages/core/stitcher",
      name: "@auththread/stitcher",
      tier: "core",
    },
  ],
  edges: [
    {
      from: "packages/core/stitcher",
      to: "packages/core/schema",
      violations: [],
    },
  ],
  violationCount: 0,
  ...overrides,
});

describe("package paths", () => {
  it("maps files to workspace packages and tiers", () => {
    expect(packageOf("packages/core/schema/src/index.ts")).toBe(
      "packages/core/schema",
    );
    expect(packageOf("examples/node-docker/src/main.ts")).toBe(
      "examples/node-docker",
    );
    expect(packageOf("scripts/demo.ts")).toBeUndefined();
    expect(tierOf("packages/providers/auth0")).toBe("providers");
    expect(tierOf("examples/node-docker")).toBe("examples");
  });
});

describe("collapse", () => {
  it("keeps workspace edges, falls back to package names and includes tests", () => {
    const result = collapse(cruise, packages);
    expect(result.nodes.map((node) => node.name)).toEqual([
      "@auththread/browser",
      "@auththread/schema",
      "@auththread/stitcher",
      "@auththread/auth0",
      "@auththread/example-node-docker",
    ]);
    expect(result.edges).toEqual([
      {
        from: "packages/core/stitcher",
        to: "packages/core/browser",
        violations: [],
      },
      {
        from: "packages/core/stitcher",
        to: "packages/core/schema",
        violations: [],
      },
      {
        from: "packages/core/stitcher",
        to: "packages/providers/auth0",
        violations: ["core-no-adapters"],
      },
      {
        from: "packages/providers/auth0",
        to: "packages/core/schema",
        violations: [],
      },
    ]);
    expect(result.violationCount).toBe(1);
  });
});

describe("diff", () => {
  it("marks added and removed packages and edges", () => {
    const base = graph({});
    const head = graph({
      nodes: [
        ...base.nodes,
        {
          path: "packages/core/browser",
          name: "@auththread/browser",
          tier: "core",
        },
      ],
      edges: [
        ...base.edges,
        {
          from: "packages/core/browser",
          to: "packages/core/schema",
          violations: [],
        },
      ],
    });

    const diff = diffGraphs(base, head);
    expect(diff.nodes.map((node) => [node.name, node.status])).toEqual([
      ["@auththread/browser", "added"],
      ["@auththread/schema", "same"],
      ["@auththread/stitcher", "same"],
    ]);
    expect(diff.edges.map((edge) => edge.status)).toEqual(["added", "same"]);
  });

  it("shows a removed edge from the base graph", () => {
    const base = graph({});
    const head = graph({ edges: [] });

    const diff = diffGraphs(base, head);
    expect(diff.edges).toEqual([
      {
        from: "packages/core/stitcher",
        to: "packages/core/schema",
        violations: [],
        status: "removed",
      },
    ]);
  });

  it("treats a graph without a base as unchanged", () => {
    const diff = diffGraphs(undefined, graph({}));
    expect(diff.nodes.every((node) => node.status === "same")).toBe(true);
    expect(diff.edges.every((edge) => edge.status === "same")).toBe(true);
  });
});

describe("rendering", () => {
  it("renders tiers, changes and violations in Mermaid", () => {
    const diff = diffGraphs(
      graph({ edges: [] }),
      graph({
        edges: [
          {
            from: "packages/core/stitcher",
            to: "packages/core/schema",
            violations: ["core-no-adapters"],
          },
        ],
      }),
    );

    const mermaid = renderMermaid(diff);
    expect(mermaid).toContain("flowchart LR");
    expect(mermaid).toContain('subgraph sg_core["core"]');
    expect(mermaid).toContain("-->");
    expect(mermaid).toContain("stroke:#d1242f");
    expect(mermaid).toContain("classDef added");
  });

  it("renders a comment with changed packages and edges", () => {
    const diff = diffGraphs(
      graph({}),
      graph({
        nodes: [
          ...graph({}).nodes,
          {
            path: "packages/core/browser",
            name: "@auththread/browser",
            tier: "core",
          },
        ],
      }),
    );

    const markdown = renderMarkdown(diff, "origin/main");
    expect(markdown.startsWith("<!-- auththread-dep-graph -->")).toBe(true);
    expect(markdown).toContain("Compared with `origin/main`.");
    expect(markdown).toContain("**Added packages:** `@auththread/browser`");
    expect(markdown).toContain("```mermaid");
    expect(markdown).not.toContain("**Added edges:** \n");
  });

  it("strips markdown characters from package metadata", () => {
    const diff = diffGraphs(
      undefined,
      graph({
        nodes: [
          {
            path: "packages/core/schema",
            name: "`@auththread/schema`\n![x](https://example.test/x)",
            tier: "core",
          },
        ],
        edges: [],
      }),
    );

    const markdown = renderMarkdown(diff);
    expect(markdown).not.toContain("![x]");
    expect(markdown).not.toContain("https://");
    expect(markdown).toContain("@auththread/schema");
  });
});
