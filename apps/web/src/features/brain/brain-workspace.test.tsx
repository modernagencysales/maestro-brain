import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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
import { BusinessPageRoot } from "../../saas-ui/business-shell";
import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import {
  BrainWorkspace,
  buildWorkspaceSaveArgs,
  type BrainMarkdownSaveArgs,
  readWorkspaceEditorRevisionFence,
  reduceMobileDrawerState,
  reduceWorkspaceEditorRevisionFenceAfterSave,
  reduceSaveConflict,
} from "./brain-workspace";
import type { TemplateMutationState } from "../../adapters/confect-state";
import type { BrainWorkspaceState } from "./brain-surface";

type FakeDomNode = {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly tagName: string | undefined;
  readonly style: Record<string, string> | undefined;
  readonly ownerDocument: FakeDomDocument | undefined;
  textContent: string;
  append: (...nodes: Array<FakeDomNode | string>) => void;
  appendChild: (node: FakeDomNode) => FakeDomNode;
  insertBefore: (node: FakeDomNode, before: FakeDomNode | null) => FakeDomNode;
  removeChild: (node: FakeDomNode) => FakeDomNode;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  addEventListener: () => void;
  removeEventListener: () => void;
};

type FakeDomDocument = FakeDomNode & {
  readonly defaultView: Record<string, unknown>;
  readonly documentElement: FakeDomNode;
  readonly head: FakeDomNode;
  readonly body: FakeDomNode & { replaceChildren: () => void };
  activeElement: FakeDomNode | null;
  createElement: (tagName: string) => FakeDomNode;
  createElementNS: (_namespace: string, tagName: string) => FakeDomNode;
  createTextNode: (text: string) => FakeDomNode;
};

