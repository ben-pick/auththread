export const TIERS = [
  "core",
  "providers",
  "runtimes",
  "sinks",
  "tooling",
  "examples",
] as const;

export type Tier = (typeof TIERS)[number];

export interface PackageInfo {
  /** Repo-relative package directory, without a trailing slash. */
  readonly path: string;
  readonly name: string;
  readonly tier: Tier;
}

export interface GraphNode {
  readonly path: string;
  readonly name: string;
  readonly tier: Tier;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly violations: string[];
}

export interface Graph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly violationCount: number;
}

export type Change = "added" | "removed" | "same";

export interface DiffNode extends GraphNode {
  readonly status: Change;
}

export interface DiffEdge extends GraphEdge {
  readonly status: Change;
}

export interface GraphDiff {
  readonly nodes: readonly DiffNode[];
  readonly edges: readonly DiffEdge[];
  readonly violationCount: number;
}

export interface CruiseDependency {
  readonly module: string;
  readonly resolved?: string;
  readonly rules?: ReadonlyArray<{ readonly name: string }>;
}

export interface CruiseModule {
  readonly source: string;
  readonly dependencies: readonly CruiseDependency[];
}

/** The subset of dependency-cruiser's JSON output this tool relies on. */
export interface CruiseResult {
  readonly modules: readonly CruiseModule[];
  readonly summary?: {
    readonly violations?: ReadonlyArray<unknown>;
  };
}
