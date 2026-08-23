import { describe, expect, it } from "vitest";
import { buildGroundedAnswer } from "../confect/agents/assistantGrounding";

const NOW = Date.UTC(2026, 7, 23);
const WORKSPACE = "workspace_alpha";

const page = (overrides: Record<string, unknown> = {}) => ({
  id: "page_alpha",
  workspaceId: WORKSPACE,
  title: "Acme launch plan",
  markdown: "Acme will launch the customer portal on Friday.",
  updatedAt: NOW - 2_000,
  status: "active" as const,
  ...overrides,
});

const revision = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: WORKSPACE,
  pageId: "page_alpha",
  title: "Acme launch plan",
  markdown: "Acme will launch the customer portal on Friday.",
  updatedAt: NOW - 2_000,
  status: "active" as const,
  ...overrides,
});

describe("assistant Brain grounding", () => {
  it("returns exact current revision citations", () => {
    const result = buildGroundedAnswer({
      workspaceId: WORKSPACE,
      question: "When does Acme launch the portal?",
      pages: [page()],
      revisions: [revision()],
      now: NOW,
    });

    expect(result.status).toBe("answered");
    expect(result.citations).toEqual([
      expect.objectContaining({
        citationKey: `citation:page_alpha:${NOW - 2_000}`,
        sourceRevisionId: `brain-page:page_alpha:revision:${NOW - 2_000}`,
        revisionUpdatedAt: NOW - 2_000,
        excerpt: "Acme will launch the customer portal on Friday.",
        freshness: "current",
      }),
    ]);
    const citation = result.citations[0];
    expect(citation).toBeDefined();
    expect(
      page().markdown.slice(citation?.startOffset, citation?.endOffset),
    ).toBe(citation?.excerpt);
    expect(result.asOf).toBe(NOW);
  });

  it("excludes archived and mismatched revisions", () => {
    const result = buildGroundedAnswer({
      workspaceId: WORKSPACE,
      question: "Acme launch",
      pages: [
        page({ id: "archived", status: "archived" }),
        page({ id: "mismatch" }),
      ],
      revisions: [
        revision({ pageId: "archived" }),
        revision({ pageId: "mismatch", markdown: "Old content" }),
      ],
      now: NOW,
    });

    expect(result).toMatchObject({
      status: "insufficient-context",
      answerMarkdown: null,
      freshness: "unknown",
      omissions: [
        { reason: "archived", count: 1 },
        { reason: "revision-mismatch", count: 1 },
      ],
    });
  });

  it("never retrieves evidence from another workspace", () => {
    const result = buildGroundedAnswer({
      workspaceId: WORKSPACE,
      question: "Acme launch",
      pages: [page({ workspaceId: "workspace_other" })],
      revisions: [revision({ workspaceId: "workspace_other" })],
      now: NOW,
    });

    expect(result.status).toBe("insufficient-context");
    expect(result.citations).toEqual([]);
  });

  it("abstains when no eligible evidence matches the question", () => {
    const result = buildGroundedAnswer({
      workspaceId: WORKSPACE,
      question: "What is the renewal price?",
      pages: [page()],
      revisions: [revision()],
      now: NOW,
    });

    expect(result).toMatchObject({
      status: "insufficient-context",
      answerMarkdown: null,
      omissions: [{ reason: "not-relevant", count: 1 }],
    });
  });
});
