import { describe, expect, it } from "vitest";

import {
  fixtureAuthRedirect,
  fixtureAuthService,
  fixtureAuthUser,
} from "./fixture-auth";

describe("fixture auth adapter", () => {
  it("authenticates locally without entering the WorkOS adapter", async () => {
    await expect(fixtureAuthService.onLoadUser?.()).resolves.toEqual(
      fixtureAuthUser,
    );
    await expect(fixtureAuthService.onLogin?.({})).resolves.toEqual(
      fixtureAuthUser,
    );
  });

  it("returns to a safe local route without constructing WorkOS", () => {
    expect(
      fixtureAuthRedirect(
        new Request(
          "https://app.example/api/auth/sign-in?returnPathname=%2Fawesome-inc",
        ),
      ).headers.get("Location"),
    ).toBe("/awesome-inc");
    expect(
      fixtureAuthRedirect(
        new Request(
          "https://app.example/api/auth/sign-in?returnPathname=https%3A%2F%2Fevil.example",
        ),
      ).headers.get("Location"),
    ).toBe("/");
  });
});
