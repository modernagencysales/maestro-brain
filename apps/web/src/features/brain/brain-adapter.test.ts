import { describe, expect, it, vi } from "vitest";
import {
  buildBrainRouteArgs,
  buildBrainWorkspaceControllerState,
  brainRefs,
  buildWorkspaceSyncApi,
  editorSyncRefs,
  nextUntitledPageSlug,
  saveBrainMarkdown,
} from "./brain-adapter";

describe("brain adapter", () => {
  it("exposes only generated Brain page refs through the feature adapter", () => {
    expect(brainRefs.pages).toHaveProperty("list");
    expect(brainRefs.pages).toHaveProperty("get");
    expect(brainRefs.pages).toHaveProperty("create");
    expect(brainRefs.pages).toHaveProperty("rename");
    expect(brainRefs.pages).toHaveProperty("move");
    expect(brainRefs.pages).toHaveProperty("favorite");
    expect(brainRefs.pages).toHaveProperty("archive");
    expect(brainRefs.pages).toHaveProperty("recordSnapshot");
  });

  it("skips queries until stable Brain and page keys are present", () => {
    expect(buildBrainRouteArgs({})).toEqual({
      listArgs: "skip",
      detailArgs: "skip",
    });
    expect(
      buildBrainRouteArgs({
        brainKey: "br_01HX0000000000000000000000",
        pageKey: "pg_overview",
      }),
    ).toEqual({
      listArgs: { brainKey: "br_01HX0000000000000000000000" },
      detailArgs: {
        brainKey: "br_01HX0000000000000000000000",
        pageKey: "pg_overview",
      },
    });
  });

  it("keeps the workspace loading while redirecting no-pageKey entries to the first active page", () => {
    const listState = {
      status: "ready",
      mode: "read",
      data: {
        brainKey: "br_01HX0000000000000000000000",
        asOf: 1_720_000_000_000,
        freshness: { status: "current" },
        pages: [
          {
            pageKey: "pg_overview",
            parentPageKey: null,
            siblingSlug: "overview",
            sortKey: "0000000001",
            title: "Overview",
            favorite: false,
            status: "active",
            currentRevisionKey: "rev_overview",
            lifecycleGeneration: 1,
          },
        ],
      },
    } as const;

    expect(
      buildBrainWorkspaceControllerState(
        listState,
        { status: "skipped" },
        "viewer",
      ),
    ).toEqual({ status: "loading" });
  });

  it("propagates selected page typed failures instead of hiding them behind an empty selection", () => {
    const listState = {
      status: "ready",
      mode: "read",
      data: {
        brainKey: "br_01HX0000000000000000000000",
        asOf: 1_720_000_000_000,
        freshness: { status: "current" },
        pages: [
          {
            pageKey: "pg_overview",
            parentPageKey: null,
            siblingSlug: "overview",
            sortKey: "0000000001",
            title: "Overview",
            favorite: false,
            status: "active",
            currentRevisionKey: "rev_overview",
            lifecycleGeneration: 1,
          },
        ],
      },
    } as const;

    expect(
      buildBrainWorkspaceControllerState(
        listState,
        {
          status: "typed_failure",
          error: { _tag: "PageNotFound", pageKey: "pg_cross_brain" },
        },
        "viewer",
      ),
    ).toEqual({ status: "not_found" });
    expect(
      buildBrainWorkspaceControllerState(
        listState,
        { status: "typed_failure", error: { _tag: "Forbidden" } },
        "viewer",
      ),
    ).toEqual({ status: "forbidden" });
    expect(
      buildBrainWorkspaceControllerState(
        listState,
        {
          status: "typed_failure",
          error: {
            _tag: "StaleRevision",
            pageKey: "pg_overview",
            expectedCurrentRevisionKey: "rev_old",
            actualCurrentRevisionKey: "rev_new",
          },
        },
        "editor",
      ),
    ).toEqual({ status: "stale_revision" });
  });

  it("builds generated editor sync refs in the adapter boundary", () => {
    expect(buildWorkspaceSyncApi()).toBe(editorSyncRefs);
    expect(editorSyncRefs).toEqual({
      getSnapshot: expect.anything(),
      submitSnapshot: expect.anything(),
      latestVersion: expect.anything(),
      getSteps: expect.anything(),
      submitSteps: expect.anything(),
    });
  });

  it("builds unique default root slugs for repeated page creates", () => {
    expect(nextUntitledPageSlug([])).toBe("untitled-page");
    expect(
      nextUntitledPageSlug([
        { parentPageKey: null, title: "Untitled page" },
        { parentPageKey: null, title: "Untitled page 2" },
        { parentPageKey: "pg_parent", title: "Untitled page 3" },
      ]),
    ).toBe("untitled-page-3");
    expect(
      nextUntitledPageSlug([
        {
          parentPageKey: null,
          title: "Untitled page",
          siblingSlug: "untitled-page",
        },
        {
          parentPageKey: null,
          title: "Untitled page",
          siblingSlug: "untitled-page-2",
        },
      ]),
    ).toBe("untitled-page-3");
  });

  it("routes existing-page snapshots through public revision-fenced args", async () => {
    const save = vi.fn().mockResolvedValue({ pageKey: "pg_overview" });
    const args = {
      documentId: "brainPage:br_01HX0000000000000000000000:pg_overview",
      expectedCurrentRevisionKey: "rev_overview",
      snapshot: '{"type":"doc"}',
      version: 2,
    };

    await expect(saveBrainMarkdown(save, args)).resolves.toMatchObject({
      status: "ready",
      mutation: "success",
    });
    expect(save).toHaveBeenCalledWith(args);
  });

  it("does not fabricate success when save args cannot be built", async () => {
    const save = vi.fn();

    await expect(saveBrainMarkdown(save, null)).resolves.toMatchObject({
      status: "typed_failure",
      error: { _tag: "ValidationFailed" },
    });
    expect(save).not.toHaveBeenCalled();
  });
});
