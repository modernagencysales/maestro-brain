import { describe, expect, it } from "vitest";
import {
  buildBrainWorkspaceState,
  describeBrainWorkspaceState,
  nextPageSortKey,
  toEditorTarget,
  type BrainWorkspaceData,
  type BrainWorkspaceFailure,
} from "./brain-surface";

const pages = [
  {
    pageKey: "pg_overview",
    parentPageKey: null,
    siblingSlug: "overview",
    sortKey: "0000000001",
    title: "Overview",
    favorite: true,
    status: "active",
    currentRevisionKey: "rev_overview",
    lifecycleGeneration: 1,
  },
  {
    pageKey: "pg_archived",
    parentPageKey: null,
    siblingSlug: "archived",
    sortKey: "0000000002",
    title: "Archived",
    favorite: false,
    status: "archived",
    currentRevisionKey: "rev_archived",
    lifecycleGeneration: 1,
  },
] as const;

const selectedPage = {
  page: {
    ...pages[0],
  },
  markdown: "# Overview\nTrusted client brief.",
  editorSnapshotJson: "[]",
  editorSnapshotVersion: 3,
  updatedAt: 1_720_000_000_000,
} satisfies NonNullable<BrainWorkspaceData["selectedPage"]>;

const data: BrainWorkspaceData = {
  brainKey: "br_01HX0000000000000000000000",
  asOf: 1_720_000_000_000,
  freshness: { status: "current" },
  pages,
  selectedPage,
  role: "editor",
};

describe("Brain workspace state", () => {
  it("builds a ready workspace with active tree pages, selected detail, and editable target", () => {
    expect(
      buildBrainWorkspaceState({ status: "ready", mode: "edit", data }),
    ).toEqual({
      status: "ready",
      brainKey: data.brainKey,
      role: "editor",
      canEdit: true,
      asOf: data.asOf,
      freshness: "current",
      pages: [
        expect.objectContaining({
          pageKey: "pg_overview",
          title: "Overview",
          siblingSlug: "overview",
          isSelected: true,
          isFavorite: true,
        }),
      ],
      selectedPage: expect.objectContaining({
        pageKey: "pg_overview",
        markdown: "# Overview\nTrusted client brief.",
        editorTarget: {
          brainKey: data.brainKey,
          pageKey: "pg_overview",
          revisionKey: "rev_overview",
          documentId: `${"brainPage:"}${data.brainKey}:pg_overview`,
          snapshotVersion: 3,
        },
      }),
    });
  });

  it("keeps viewers read-only even when the transport is in edit mode", () => {
    const state = buildBrainWorkspaceState({
      status: "ready",
      mode: "edit",
      data: { ...data, role: "viewer" },
    });

    expect(state).toMatchObject({
      status: "ready",
      canEdit: false,
      role: "viewer",
    });
  });

  it("maps empty, not-found, forbidden, stale, and transport states without leaking cross-Brain existence", () => {
    expect(
      buildBrainWorkspaceState({ status: "empty", data: null }),
    ).toMatchObject({ status: "empty" });
    expect(
      buildBrainWorkspaceState({
        status: "typed_failure",
        error: {
          _tag: "PageNotFound",
          pageKey: "pg_other",
        } satisfies BrainWorkspaceFailure,
      }),
    ).toMatchObject({ status: "not_found" });
    expect(
      buildBrainWorkspaceState({
        status: "typed_failure",
        error: { _tag: "Forbidden" } satisfies BrainWorkspaceFailure,
      }),
    ).toMatchObject({ status: "forbidden" });
    expect(
      buildBrainWorkspaceState({
        status: "typed_failure",
        error: {
          _tag: "StaleRevision",
          pageKey: "pg_overview",
          expectedCurrentRevisionKey: "rev_old",
          actualCurrentRevisionKey: "rev_new",
        } satisfies BrainWorkspaceFailure,
      }),
    ).toMatchObject({ status: "stale_revision" });
    expect(
      buildBrainWorkspaceState({
        status: "transport_failure",
        error: new Error("offline"),
        message: "offline",
      }),
    ).toMatchObject({ status: "transport_failure" });
  });

  it("returns no editor target when the selected page has no current revision", () => {
    expect(
      toEditorTarget(data.brainKey, {
        ...selectedPage,
        page: {
          ...pages[0],
          currentRevisionKey: null,
        },
      }),
    ).toBeNull();
  });

  it("describes non-ready states and creates deterministic tree sort keys", () => {
    expect(describeBrainWorkspaceState({ status: "forbidden" })).toContain(
      "authorized",
    );
    expect(
      nextPageSortKey([{ sortKey: "0000000001" }, { sortKey: "0000000002" }]),
    ).toBe("0000000003");
    expect(toEditorTarget(data.brainKey, selectedPage)).toMatchObject({
      pageKey: "pg_overview",
      revisionKey: "rev_overview",
      documentId: `${"brainPage:"}${data.brainKey}:pg_overview`,
    });
  });
});
