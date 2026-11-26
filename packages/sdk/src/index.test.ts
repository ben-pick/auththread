import { describe, expect, it } from "vitest";
import { Stitcher, stitcherLayer } from "./index.ts";

describe("sdk facade", () => {
  it("exports the Effect stitcher service and layer", () => {
    expect(Stitcher).toBeDefined();
    expect(typeof stitcherLayer).toBe("function");
  });
});
