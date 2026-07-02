import { describe, expect, it } from "vitest";
import {
  createDeterministicClock,
  createDeterministicNonce,
  createSystemClock,
  createWebCryptoNonce,
} from "../confect/shared/determinism";

describe("shared clock and nonce seams", () => {
  it("supports injected clocks for deterministic tests", () => {
    const clock = createDeterministicClock("2026-07-01T00:00:00.000Z");

    expect(clock.now()).toEqual(new Date("2026-07-01T00:00:00.000Z"));
    expect(clock.nowIso()).toBe("2026-07-01T00:00:00.000Z");
    expect(clock.nowMs()).toBe(1782864000000);
  });

  it("exposes a system clock seam", () => {
    const clock = createSystemClock(() => 1782864000000);

    expect(clock.nowIso()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("supports injected nonce sequences", () => {
    const nonce = createDeterministicNonce(["first", "second"]);

    expect(nonce.next()).toBe("first");
    expect(nonce.next()).toBe("second");
    expect(() => nonce.next()).toThrow(/No deterministic nonce values remain/);
  });

  it("creates Web Crypto nonce values with base64url shape", () => {
    const nonce = createWebCryptoNonce({
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint8Array) {
          array.fill(7);
        }

        return array;
      },
    });

    expect(nonce.next()).toBe("BwcHBwcHBwcHBwcHBwcH");
  });
});