function createFakeDomNode(
  nodeName: string,
  nodeType: number,
  ownerDocument?: FakeDomDocument,
): FakeDomNode {
  const children: Array<FakeDomNode | string> = [];
  const attributes = new Map<string, string>();
  const node: FakeDomNode = {
    nodeType,
    nodeName,
    tagName: nodeType === 1 ? nodeName : undefined,
    style: nodeType === 1 ? {} : undefined,
    ownerDocument,
    get textContent() {
      const ownText = attributes.get("__text") ?? "";
      return (
        ownText +
        children
          .map((child) =>
            typeof child === "string" ? child : child.textContent,
          )
          .join("")
      );
    },
    set textContent(value: string) {
      children.splice(0, children.length);
      attributes.set("__text", value);
    },
    append: (...nodes) => {
      children.push(...nodes);
    },
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    insertBefore: (child, before) => {
      const index = before === null ? -1 : children.indexOf(before);
      if (index === -1) children.push(child);
      else children.splice(index, 0, child);
      return child;
    },
    removeChild: (child) => {
      const index = children.indexOf(child);
      if (index !== -1) children.splice(index, 1);
      return child;
    },
    setAttribute: (name, value) => {
      attributes.set(name, value);
    },
    removeAttribute: (name) => {
      attributes.delete(name);
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return node;
}

function installFakeDom(): FakeDomDocument {
  const document = createFakeDomNode("#document", 9) as FakeDomDocument;
  const documentElement = createFakeDomNode("HTML", 1, document);
  const head = createFakeDomNode("HEAD", 1, document);
  const body = createFakeDomNode(
    "BODY",
    1,
    document,
  ) as FakeDomDocument["body"];
  body.replaceChildren = () => {
    body.textContent = "";
  };
  Object.assign(document, {
    defaultView: {
      HTMLElement: function HTMLElement() {},
      HTMLIFrameElement: function HTMLIFrameElement() {},
      Node: function Node() {},
    },
    documentElement,
    head,
    body,
    activeElement: body,
    ownerDocument: document,
    createElement: (tagName: string) =>
      createFakeDomNode(tagName.toUpperCase(), 1, document),
    createElementNS: (_namespace: string, tagName: string) =>
      createFakeDomNode(tagName.toUpperCase(), 1, document),
    createTextNode: (text: string) => {
      const textNode = createFakeDomNode("#text", 3, document);
      textNode.textContent = text;
      return textNode;
    },
  });
  Object.assign(globalThis, {
    document,
    window: document.defaultView,
    HTMLElement: document.defaultView.HTMLElement,
    HTMLIFrameElement: document.defaultView.HTMLIFrameElement,
    Node: document.defaultView.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  return document;
}

const testDocument: FakeDomDocument =
  typeof document === "undefined"
    ? installFakeDom()
    : (document as unknown as FakeDomDocument);

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
          syncApi={syncApi}
        />
      </BusinessPageRoot>
    </MaestroSaasUiProvider>,
  );

type DeferredSave = {
  readonly promise: Promise<
    TemplateMutationState<unknown, { readonly _tag?: string }>
  >;
  readonly resolve: (
    value: TemplateMutationState<unknown, { readonly _tag?: string }>,
  ) => void;
};

function createDeferredSave(): DeferredSave {
  let resolve!: DeferredSave["resolve"];
  const promise = new Promise<
    TemplateMutationState<unknown, { readonly _tag?: string }>
  >((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

function renderStatefulWorkspace({
  onSaveMarkdown,
}: {
  readonly onSaveMarkdown: (
    args: BrainMarkdownSaveArgs | null,
  ) => Promise<TemplateMutationState<unknown, { readonly _tag?: string }>>;
}): { readonly container: FakeDomNode; readonly root: Root } {
  const container = testDocument.createElement("div");
  testDocument.body.append(container);
  const root = createRoot(
    container as unknown as Parameters<typeof createRoot>[0],
  );
  act(() => {
    root.render(
      <MaestroSaasUiProvider>
        <BusinessPageRoot>
          <BrainWorkspace
            state={readyState}
            onArchivePage={vi.fn()}
            onCreatePage={vi.fn()}
            onFavoritePage={vi.fn()}
            onMovePage={vi.fn()}
            onRenamePage={vi.fn()}
            onSaveMarkdown={onSaveMarkdown}
            onSelectPage={vi.fn()}
            syncApi={syncApi}
          />
        </BusinessPageRoot>
      </MaestroSaasUiProvider>,
    );
  });
  return { container, root };
}

afterEach(() => {
  testDocument.body.replaceChildren();
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
      <MaestroSaasUiProvider>
        <BusinessPageRoot>
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
          />
        </BusinessPageRoot>
      </MaestroSaasUiProvider>,
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

  it("keeps a newer rejected BlockNote save conflict when an older deferred save resolves later", async () => {
    const olderSave = createDeferredSave();
    const newerSave = createDeferredSave();
    const onSaveMarkdown = vi
      .fn<
        (
          args: BrainMarkdownSaveArgs | null,
        ) => Promise<TemplateMutationState<unknown, { readonly _tag?: string }>>
      >()
      .mockReturnValueOnce(olderSave.promise)
      .mockReturnValueOnce(newerSave.promise);
    const { container, root } = renderStatefulWorkspace({ onSaveMarkdown });

    act(() => {
      capturedEditorProps.current?.onDocumentChange?.(
        '{"type":"older edit"}',
        2,
        "rev_overview",
      );
      capturedEditorProps.current?.onDocumentChange?.(
        '{"type":"newer edit"}',
        3,
        "rev_overview",
      );
    });

    expect(onSaveMarkdown).toHaveBeenNthCalledWith(1, {
      documentId: "brainPage:br_01HX0000000000000000000000:pg_overview",
      expectedCurrentRevisionKey: "rev_overview",
      snapshot: '{"type":"older edit"}',
      version: 2,
    });
    expect(onSaveMarkdown).toHaveBeenNthCalledWith(2, {
      documentId: "brainPage:br_01HX0000000000000000000000:pg_overview",
      expectedCurrentRevisionKey: "rev_overview",
      snapshot: '{"type":"newer edit"}',
      version: 3,
    });

    await act(async () => {
      newerSave.resolve({
        status: "typed_failure",
        error: { _tag: "StaleRevision" },
      });
      await newerSave.promise;
    });
    await act(async () => {
      olderSave.resolve({
        status: "ready",
        mode: "edit",
        mutation: "success",
        data: { pageRevisionKey: "rev_from_older_success" },
      });
      await olderSave.promise;
    });

    expect(container.textContent).toContain("Newer revision available");
    expect(capturedEditorProps.current).toMatchObject({
      expectedCurrentRevisionKey: "rev_overview",
      initialSnapshotVersion: 1,
    });
    expect(onSaveMarkdown.mock.calls.at(-1)?.[0]).toMatchObject({
      snapshot: '{"type":"newer edit"}',
      version: 3,
    });

    act(() => root.unmount());
  });

  it("ignores an older BlockNote save success that resolves before a newer rejection", async () => {
    const olderSave = createDeferredSave();
    const newerSave = createDeferredSave();
    const onSaveMarkdown = vi
      .fn<
        (
          args: BrainMarkdownSaveArgs | null,
        ) => Promise<TemplateMutationState<unknown, { readonly _tag?: string }>>
      >()
      .mockReturnValueOnce(olderSave.promise)
      .mockReturnValueOnce(newerSave.promise);
    const { container, root } = renderStatefulWorkspace({ onSaveMarkdown });

    act(() => {
      capturedEditorProps.current?.onDocumentChange?.(
        '{"type":"older edit"}',
        2,
        "rev_overview",
      );
      capturedEditorProps.current?.onDocumentChange?.(
        '{"type":"newer edit"}',
        3,
        "rev_overview",
      );
    });

    await act(async () => {
      olderSave.resolve({
        status: "ready",
        mode: "edit",
        mutation: "success",
        data: { pageRevisionKey: "rev_from_older_success" },
      });
      await olderSave.promise;
    });
    await act(async () => {
      newerSave.resolve({
        status: "typed_failure",
        error: { _tag: "StaleRevision" },
      });
      await newerSave.promise;
    });

    expect(container.textContent).toContain("Newer revision available");
    expect(capturedEditorProps.current).toMatchObject({
      expectedCurrentRevisionKey: "rev_overview",
      initialSnapshotVersion: 1,
    });
    expect(onSaveMarkdown.mock.calls.at(-1)?.[0]).toMatchObject({
      snapshot: '{"type":"newer edit"}',
      version: 3,
    });

    act(() => root.unmount());
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
