import { describe, expect, it } from "vitest";
import {
  base64UrlDecode,
  base64UrlEncode,
  constantTimeEqual,
  hmacSha256Base64Url,
  sha256Base64Url,
  stableFingerprint,
} from "../confect/shared/tokenCrypto";

describe("shared token crypto helpers", () => {
  it("round-trips base64url without padding", () => {
    const input = new TextEncoder().encode("hello+/=world");
    const encoded = base64UrlEncode(input);

    expect(encoded).toBe("aGVsbG8rLz13b3JsZA");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    expect(base64UrlDecode(encoded)).toEqual(input);
  });

  it("hashes SHA-256 to stable base64url", async () => {
    await expect(sha256Base64Url("hello")).resolves.toBe(
      "LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ",
    );
  });

  it("signs HMAC SHA-256 to stable base64url", async () => {
    await expect(hmacSha256Base64Url("secret", "payload")).resolves.toBe(
      "uC_LeRrOxXhZuYm0MKgmSIzi5Hn9-SMmvQoug3WkK6Q",
    );
  });

  it("compares signatures without accepting length mismatches", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });

  it("builds stable fingerprints from sorted object keys", async () => {
    const first = await stableFingerprint({
      b: "two",
      a: "one",
      nested: { z: 2, y: 1 },
    });
    const second = await stableFingerprint({
      nested: { y: 1, z: 2 },
      a: "one",
      b: "two",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
