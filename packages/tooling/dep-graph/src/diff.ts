import { compare } from "./collapse.ts";
import type { Change, DiffEdge, DiffNode, Graph, GraphDiff } from "./types.ts";

const byPath = (a: { path: string }, b: { path: string }): number =>
  compare(a.path, b.path);

const edgeKey = (edge: { from: string; to: string }): string =>
  `${edge.from}\u0000${edge.to}`;

const status = (inBase: boolean, inHead: boolean): Change => {
  if (inBase && inHead) return "same";
  return inHead ? "added" : "removed";
};

export function diffGraphs(base: Graph | undefined, head: Graph): GraphDiff {
  const baseNodes = new Map(
    (base?.nodes ?? []).map((node) => [node.path, node]),
  );
  const headNodes = new Map(head.nodes.map((node) => [node.path, node]));
  const paths = new Set([...baseNodes.keys(), ...headNodes.keys()]);
  const change = (inBase: boolean, inHead: boolean): Change =>
    base === undefined ? "same" : status(inBase, inHead);

  const nodes: DiffNode[] = [...paths]
    .map((path) => {
      const fromBase = baseNodes.get(path);
      const fromHead = headNodes.get(path);
      const node = fromHead ?? fromBase;
      if (node === undefined) throw new Error(`missing node ${path}`);
      return {
        ...node,
        status: change(fromBase !== undefined, fromHead !== undefined),
      };
    })
    .sort(byPath);

  const baseEdges = new Map(
    (base?.edges ?? []).map((edge) => [edgeKey(edge), edge]),
  );
  const headEdges = new Map(head.edges.map((edge) => [edgeKey(edge), edge]));
  const keys = new Set([...baseEdges.keys(), ...headEdges.keys()]);

  const edges: DiffEdge[] = [...keys]
    .map((key) => {
      const fromBase = baseEdges.get(key);
      const fromHead = headEdges.get(key);
      const edge = fromHead ?? fromBase;
      if (edge === undefined) throw new Error(`missing edge ${key}`);
      return {
        ...edge,
        status: change(fromBase !== undefined, fromHead !== undefined),
      };
    })
    .sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to));

  return {
    nodes,
    edges,
    violationCount: head.violationCount,
  };
}

export const changed = (diff: GraphDiff): boolean =>
  diff.nodes.some((node) => node.status !== "same") ||
  diff.edges.some((edge) => edge.status !== "same");
