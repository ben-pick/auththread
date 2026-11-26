import { describe, expect, it } from "vitest";
import { BUDGETS, measureAll, withinBudget } from "./index.ts";

describe("withinBudget", () => {
  it("treats the budget as inclusive", () => {
    expect(withinBudget(5120, 5120)).toBe(true);
    expect(withinBudget(5121, 5120)).toBe(false);
  });
});

describe("measureAll", () => {
  it("keeps the browser SDK and page snippet inside their budgets", async () => {
    const results = await measureAll();
    const enforced = results.filter(
      (result) => result.budgetBytes !== undefined,
    );

    expect(enforced.map((result) => result.name)).toEqual([
      "browser SDK",
      "page snippet",
    ]);
    expect(enforced.every((result) => result.ok)).toBe(true);
    expect(
      enforced.find((result) => result.name === "browser SDK")?.budgetBytes,
    ).toBe(BUDGETS.browserSdk);
  });
});
