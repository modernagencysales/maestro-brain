import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./route-auth", () => ({
  isFixtureAuthRuntime: () => true,
}));

import { createAuthEntryHandler } from "./workos-auth-entry";

describe("auth entry handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["sign-in", "sign-up"] as const)(
    "keeps fixture %s out of WorkOS",
    async (kind) => {
      const handler = createAuthEntryHandler(kind);
      const response = await handler({
        request: new Request(
          `https://app.example/api/auth/${kind}?returnPathname=%2Fawesome-inc`,
        ),
      });

      expect(response.status).toBe(307);
      expect(response.headers.get("Location")).toBe("/awesome-inc");
    },
  );
});
