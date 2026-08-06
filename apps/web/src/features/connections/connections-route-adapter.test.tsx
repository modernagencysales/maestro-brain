import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectionsScreen } from "./connections-screen";
import { ConnectionsRouteAdapter } from "./connections-route-adapter";

const mocks = vi.hoisted(() => ({
  queryCall: 0,
  actionCall: 0,
  mutationCall: 0,
  queryArgs: null as unknown,
  screenProps: undefined as
    ComponentProps<typeof ConnectionsScreen> | undefined,
  reviewRoute: vi.fn().mockResolvedValue({ status: "success" }),
  importTranscript: vi.fn().mockResolvedValue({
    outcome: "inserted",
    unitKey: "sunit_1",
    unitRevisionKey: "surev_1",
    segmentCount: 1,
    routeOutcome: "routed",
    brainKey: "brain_acme",
  }),
  beginConnect: vi.fn().mockResolvedValue({
    connectSessionId: "session-gong",
    connectSessionToken: "fixture",
    expiresAt: Date.now() + 60_000,
  }),
  completeConnect: vi.fn().mockResolvedValue({
    connectionKey: "gong_agency_acme",
    status: "verifying",
    connectionGeneration: 0,
  }),
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
  useTemplateMutation: () => {
    mocks.mutationCall += 1;
    return mocks.mutationCall === 1
      ? mocks.reviewRoute
      : mocks.importTranscript;
  },
  useTemplateAction: () => {
    mocks.actionCall += 1;
    return mocks.actionCall === 1 ? mocks.beginConnect : mocks.completeConnect;
  },
  useTemplateQuery: (
    _ref: unknown,
    args: unknown,
    options: {
      readonly isEmpty: (data: { items: readonly unknown[] }) => boolean;
    },
  ) => {
    mocks.queryCall += 1;
    mocks.queryArgs = args;
    if (mocks.queryCall === 1) {
      options.isEmpty([] as never);
      return {
        status: "ready",
        data: [
          {
            provider: "fireflies",
            connectionKey: "fireflies_agency_acme",
            state: "ready",
            lastSuccessAt: 1_782_924_800_000,
            cursorPresent: true,
            callsDiscovered: 12,
            callsIngested: 12,
            callsRouted: 8,
            callsAwaitingRouting: 4,
            backfillComplete: true,
            lastErrorTag: null,
          },
        ],
      };
    }
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

vi.mock("@maestro-template/integrations/nango/connectBrowser", () => ({
  openNangoConnect: ({
    connectSessionToken,
    open,
  }: {
    readonly connectSessionToken: string;
    readonly open: (input: { readonly token: string }) => Promise<unknown>;
  }) => open({ token: connectSessionToken }),
  openNangoConnectWithSdk: vi.fn().mockResolvedValue({
    connectionId: "nango-gong-connection",
  }),
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
    mocks.queryCall = 0;
    mocks.actionCall = 0;
    mocks.mutationCall = 0;
    mocks.queryArgs = null;
    mocks.screenProps = undefined;
    mocks.reviewRoute.mockClear();
    mocks.importTranscript.mockClear();
    mocks.beginConnect.mockClear();
    mocks.completeConnect.mockClear();
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

  it("projects the four-provider catalog and starts provider-specific connect", async () => {
    renderToStaticMarkup(<ConnectionsRouteAdapter />);
    expect(mocks.screenProps?.state).toMatchObject({
      status: "ready",
      connections: expect.arrayContaining([
        expect.objectContaining({
          key: "fireflies",
          status: "ready",
          callsDiscovered: 12,
        }),
        expect.objectContaining({ key: "gong", status: "disconnected" }),
        expect.objectContaining({ key: "fathom", status: "disconnected" }),
        expect.objectContaining({ key: "granola", status: "disconnected" }),
      ]),
    });

    await mocks.screenProps?.onConnect?.("gong");
    expect(mocks.beginConnect).toHaveBeenCalledWith({ provider: "gong" });
    expect(mocks.completeConnect).toHaveBeenCalledWith({
      provider: "gong",
      connectSessionId: "session-gong",
      connectionId: "nango-gong-connection",
    });
  });

  it("imports a file through the active Brain and exposes client targets", async () => {
    renderToStaticMarkup(<ConnectionsRouteAdapter />);
    expect(mocks.screenProps?.transcriptTargets).toEqual([
      { brainKey: "brain_acme", name: "Acme" },
    ]);
    await mocks.screenProps?.onTranscriptImport?.({
      format: "txt",
      content: "A customer quote.",
      title: "Customer call",
      occurredAt: "2026-08-05T14:00:00.000Z",
      participantEmails: ["buyer@example.com"],
      targetBrainKey: "brain_acme",
    });
    expect(mocks.importTranscript).toHaveBeenCalledWith({
      brainKey: "brain_agency",
      format: "txt",
      content: "A customer quote.",
      title: "Customer call",
      occurredAt: "2026-08-05T14:00:00.000Z",
      participantEmails: ["buyer@example.com"],
      targetBrainKey: "brain_acme",
    });
  });
});
