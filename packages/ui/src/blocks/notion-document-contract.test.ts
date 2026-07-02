import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(path, "utf8");

describe("Notion document block contract", () => {
  it("exports reusable document blocks from packages/ui", () => {
    const index = read("src/index.tsx");

    expect(index).toContain("./blocks/notion-document");
    expect(index).toContain("./blocks/ux-essentials");
  });

  it("keeps markdown-style page rendering out of route-local sample code", () => {
    const blocks = read("src/blocks/notion-document.tsx");
    const app = read("../../apps/web/src/sample/App.tsx");

    expect(blocks).toContain("NotionDocumentPage");
    expect(blocks).toContain("renderInlineMarkdown");
    expect(blocks).toContain("NotionDocumentDiagram");
    expect(app).toContain("NotionDocumentPage");
    expect(app).not.toContain("renderInlineMarkdown");
    expect(app).not.toContain("MarkdownLine");
  });

  it("keeps accessibility and resilience blocks reusable", () => {
    const blocks = read("src/blocks/ux-essentials.tsx");

    expect(blocks).toContain("TemplateSkipLink");
    expect(blocks).toContain("TemplateLiveRegion");
    expect(blocks).toContain("TemplateNetworkBanner");
    expect(blocks).toContain("TemplateEmptyState");
    expect(blocks).toContain("TemplateToastProvider");
    expect(blocks).toContain("TemplateRoutePending");
    expect(blocks).toContain("TemplateRouteError");
    expect(blocks).toContain("useTemplateFocusReturn");
    expect(blocks).toContain('role="status"');
    expect(blocks).toContain('role="alert"');
    expect(blocks).toContain('aria-live="polite"');
  });
});
