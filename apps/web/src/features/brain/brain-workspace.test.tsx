import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import {
  BrainWorkspace,
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

const adapter = (): BrainWorkspaceAdapter => ({
  brainKey: "br_01J0000000000000000000000A",
  canEdit: true,
  createPage: vi.fn().mockResolvedValue(page),
  renamePage: vi.fn().mockResolvedValue(page),
  savePage: vi.fn().mockResolvedValue({
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
