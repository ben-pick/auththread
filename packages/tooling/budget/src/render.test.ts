import { describe, expect, it } from "vitest";
import type { Measurement } from "./index.ts";
import { MARKER, renderMarkdown } from "./render.ts";

const measurement = (overrides: Partial<Measurement> = {}): Measurement => ({
  name: "browser SDK",
  shippedBytes: 3_000,
  minifiedBytes: 3_000,
  gzippedBytes: 2_000,
  budgetBytes: 5 * 1024,
  ok: true,
  ...overrides,
});

describe("renderMarkdown", () => {
  it("starts with the comment marker and reports each size and budget", () => {
    const report = renderMarkdown([
      { current: measurement() },
      {
        current: measurement({
          name: "page snippet",
          shippedBytes: 1_000,
          minifiedBytes: 800,
          gzippedBytes: 700,
          budgetBytes: 8 * 1024,
        }),
      },
    ]);

    expect(report.split("\n")[0]).toBe(MARKER);
    expect(report).toContain("| browser SDK | 2,000 B | 3,000 B | 5,120 B |");
    expect(report).toContain("| page snippet | 700 B | 800 B | 8,192 B |");
    expect(report).toContain("**Result:** 2 within budget · 0 over budget.");
  });

  it("marks an over-budget bundle and still renders it", () => {
    const report = renderMarkdown([
      {
        current: measurement({
          gzippedBytes: 6_000,
          ok: false,
        }),
      },
    ]);

    expect(report).toContain("**over**");
    expect(report).toContain("0 within budget · 1 over budget.");
  });

  it("compares gzipped sizes against the base measurement", () => {
    const report = renderMarkdown(
      [
        {
          current: measurement({ gzippedBytes: 2_100 }),
          base: measurement({ gzippedBytes: 2_000 }),
        },
        {
          current: {
            name: "keycloak example app (informational)",
            shippedBytes: 3_400,
            minifiedBytes: 3_400,
            gzippedBytes: 3_400,
            ok: true,
          },
          base: measurement({ gzippedBytes: 3_500 }),
        },
      ],
      "origin/main",
    );

    expect(report).toContain("Compared with `origin/main`.");
    expect(report).toContain("| +100 B (+5.0%) |");
    expect(report).toContain("| -100 B (-2.9%) |");
    expect(report).toContain("| no budget |");
  });

  it("shows no change for a bundle that did not move", () => {
    const report = renderMarkdown(
      [{ current: measurement(), base: measurement() }],
      "origin/main",
    );

    expect(report).toContain("| 2,000 B | 3,000 B | 5,120 B | — | ok |");
  });
});
