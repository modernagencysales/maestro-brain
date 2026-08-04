import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import {
  BrainWorkspace,
  createBrainWorkspaceActions,
  type BrainPageDetailState,
  type BrainPageListState,
} from "./brain-workspace";
import type { BrainWorkspaceAdapter } from "./brain-surface";

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

describe("BrainWorkspace", () => {
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
