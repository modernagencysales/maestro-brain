import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectionsScreen } from "./connections-screen";
import { ConnectionsRouteAdapter } from "./connections-route-adapter";

const mocks = vi.hoisted(() => ({
  queryArgs: null as unknown,
  screenProps: undefined as
    ComponentProps<typeof ConnectionsScreen> | undefined,
  reviewRoute: vi.fn().mockResolvedValue({ status: "success" }),
}));

vi.mock("../../providers/workspace", () => ({
  useWorkspace: () => ({
    status: "ready",
    activeWorkspace: {
      workspaceId: "brain_agency",
      organizationId: "org_1",
      kind: "agency",
      name: "Agency",
      slug: "agency",
      role: "admin",
      status: "active",
    },
    workspaces: [
      {
        workspaceId: "brain_agency",
        organizationId: "org_1",
        kind: "agency",
        name: "Agency",
        slug: "agency",
        role: "admin",
        status: "active",
      },
      {
        workspaceId: "brain_acme",
        organizationId: "org_1",
        kind: "client",
        name: "Acme",
        slug: "acme",
        role: "admin",
        status: "active",
      },
    ],
  }),
}));

vi.mock("../../adapters/confect-state", () => ({
  useTemplateMutation: () => mocks.reviewRoute,
  useTemplateQuery: (
    _ref: unknown,
    args: unknown,
    options: {
      readonly isEmpty: (data: { items: readonly unknown[] }) => boolean;
    },
  ) => {
    mocks.queryArgs = args;
    options.isEmpty({ items: [] });
    return {
      status: "ready",
      data: {
        items: [
          {
            proposalKey: "callroute_1",
            unitKey: "sunit_1",
            unitRevisionKey: "surev_1",
            title: "Acme weekly",
            sourceUrl: "https://example.test/call_1",
            outcome: "awaiting_review",
            brainKey: null,
            candidateBrainKeys: ["brain_existing"],
            reason: "Participant evidence needs review.",
            routeGeneration: 4,
            sourceLifecycleGeneration: 1,
            createdAt: 1_782_924_800_000,
          },
        ],
      },
    };
  },
}));

vi.mock("../brain/brain-surface", () => ({
  unwrapBrainMutation: (value: unknown) => value,
}));

vi.mock("./connections-screen", () => ({
  ConnectionsScreen: (props: ComponentProps<typeof ConnectionsScreen>) => {
    mocks.screenProps = props;
    return <div>Connections</div>;
  },
}));

vi.mock("../../saas-ui/business-shell", () => ({
  BusinessAppShell: ({ children }: { readonly children: ReactNode }) =>
    children,
  BusinessPageRoot: ({ children }: { readonly children: ReactNode }) =>
    children,
}));

describe("ConnectionsRouteAdapter", () => {
  beforeEach(() => {
    mocks.queryArgs = null;
    mocks.screenProps = undefined;
    mocks.reviewRoute.mockClear();
  });

  it("projects organization clients and submits the exact routing review", async () => {
    expect(renderToStaticMarkup(<ConnectionsRouteAdapter />)).toContain(
      "Connections",
    );
    expect(mocks.queryArgs).toEqual({ brainKey: "brain_agency" });
    expect(mocks.screenProps?.routingQueue).toMatchObject({
      status: "ready",
      items: [
        {
          candidateBrainKeys: ["brain_existing", "brain_acme"],
        },
      ],
    });

    const queue = mocks.screenProps?.routingQueue;
    if (queue?.status !== "ready") throw new Error("Expected ready queue");
    const item = queue.items[0];
    if (item === undefined) throw new Error("Expected a routing proposal");
    await mocks.screenProps?.onRoutingReview?.({
      item,
      action: "change_brain",
      targetBrainKey: "brain_acme",
      learnScope: "domain",
      learnValue: "acme.test",
    });

    expect(mocks.reviewRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        brainKey: "brain_agency",
        proposalKey: "callroute_1",
        action: "change_brain",
        targetBrainKey: "brain_acme",
        learnScope: "domain",
        learnValue: "acme.test",
        expectedUnitRevisionKey: "surev_1",
        expectedRouteGeneration: 4,
        expectedSourceLifecycleGeneration: 1,
        attemptKey: expect.stringMatching(/^route-review\./),
      }),
    );
  });
});
