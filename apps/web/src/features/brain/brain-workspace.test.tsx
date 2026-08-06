import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import {
  BrainWorkspace,
  BrainWorkspaceRoute,
  createBrainWorkspaceActions,
  recoverWorkspaceSession,
  type BrainPageDetailState,
  type BrainPageListState,
} from "./brain-workspace";
import type { BrainWorkspaceAdapter } from "./brain-surface";

const routeMocks = vi.hoisted(() => ({
  workspace: null as unknown,
  signOut: vi.fn(),
}));

vi.mock("../../providers/workspace", () => ({
  useWorkspace: () => routeMocks.workspace,
}));

vi.mock("../../adapters/confect-state", () => ({
  useTemplateMutation: () => vi.fn(),
  useTemplateQuery: () => ({ status: "loading", mode: "read" }),
}));

vi.mock("@workos/authkit-tanstack-react-start/client", () => ({
  AuthKitProvider: ({ children }: { readonly children: ReactNode }) => children,
  useAccessToken: () => ({ getAccessToken: vi.fn() }),
  useAuth: () => ({ signOut: routeMocks.signOut }),
}));

vi.mock("../../saas-ui/business-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../saas-ui/business-shell")>()),
  BusinessAppShell: ({ children }: { readonly children: ReactNode }) => (
    <>{children}</>
  ),
}));

const page = {
  pageKey: "pag_01J0000000000000000000000A",
  parentPageKey: null,
  siblingSlug: "positioning",
  sortKey: "0001",
  title: "Positioning notes",
  favorite: false,
  status: "active" as const,
  currentRevisionKey: "rev_01J0000000000000000000000A",
  lifecycleGeneration: 1,
};

const pageDetail = {
  page,
  markdown: "Our strongest proof is customer-led growth.",
  updatedAt: 1_754_000_000_000,
};

const childPage = {
  ...page,
  pageKey: "pag_01J0000000000000000000000B",
  parentPageKey: page.pageKey,
  siblingSlug: "proof",
  sortKey: "0002",
  title: "Proof points",
  currentRevisionKey: "rev_01J0000000000000000000000B",
};

const adapter = (): BrainWorkspaceAdapter => ({
  brainKey: "br_01J0000000000000000000000A",
  canEdit: true,
  createPage: vi.fn().mockResolvedValue(page),
  renamePage: vi.fn().mockResolvedValue(page),
  archivePage: vi.fn().mockResolvedValue(page),
  favoritePage: vi.fn().mockResolvedValue(page),
  updatePage: vi.fn().mockResolvedValue({
    pageKey: page.pageKey,
    pageRevisionKey: page.currentRevisionKey,
    contentHash: "hash",
    savedAt: pageDetail.updatedAt,
  }),
});

const listState = (state: BrainPageListState["status"]): BrainPageListState =>
  state === "ready"
    ? {
        status: "ready",
        data: {
          brainKey: "br_01J0000000000000000000000A",
          asOf: 1,
          freshness: { status: "current" },
          pages: [page],
        },
      }
    : state === "empty"
      ? {
          status: "empty",
          data: {
            brainKey: "br_01J0000000000000000000000A",
            asOf: 1,
            freshness: { status: "current" },
            pages: [],
          },
        }
      : { status: "loading" };

const detailState = (
  status: BrainPageDetailState["status"],
): BrainPageDetailState => {
  if (status === "ready") return { status: "ready", data: pageDetail };
  if (status === "failure") return { status, message: "failed" };
  return { status };
};

const render = (
  props: Partial<React.ComponentProps<typeof BrainWorkspace>> = {},
) =>
  renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <BrainWorkspace
        adapter={adapter()}
        detail={detailState("ready")}
        list={listState("ready")}
        {...props}
      />
    </MaestroSaasUiProvider>,
  );

const renderRoute = () =>
  renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <BrainWorkspaceRoute />
    </MaestroSaasUiProvider>,
  );

