import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  convexQuery: vi.fn(() => ({ id: "user_1", workspaces: [] })),
  query: vi.fn(() => ({ data: undefined })),
  suspenseQuery: vi.fn(() => ({ data: { id: "user_1" } })),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: vi.fn(),
  useQuery: hooks.query,
  useSuspenseQuery: hooks.suspenseQuery,
}));

vi.mock("@convex-dev/react-query", () => ({
  convexQuery: vi.fn(() => ({ queryKey: ["auth.me"] })),
  useConvexQuery: hooks.convexQuery,
}));

import { createCompatibilityApi } from "#lib/trpc/react";

describe("Convex Starter suspense compatibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("wraps the native Convex hook value in the Starter query result", () => {
    const result = createCompatibilityApi().auth.me.useQuery();

    expect(result).toMatchObject({
      data: { id: "user_1", workspaces: [] },
      isLoading: false,
      isPending: false,
    });
    expect(hooks.convexQuery).toHaveBeenCalledOnce();
  });

  it("waits for real Convex query data before rendering Starter consumers", () => {
    const [user] = createCompatibilityApi().auth.me.useSuspenseQuery();

    expect(user).toEqual({ id: "user_1" });
    expect(hooks.suspenseQuery).toHaveBeenCalledOnce();
    expect(hooks.query).not.toHaveBeenCalled();
  });
});
