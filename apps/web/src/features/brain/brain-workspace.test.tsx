import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@maestro-template/editor-react/client", () => ({
  BlockNoteSyncEditor: ({
    documentId,
    editable,
  }: {
    readonly documentId: string;
    readonly editable?: boolean;
  }) => (
    <div
      data-editor-document-id={documentId}
      data-editor-editable={editable}
      data-editor-state="loading"
    />
  ),
}));
import { BusinessPageRoot } from "../../saas-ui/business-shell";
import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import {
  BrainWorkspace,
  buildWorkspaceSaveArgs,
  reduceMobileDrawerState,
  reduceSaveConflict,
} from "./brain-workspace";
import type { TemplateMutationState } from "../../adapters/confect-state";
import type { BrainWorkspaceState } from "./brain-surface";

const selectedPage = {
  pageKey: "pg_overview",
  title: "Overview",
  markdown: "# Overview\nTrusted brief.",
  updatedAt: 1_720_000_000_000,
  currentRevisionKey: "rev_overview",
  editorTarget: {
    brainKey: "br_01HX0000000000000000000000",
    pageKey: "pg_overview",
    revisionKey: "rev_overview",
    documentId: "brainPage:br_01HX0000000000000000000000:pg_overview",
    snapshotVersion: 1,
  },
} as const;

const readyState: BrainWorkspaceState = {
  status: "ready",
  brainKey: "br_01HX0000000000000000000000",
  role: "editor",
  canEdit: true,
  asOf: 1_720_000_000_000,
  freshness: "current",
  pages: [
    {
      pageKey: "pg_overview",
      parentPageKey: null,
      title: "Overview",
      siblingSlug: "overview",
      sortKey: "0000000001",
      currentRevisionKey: "rev_overview",
      isFavorite: true,
      isSelected: true,
    },
  ],
  selectedPage,
};

const render = (state: BrainWorkspaceState) =>
  renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <BusinessPageRoot>
        <BrainWorkspace
          state={state}
          onArchivePage={vi.fn()}
          onCreatePage={vi.fn()}
          onFavoritePage={vi.fn()}
          onMovePage={vi.fn()}
          onRenamePage={vi.fn()}
          onSaveMarkdown={vi.fn()}
          onSelectPage={vi.fn()}
          syncApi={{
            getSnapshot: {} as never,
            submitSnapshot: {} as never,
            latestVersion: {} as never,
            getSteps: {} as never,
            submitSteps: {} as never,
          }}
        />
      </BusinessPageRoot>
    </MaestroSaasUiProvider>,
  );

describe("BrainWorkspace", () => {
  it("renders mobile drawer controls with closed disclosure state", () => {
    const html = render(readyState);

    expect(html).toContain("Client Brain");
    expect(html).toContain("Page tree");
    expect(html).toContain("Overview");
    expect(html).toContain("Evidence and history");
    expect(html).toContain("Open page tree");
    expect(html).toContain('aria-controls="brain-mobile-page-tree-drawer"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Open evidence drawer");
    expect(html).toContain('aria-controls="brain-mobile-evidence-drawer"');
  });

  it("hides inline side regions on mobile while closed drawers avoid duplicate content", () => {
    const html = render(readyState);

    expect(html).toContain('data-testid="brain-desktop-page-tree-region"');
    expect(html).toContain('data-testid="brain-desktop-evidence-region"');
    expect(html).toContain("display:none");
    expect(html).toContain("min-width: 64rem");
    expect(html).toContain("display:block");
    expect(html).not.toContain('id="brain-mobile-page-tree-drawer"');
    expect(html).not.toContain('id="brain-mobile-evidence-drawer"');
    expect(html).not.toContain('role="dialog"');
  });

  it("opens and closes the mobile page tree and evidence drawers", () => {
    expect(reduceMobileDrawerState(null, "open_tree")).toBe("tree");
    expect(reduceMobileDrawerState("tree", "close")).toBeNull();
    expect(reduceMobileDrawerState(null, "open_evidence")).toBe("evidence");
    expect(reduceMobileDrawerState("evidence", "close")).toBeNull();
  });

  it("builds fenced existing-page BlockNote snapshot save args", () => {
    expect(buildWorkspaceSaveArgs(readyState, '{"type":"doc"}', 2)).toEqual({
      documentId: "brainPage:br_01HX0000000000000000000000:pg_overview",
      expectedCurrentRevisionKey: "rev_overview",
      snapshot: '{"type":"doc"}',
      version: 2,
    });
  });

  it("preserves the editor-selected revision fence after workspace state advances", () => {
    const advancedState: BrainWorkspaceState = {
      ...readyState,
      selectedPage: {
        ...selectedPage,
        currentRevisionKey: "rev_after_remote_save",
        editorTarget: {
          ...selectedPage.editorTarget,
          revisionKey: "rev_after_remote_save",
          snapshotVersion: 4,
        },
      },
    };

    expect(
      buildWorkspaceSaveArgs(
        advancedState,
        '{"type":"doc"}',
        5,
        "rev_overview",
      ),
    ).toEqual({
      documentId: "brainPage:br_01HX0000000000000000000000:pg_overview",
      expectedCurrentRevisionKey: "rev_overview",
      snapshot: '{"type":"doc"}',
      version: 5,
    });
  });

  it("does not build markdown save args for viewers or missing revisions", () => {
    expect(
      buildWorkspaceSaveArgs(
        { ...readyState, canEdit: false, role: "viewer" },
        "# Edited",
      ),
    ).toBeNull();
    expect(
      buildWorkspaceSaveArgs(
        {
          ...readyState,
          selectedPage: {
            ...selectedPage,
            currentRevisionKey: null,
          },
        },
        "# Edited",
      ),
    ).toBeNull();
    expect(
      buildWorkspaceSaveArgs(
        {
          ...readyState,
          selectedPage: {
            ...selectedPage,
            editorTarget: null,
          },
        },
        "# Edited",
      ),
    ).toBeNull();
  });

  it("classifies stale and revoked save results as workspace conflicts", () => {
    const staleResult: TemplateMutationState<
      unknown,
      { readonly _tag: string }
    > = {
      status: "typed_failure",
      error: { _tag: "StaleRevision" },
    };

    expect(reduceSaveConflict(staleResult)).toBe("stale_revision");
    expect(
      reduceSaveConflict({
        status: "typed_failure",
        error: { _tag: "LifecycleRevoked" },
      }),
    ).toBe("stale_revision");
    expect(
      reduceSaveConflict({
        status: "ready",
        mode: "edit",
        data: {},
        mutation: "success",
      }),
    ).toBeUndefined();
  });

  it.each([
    ["loading" as const, "Loading Brain workspace"],
    ["empty" as const, "No pages in this Brain"],
    ["not_found" as const, "Brain page not found"],
    ["forbidden" as const, "Brain access denied"],
    ["stale_revision" as const, "Newer revision available"],
    ["transport_failure" as const, "Brain workspace unavailable"],
  ])("renders %s state", (status, text) => {
    expect(render({ status })).toContain(text);
  });
});
