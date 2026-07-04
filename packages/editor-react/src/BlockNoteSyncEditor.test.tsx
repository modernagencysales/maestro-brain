import { describe, expect, it } from "vitest";
import { shouldBootstrapCreate } from "./BlockNoteSyncEditor";

describe("BlockNoteSyncEditor decisions", () => {
  it("bootstraps only once after loading settles with no editor", () => {
    expect(
      shouldBootstrapCreate(false, { isLoading: true, editor: null }),
    ).toBe(false);
    expect(
      shouldBootstrapCreate(false, { isLoading: false, editor: null }),
    ).toBe(true);
    expect(
      shouldBootstrapCreate(true, { isLoading: false, editor: null }),
    ).toBe(false);
    expect(shouldBootstrapCreate(false, { isLoading: false, editor: {} })).toBe(
      false,
    );
  });
});
