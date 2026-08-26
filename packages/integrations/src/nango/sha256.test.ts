import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256";

describe("isolate-safe SHA-256", () => {
  it("matches the NIST abc vector", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
