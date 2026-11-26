import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256.ts";

describe("sha256Hex", () => {
  it("matches the published vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("The quick brown fox jumps over the lazy dog")).toBe(
      "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
    );
  });

  it("crosses a block boundary and stays stable", () => {
    const input = "a".repeat(1000);
    expect(sha256Hex(input)).toHaveLength(64);
    expect(sha256Hex(input)).toBe(sha256Hex(input));
  });
});
