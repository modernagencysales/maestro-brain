import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import { BrainPageTree } from "./brain-page-tree";
import type { BrainPageTreeItem } from "./brain-surface";

const pages: readonly BrainPageTreeItem[] = [
  {
    pageKey: "pg_overview",
    parentPageKey: null,
    title: "Overview",
    sortKey: "001",
    currentRevisionKey: "rev_overview",
    isFavorite: true,
    isSelected: true,
  },
  {
    pageKey: "pg_positioning",
    parentPageKey: "pg_overview",
    title: "Positioning",
    sortKey: "002",
    currentRevisionKey: "rev_positioning",
    isFavorite: false,
    isSelected: false,
  },
];

const render = (canEdit = true) =>
  renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <BrainPageTree
        canEdit={canEdit}
        pages={pages}
        onArchivePage={vi.fn()}
        onCreatePage={vi.fn()}
        onFavoritePage={vi.fn()}
        onMovePage={vi.fn()}
        onRenamePage={vi.fn()}
        onSelectPage={vi.fn()}
      />
    </MaestroSaasUiProvider>,
  );

describe("BrainPageTree", () => {
  it("renders keyboard-navigable page tree rows with favorite state", () => {
    const html = render();

    expect(html).toContain("Page tree");
    expect(html).toContain('role="tree"');
    expect(html).toContain(
      'aria-activedescendant="brain-page-tree-pg_overview"',
    );
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Overview");
    expect(html).toContain("Positioning");
    expect(html).toContain("Favorite page");
    expect(html).toContain("Move page to root");
  });

  it("renders editable rename inputs initialized with the current title", () => {
    const html = render();

    expect(html).toContain('aria-label="Rename Overview"');
    expect(html).toContain('value="Overview"');
    expect(html).toContain('aria-label="Rename Positioning"');
    expect(html).toContain('value="Positioning"');
  });

  it("hides mutating actions from viewers", () => {
    const html = render(false);

    expect(html).toContain("Read-only tree");
    expect(html).not.toContain("New page");
    expect(html).not.toContain("Move page to root");
    expect(html).not.toContain("Archive page");
  });
});
