import { createElement, type ElementType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { capturedEditorProps } = vi.hoisted(() => ({
  capturedEditorProps: {
    current: null as null | {
      readonly documentId: string;
      readonly editable?: boolean;
      readonly expectedCurrentRevisionKey?: string | null;
      readonly initialSnapshotVersion?: number;
      readonly onDocumentChange?: (
        snapshot: string,
        version: number,
        expectedCurrentRevisionKey: string,
      ) => void;
    },
  },
}));

vi.mock("@saas-ui/react", () => {
  const passthrough =
    (tag: ElementType) =>
    ({ children, ...props }: Record<string, unknown>) =>
      createElement(tag, props, children as ReactNode);
  const Page = {
    Header: ({ title, description, actions }: Record<string, unknown>) => (
      <header>
        <h1>{title as ReactNode}</h1>
        <p>{description as ReactNode}</p>
        <div>{actions as ReactNode}</div>
      </header>
    ),
    Body: passthrough("main"),
  };
  const Card = {
    Root: passthrough("section"),
    Header: passthrough("header"),
    Body: passthrough("div"),
  };
  return {
    Badge: passthrough("span"),
    Box: passthrough("div"),
    Button: passthrough("button"),
    Card,
    HStack: passthrough("div"),
    Heading: passthrough("h2"),
    Input: passthrough("input"),
    Page,
    SimpleGrid: passthrough("div"),
    Stack: passthrough("div"),
    Text: passthrough("p"),
    Textarea: passthrough("textarea"),
  };
});

vi.mock("@maestro-template/editor-react/client", () => ({
  BlockNoteSyncEditor: (props: {
    readonly documentId: string;
    readonly editable?: boolean;
    readonly expectedCurrentRevisionKey?: string | null;
    readonly initialSnapshotVersion?: number;
    readonly onDocumentChange?: (
      snapshot: string,
      version: number,
      expectedCurrentRevisionKey: string,
    ) => void;
  }) => {
    capturedEditorProps.current = props;
    return (
      <div
        data-editor-document-id={props.documentId}
        data-editor-editable={props.editable}
        data-editor-expected-revision={props.expectedCurrentRevisionKey}
        data-editor-initial-version={props.initialSnapshotVersion}
        data-editor-state="loading"
      />
    );
  },
}));
import {
  BrainWorkspace,
  buildWorkspaceSaveArgs,
  readWorkspaceEditorRevisionFence,
  reduceMobileDrawerState,
  reduceWorkspaceEditorRevisionFenceAfterSave,
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

const syncApi = {
  getSnapshot: {} as never,
  submitSnapshot: {} as never,
  latestVersion: {} as never,
  getSteps: {} as never,
  submitSteps: {} as never,
};

const render = (state: BrainWorkspaceState) =>
  renderToStaticMarkup(
    <BrainWorkspace
      state={state}
      onArchivePage={vi.fn()}
      onCreatePage={vi.fn()}
      onFavoritePage={vi.fn()}
      onMovePage={vi.fn()}
      onRenamePage={vi.fn()}
      onSaveMarkdown={vi.fn()}
      onSelectPage={vi.fn()}
      syncApi={syncApi}
    />,
  );

afterEach(() => {
  capturedEditorProps.current = null;
});

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
    expect(html).toContain('display="[object Object]"');
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
    expect(
      readWorkspaceEditorRevisionFence(
        {
          documentId: "brainPage:br_01HX0000000000000000000000:pg_overview",
          revisionKey: "rev_overview",
        },
        {
          documentId: "brainPage:br_01HX0000000000000000000000:pg_overview",
          revisionKey: "rev_after_remote_save",
        },
      ),
    ).toBe("rev_overview");
    expect(
      readWorkspaceEditorRevisionFence(
        {
          documentId: "brainPage:br_01HX0000000000000000000000:pg_overview",
          revisionKey: "rev_overview",
        },
        {
          documentId: "brainPage:br_01HX0000000000000000000000:pg_next",
          revisionKey: "rev_next",
        },
      ),
    ).toBe("rev_next");

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

    const onSaveMarkdown = vi.fn(async () => ({
      status: "ready" as const,
      mode: "edit" as const,
      data: {},
      mutation: "success" as const,
    }));
    renderToStaticMarkup(
      <BrainWorkspace
        state={advancedState}
        onArchivePage={vi.fn()}
        onCreatePage={vi.fn()}
        onFavoritePage={vi.fn()}
        onMovePage={vi.fn()}
        onRenamePage={vi.fn()}
        onSaveMarkdown={onSaveMarkdown}
        onSelectPage={vi.fn()}
        syncApi={{
          getSnapshot: {} as never,
          submitSnapshot: {} as never,
          latestVersion: {} as never,
          getSteps: {} as never,
          submitSteps: {} as never,
        }}
      />,
    );
    expect(capturedEditorProps.current).toMatchObject({
      documentId: "brainPage:br_01HX0000000000000000000000:pg_overview",
      expectedCurrentRevisionKey: "rev_after_remote_save",
    });
    capturedEditorProps.current?.onDocumentChange?.(
      '{"type":"doc"}',
      5,
      "rev_overview",
    );

    expect(onSaveMarkdown).toHaveBeenCalledWith({
      documentId: "brainPage:br_01HX0000000000000000000000:pg_overview",
      expectedCurrentRevisionKey: "rev_overview",
      snapshot: '{"type":"doc"}',
      version: 5,
    });
  });

  it("advances the local editor fence after sequential successful saves", () => {
    const firstSave: TemplateMutationState<
      { readonly pageRevisionKey: string },
      { readonly _tag: string }
    > = {
      status: "ready",
      mode: "edit",
      mutation: "success",
      data: { pageRevisionKey: "rev_after_first_save" },
    };
    const secondSave: TemplateMutationState<
      { readonly pageRevisionKey: string },
      { readonly _tag: string }
    > = {
      status: "ready",
      mode: "edit",
      mutation: "success",
      data: { pageRevisionKey: "rev_after_second_save" },
    };

    const firstFence = reduceWorkspaceEditorRevisionFenceAfterSave(
      firstSave,
      "rev_overview",
    );
    expect(firstFence).toBe("rev_after_first_save");
    expect(
      reduceWorkspaceEditorRevisionFenceAfterSave(secondSave, firstFence),
    ).toBe("rev_after_second_save");
  });

  it("keeps the local editor fence unchanged after stale concurrent saves", () => {
    const staleSave: TemplateMutationState<
      { readonly pageRevisionKey: string },
      { readonly _tag: string }
    > = {
      status: "typed_failure",
      error: { _tag: "StaleRevision" },
    };

    expect(
      reduceWorkspaceEditorRevisionFenceAfterSave(staleSave, "rev_overview"),
    ).toBe("rev_overview");
  });

  it("preserves stale conflict while stale saves keep the selected revision fence", () => {
    const staleSave: TemplateMutationState<unknown, { readonly _tag: string }> =
      {
        status: "typed_failure",
        error: { _tag: "StaleRevision" },
      };
    const olderSuccess: TemplateMutationState<
      { readonly pageRevisionKey: string },
      { readonly _tag: string }
    > = {
      status: "ready",
      mode: "edit",
      mutation: "success",
      data: { pageRevisionKey: "rev_from_older_success" },
    };

    expect(reduceSaveConflict(staleSave)).toBe("stale_revision");
    expect(
      reduceWorkspaceEditorRevisionFenceAfterSave(staleSave, "rev_overview"),
    ).toBe("rev_overview");
    expect(
      reduceWorkspaceEditorRevisionFenceAfterSave(olderSuccess, "rev_overview"),
    ).toBe("rev_from_older_success");
    expect(
      readWorkspaceEditorRevisionFence(
        {
          documentId: "brainPage:br_01HX0000000000000000000000:pg_overview",
          revisionKey: "rev_overview",
        },
        {
          documentId: "brainPage:br_01HX0000000000000000000000:pg_overview",
          revisionKey: "rev_after_remote_save",
        },
      ),
    ).toBe("rev_overview");
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