describe("BrainWorkspace", () => {
  it("keeps one page editor and exposes workspace session recovery", () => {
    const source = readFileSync(
      new URL("./brain-workspace.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("BlockNoteSyncEditor");
    expect(source).not.toContain("editorApi");
  });

  it("renders actionable non-ready workspace states", () => {
    routeMocks.workspace = {
      status: "loading",
      workspaces: [],
      activeWorkspaceId: null,
      activeWorkspace: null,
    };
    expect(renderRoute()).toContain("Loading your workspace.");
    expect(renderRoute()).toContain('role="status"');

    routeMocks.workspace = {
      status: "provisioning",
      workspaces: [],
      activeWorkspaceId: null,
      activeWorkspace: null,
    };
    expect(renderRoute()).toContain("Setting up your Agency Brain workspace.");

    routeMocks.workspace = {
      status: "failure",
      phase: "loading",
      message: "Token refresh failed.",
      workspaces: [],
      activeWorkspaceId: null,
      activeWorkspace: null,
    };
    const failure = renderRoute();
    expect(failure).toContain('role="alert"');
    expect(failure).toContain("Token refresh failed.");
    expect(failure).toContain("Sign in again");

    routeMocks.workspace = {
      status: "empty",
      workspaces: [],
      activeWorkspaceId: null,
      activeWorkspace: null,
    };
    expect(renderRoute()).toContain("Workspace setup did not finish.");
  });

  it("signs out to restart the Brain session", () => {
    recoverWorkspaceSession(routeMocks.signOut);

    expect(routeMocks.signOut).toHaveBeenCalledWith({ returnTo: "/brain" });
  });

  it("drives submit, review, page save, and cited search interactions", async () => {
    const calls: string[] = [];
    const flowAdapter = {
      ...adapter(),
      submitNote: vi.fn().mockImplementation(async () => {
        calls.push("submit");
        return { sourceKey: "src_note", status: "pending_review" as const };
      }),
      reviewNote: vi.fn().mockImplementation(async ({ decision }) => {
        calls.push(decision);
        return { sourceKey: "src_note", status: "published" as const };
      }),
      updatePage: vi.fn().mockImplementation(async () => {
        calls.push("save");
        return page;
      }),
      search: vi.fn().mockImplementation(async () => {
        calls.push("search");
        return [
          {
            citationKey: "cite_src_note_1",
            title: "Positioning notes",
            excerpt: "customer-led growth",
          },
        ];
      }),
    };
    const actions = createBrainWorkspaceActions(flowAdapter);

    await expect(
      actions.submitNote({ title: "Positioning notes", markdown: "proof" }),
    ).resolves.toMatchObject({ status: "pending_review" });
    await expect(
      actions.reviewNote({ sourceKey: "src_note", decision: "approve" }),
    ).resolves.toMatchObject({ status: "published" });
    await expect(
      actions.savePage({
        pageKey: page.pageKey,
        expectedCurrentRevisionKey: page.currentRevisionKey,
        markdown: "edited proof",
      }),
    ).resolves.toMatchObject({ status: "saved" });
    await expect(actions.search("proof")).resolves.toEqual([
      expect.objectContaining({ citationKey: "cite_src_note_1" }),
    ]);
    expect(flowAdapter.updatePage).toHaveBeenCalledWith({
      pageKey: page.pageKey,
      expectedCurrentRevisionKey: page.currentRevisionKey,
      markdown: "edited proof",
    });
    expect(flowAdapter.createPage).not.toHaveBeenCalled();
    expect(calls).toEqual(["submit", "approve", "save", "search"]);
  });

  it("returns explicit failure states for unavailable or rejected interactions", async () => {
    const actions = createBrainWorkspaceActions({
      ...adapter(),
      submitNote: vi.fn().mockRejectedValue(new Error("offline")),
      updatePage: vi.fn().mockRejectedValue(new Error("conflict")),
    });

    await expect(
      actions.submitNote({ title: "Note", markdown: "body" }),
    ).resolves.toMatchObject({ status: "failure", message: "offline" });
    await expect(
      actions.reviewNote({ sourceKey: "src_note", decision: "reject" }),
    ).resolves.toMatchObject({ status: "unavailable" });
    await expect(
      actions.savePage({
        pageKey: page.pageKey,
        expectedCurrentRevisionKey: page.currentRevisionKey,
        markdown: "body",
      }),
    ).resolves.toMatchObject({ status: "failure", message: "conflict" });
    await expect(actions.search("body")).rejects.toThrow(
      "Search is unavailable",
    );
  });

  it("renders loading and empty page states", () => {
    expect(render({ list: listState("loading") })).toContain(
      "Loading Brain pages",
    );
    expect(
      render({ list: listState("empty"), detail: { status: "skipped" } }),
    ).toContain("No Brain pages yet");
  });

  it("renders an accessible ready page in read mode", () => {
    const html = render();

    expect(html).toContain("Positioning notes");
    expect(html).toContain("Our strongest proof is customer-led growth.");
    expect(html).toContain("Edit page");
    expect(html).toContain('aria-label="Search Brain"');
  });

  it("renders the page editor with a save action", () => {
    const html = render({ mode: "edit" });

    expect(html).toContain("Save page");
    expect(html).toContain("Edit Positioning notes");
    expect(html).toContain("textarea");
    expect(html.match(/aria-label="Page markdown"/g)).toHaveLength(1);
    expect(html).not.toContain("Live BlockNote document");
    expect(html).toContain("Rename page");
    expect(html).toContain("Create page");
    expect(html).toContain("Archive page");
    expect(html).toContain("Add favorite");
  });

  it("renders a parent-grouped selectable page tree", () => {
    const html = render({
      list: {
        status: "ready",
        data: {
          brainKey: "br_01J0000000000000000000000A",
          asOf: 1,
          freshness: { status: "current" },
          pages: [page, childPage],
        },
      },
      selectedPageKey: childPage.pageKey,
    });

    expect(html).toContain('aria-label="Brain pages"');
    expect(html).toContain('aria-current="page"');
    expect(html.indexOf(page.title)).toBeLessThan(
      html.indexOf(childPage.title),
    );
  });

  it("hides page mutation controls from viewers", () => {
    const html = render({
      adapter: { ...adapter(), canEdit: false },
      mode: "edit",
    });

    expect(html).not.toContain("Create page");
    expect(html).not.toContain("Rename page");
    expect(html).not.toContain("Archive page");
    expect(html).not.toContain("Add favorite");
    expect(html).not.toContain("Move Positioning notes");
  });

  it("invokes the page move adapter", async () => {
    const movePage = vi.fn().mockResolvedValue(page);
    const actions = createBrainWorkspaceActions({ ...adapter(), movePage });

    await expect(
      actions.movePage({
        pageKey: page.pageKey,
        expectedCurrentRevisionKey: page.currentRevisionKey,
        parentPageKey: childPage.pageKey,
        sortKey: page.sortKey,
      }),
    ).resolves.toMatchObject({ status: "moved" });
    expect(movePage).toHaveBeenCalledOnce();
  });

  it("renders editor move controls in the nested page tree", () => {
    const html = render({
      list: {
        status: "ready",
        data: {
          brainKey: "br_01J0000000000000000000000A",
          asOf: 1,
          freshness: { status: "current" },
          pages: [page, childPage],
        },
      },
    });

    expect(html).toContain("Move Positioning notes");
    expect(html).toContain("Top level");
  });

  it("returns typed stale and lifecycle conflicts", async () => {
    const stale = createBrainWorkspaceActions({
      ...adapter(),
      updatePage: vi.fn().mockRejectedValue({ _tag: "StaleRevision" }),
    });
    const revoked = createBrainWorkspaceActions({
      ...adapter(),
      updatePage: vi.fn().mockRejectedValue({ _tag: "LifecycleRevoked" }),
    });
    const input = {
      pageKey: page.pageKey,
      expectedCurrentRevisionKey: page.currentRevisionKey,
      markdown: "body",
    };

    await expect(stale.savePage(input)).resolves.toMatchObject({
      status: "stale_conflict",
    });
    await expect(revoked.savePage(input)).resolves.toMatchObject({
      status: "lifecycle_conflict",
    });
  });

  it("explains when review is unavailable and renders review outcomes", () => {
    expect(render()).toContain(
      "Review unavailable until the Brain pilot backend is connected.",
    );
    expect(
      render({
        reviewNotice: {
          status: "success",
          message: "Note approved and published.",
        },
      }),
    ).toContain("Note approved and published.");
    expect(
      render({
        reviewNotice: {
          status: "failure",
          message: "Unable to review note. Try again.",
        },
      }),
    ).toContain("Unable to review note. Try again.");
  });

  it("renders connected pilot controls without the unavailable placeholder", () => {
    const html = render({
      adapter: {
        ...adapter(),
        submitNote: vi.fn().mockResolvedValue({
          sourceKey: "src_note",
          status: "pending_review" as const,
        }),
        reviewNote: vi.fn().mockResolvedValue({
          sourceKey: "src_note",
          status: "published" as const,
        }),
      },
    });

    expect(html).toContain("Submit note");
    expect(html).toContain("Note markdown");
    expect(html).not.toContain(
      "Review unavailable until the Brain pilot backend is connected.",
    );
  });

  it("renders grouped call maintenance review in the Brain workspace", () => {
    const html = render({
      role: "editor",
      callMaintenanceReview: {
        status: "ready",
        items: [
          {
            proposalKey: "brainmaint_1",
            unitRevisionKey: "surev_1",
            sourceTitle: "Acme weekly",
            sourceUrl: "https://example.test/call_1",
            summary: "Acme approved a Friday launch.",
            routeGeneration: 4,
            sourceLifecycleGeneration: 1,
            workspaceLifecycleGeneration: 1,
            createdAt: 1,
            items: [
              {
                itemKey: "brainmaintitem_1",
                pageKey: page.pageKey,
                title: page.title,
                expectedRevisionKey: page.currentRevisionKey,
                markdown: "Launch Friday.",
                citations: [],
              },
            ],
          },
        ],
      },
    });

    expect(html).toContain("Call-backed Brain updates");
    expect(html).toContain("Acme weekly");
    expect(html).toContain("Accept all changes");
  });

  it("renders search results with stable citations", () => {
    const html = render({
      search: {
        status: "ready",
        query: "proof",
        results: [
          {
            citationKey: "cite_01J0000000000000000000000A",
            title: page.title,
            excerpt: "customer-led growth",
          },
        ],
      },
    });

    expect(html).toContain("Search results for proof");
    expect(html).toContain("customer-led growth");
    expect(html).toContain("cite_01J0000000000000000000000A");
  });
});
