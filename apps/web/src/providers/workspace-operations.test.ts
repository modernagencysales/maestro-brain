import { describe, expect, it } from "vitest";

import * as Either from "effect/Either";

import {
  createRuntimeWorkspaceOperations,
  createWorkspaceLiveRefs,
  workspaceOperationRefs,
} from "./workspace-operations";
import type { SafeWorkspaceRuntime } from "./workspace-operations";

describe("runtime workspace operations", () => {
  it("fails closed for signed-out live/production auth instead of granting demo owner tenancy", async () => {
    const operations = createRuntimeWorkspaceOperations({
      authSnapshot: { status: "signedOut" },
      mode: "live",
    });

    await expect(operations.loadWorkspaces()).rejects.toThrow(
      "Live workspace operations require authorized Confect workspace refs.",
    );
  });

  it("uses fake owner tenancy only for explicit fake/local/build-safe mode", async () => {
    const operations = createRuntimeWorkspaceOperations({
      authSnapshot: { status: "signedOut" },
      mode: "fake",
    });

    await expect(operations.loadWorkspaces()).resolves.toEqual([
      expect.objectContaining({
        role: "owner",
        workspaceId: "br_01J0000000000000000000000B",
      }),
    ]);
  });

  it("builds live refs from the child component hook boundary", () => {
    const calls: Array<{ readonly ref: unknown; readonly args: unknown }> = [];
    const mutationRefs: Array<typeof workspaceOperationRefs.ensureProvisioned> =
      [];
    createWorkspaceLiveRefs({
      useQuery: (ref, args) => {
        calls.push({ ref, args });
        return { status: "loading", mode: "read" };
      },
      useMutation: (ref) => {
        mutationRefs.push(ref);
        const mutation = Object.assign(
          async () =>
            Either.right({
              brainKey: "br_01J0000000000000000000000D",
            }),
          {
            withOptimisticUpdate: () => mutation,
          },
        );
        return mutation;
      },
    });

    expect(calls).toEqual([
      {
        ref: workspaceOperationRefs.list,
        args: {},
      },
    ]);
    expect(mutationRefs).toEqual([workspaceOperationRefs.ensureProvisioned]);
  });

  it("maps live generated Confect refs to the stable workspace controller interface", async () => {
    const operations = createRuntimeWorkspaceOperations({
      authSnapshot: {
        status: "authenticated",
        subject: "user_1",
        email: "user@example.com",
        organizationId: "org_1",
        sessionId: "session_1",
      },
      mode: "live",
      liveRefs: {
        listResult: {
          status: "ready",
          mode: "read",
          data: [
            {
              agencyKey: "ag_01J0000000000000000000000A",
              brainKey: "br_01J0000000000000000000000B",
              name: "Client Brain",
              kind: "client",
              clientSlug: "client",
              effectiveRole: "admin",
              status: "active",
              freshness: {
                updatedAt: 1,
                lifecycleGeneration: 0,
                revocationGeneration: 0,
              },
            },
          ],
        },
        ensureProvisioned: (() => {
          const mutation = Object.assign(
            async () =>
              Either.right({
                brainKey: "br_01J0000000000000000000000C",
              }),
            { withOptimisticUpdate: () => mutation },
          );
          return mutation;
        })(),
      } satisfies NonNullable<SafeWorkspaceRuntime["liveRefs"]>,
    });

    await expect(operations.loadWorkspaces()).resolves.toEqual([
      {
        workspaceId: "br_01J0000000000000000000000B",
        organizationId: "ag_01J0000000000000000000000A",
        name: "Client Brain",
        slug: "client",
        role: "admin",
        status: "active",
      },
    ]);
    await expect(operations.ensureProvisioned()).resolves.toEqual({
      workspaceId: "br_01J0000000000000000000000C",
    });
  });
});
