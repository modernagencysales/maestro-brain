import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BusinessPageRoot } from "../../saas-ui/business-shell";
import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import {
  BrainWorkspace,
  buildWorkspaceSaveArgs,
  reduceSaveConflict,
} from "./brain-workspace";
import type { TemplateMutationState } from "../../adapters/confect-state";
import type { BrainWorkspaceState } from "./brain-surface";

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
      sortKey: "001",
      currentRevisionKey: "rev_overview",
      isFavorite: true,
      isSelected: true,
    },
  ],
  selectedPage: {
    pageKey: "pg_overview",
    title: "Overview",
    markdown: "# Overview\nTrusted brief.",
    updatedAt: 1_720_000_000_000,
    currentRevisionKey: "rev_overview",
    editorTarget: {
      brainKey: "br_01HX0000000000000000000000",
      pageKey: "pg_overview",
      revisionKey: "rev_overview",
      snapshotVersion: 1,
    },
  },
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
        />
      </BusinessPageRoot>
    </MaestroSaasUiProvider>,
  );

describe("BrainWorkspace", () => {
  it("renders the responsive three-region workspace", () => {
    const html = render(readyState);

    expect(html).toContain("Client Brain");
    expect(html).toContain("Page tree");
    expect(html).toContain("Overview");
    expect(html).toContain("Evidence and history");
    expect(html).toContain("Mobile page drawer");
  });

  it("does not build create-page args for existing-page markdown saves", () => {
    expect(buildWorkspaceSaveArgs(readyState, "# Edited")).toBeNull();
  });

  it("classifies stale save results as editor conflicts", () => {
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
