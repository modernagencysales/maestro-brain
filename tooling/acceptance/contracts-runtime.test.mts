import { describe, expect, it } from "vitest";

import { boundedSeedAttemptTimeout } from "../../tests/acceptance/support/runtime";

describe("contracts runtime seed retries", () => {
  it.each([
    [120_000, 120_000, 15_000, 15_000],
    [10_000, 120_000, 15_000, 10_000],
    [120_000, 5_000, 15_000, 5_000],
    [0, 120_000, 15_000, 1],
  ])(
    "bounds one seed attempt without consuming the overall deadline",
    (remaining, command, attempt, expected) => {
      expect(boundedSeedAttemptTimeout(remaining, command, attempt)).toBe(
        expected,
      );
    },
  );
});
