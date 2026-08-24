import { describe, expect, it } from "vitest";

import { selectInitialWorkspace } from "./root-index-navigation";

describe("initial workspace selection", () => {
  const workspaces = [{ slug: "first" }, { slug: "remembered" }];

  it("prefers the remembered workspace when it still exists", () => {
    expect(selectInitialWorkspace(workspaces, "remembered")).toEqual({
      slug: "remembered",
    });
  });

  it("falls back to the first available workspace", () => {
    expect(selectInitialWorkspace(workspaces, "missing")).toEqual({
      slug: "first",
    });
    expect(selectInitialWorkspace([], undefined)).toBeUndefined();
  });
});
