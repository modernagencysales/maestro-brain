import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  WorkspaceProvider,
  createWorkspaceController,
  useWorkspace,
  type WorkspaceSummary,
} from "./workspace";

const workspace = (
  overrides: Partial<WorkspaceSummary> = {},
): WorkspaceSummary => ({
  workspaceId: "workspaces_1",
  organizationId: "organizations_1",
  name: "Acme Workspace",
  slug: "acme",
  role: "owner",
  status: "active",
  ...overrides,
});

const Probe = () => {
  const state = useWorkspace();

  return (
    <p>
      {state.status}:{state.activeWorkspace?.workspaceId ?? "none"}
    </p>
  );
};

describe("workspace provider controller", () => {
  it("starts in loading state and renders through the React provider", () => {
    const controller = createWorkspaceController({
      loadWorkspaces: async () => [workspace()],
      ensureProvisioned: async () => ({ workspaceId: "workspaces_1" }),
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: "loading",
      activeWorkspaceId: null,
    });
    expect(
      renderToStaticMarkup(
        <WorkspaceProvider controller={controller}>
          <Probe />
        </WorkspaceProvider>,
      ),
    ).toContain("loading:none");
  });

  it("provisions an empty account, reloads workspaces, and selects the provisioned workspace", async () => {
    const calls: string[] = [];
    const controller = createWorkspaceController({
      loadWorkspaces: async () => {
        calls.push("load");
        return calls.length === 1 ? [] : [workspace()];
      },
      ensureProvisioned: async () => {
        calls.push("ensure");
        return { workspaceId: "workspaces_1" };
      },
    });

    const seen = await collectStatuses(controller, () =>
      controller.initialize(),
    );

    expect(calls).toEqual(["load", "ensure", "load"]);
    expect(seen).toContain("provisioning");
    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      activeWorkspaceId: "workspaces_1",
      activeWorkspace: { workspaceId: "workspaces_1" },
    });
  });

  it("uses a persisted active workspace when it is still available", async () => {
    const storage = memoryStorage("workspaces_2");
    const controller = createWorkspaceController({
      loadWorkspaces: async () => [
        workspace({ workspaceId: "workspaces_1", name: "One" }),
        workspace({ workspaceId: "workspaces_2", name: "Two" }),
      ],
      ensureProvisioned: async () => ({ workspaceId: "workspaces_1" }),
      storage,
    });

    await controller.initialize();

    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      activeWorkspaceId: "workspaces_2",
      activeWorkspace: { name: "Two" },
    });
  });

  it("switches workspaces and persists the selection", async () => {
    const storage = memoryStorage();
    const controller = createWorkspaceController({
      loadWorkspaces: async () => [
        workspace({ workspaceId: "workspaces_1", name: "One" }),
        workspace({ workspaceId: "workspaces_2", name: "Two" }),
      ],
      ensureProvisioned: async () => ({ workspaceId: "workspaces_1" }),
      storage,
    });

    await controller.initialize();
    controller.switchWorkspace("workspaces_2");

    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      activeWorkspaceId: "workspaces_2",
    });
    expect(storage.read()).toBe("workspaces_2");
  });

  it("remembers a newly created workspace until it appears in the list", async () => {
    const storage = memoryStorage();
    let includeNewWorkspace = false;
    const controller = createWorkspaceController({
      loadWorkspaces: async () => [
        workspace({ workspaceId: "workspaces_1", name: "One" }),
        ...(includeNewWorkspace
          ? [workspace({ workspaceId: "workspaces_2", name: "Two" })]
          : []),
      ],
      ensureProvisioned: async () => ({ workspaceId: "workspaces_1" }),
      storage,
    });

    await controller.initialize();
    controller.switchWorkspace("workspaces_2");
    includeNewWorkspace = true;
    await controller.initialize();

    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      activeWorkspaceId: "workspaces_2",
    });
  });

  it("surfaces provisioning failures without requiring live secrets", async () => {
    const controller = createWorkspaceController({
      loadWorkspaces: async () => [],
      ensureProvisioned: async () => {
        throw new Error("fake provisioning failed");
      },
    });

    await controller.initialize();

    expect(controller.getSnapshot()).toMatchObject({
      status: "failure",
      phase: "provisioning",
      message: "fake provisioning failed",
    });
  });
});

const collectStatuses = async (
  controller: ReturnType<typeof createWorkspaceController>,
  work: () => Promise<void>,
) => {
  const statuses: string[] = [];
  const unsubscribe = controller.subscribe(() => {
    statuses.push(controller.getSnapshot().status);
  });

  await work();
  unsubscribe();

  return statuses;
};

const memoryStorage = (initial: string | null = null) => {
  let value = initial;

  return {
    read: () => value,
    write: (next: string) => {
      value = next;
    },
  };
};
