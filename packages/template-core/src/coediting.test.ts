import { describe, expect, it } from "vitest";
import {
  createAgentSuggestion,
  createAnnotation,
  createDocumentVersion,
  CoeditingValidationError,
} from "./coediting";

describe("coediting domain", () => {
  it("creates append-only document versions that keep workspace ownership and prior version references", () => {
    const version = createDocumentVersion({
      documentId: "doc_123",
      workspaceId: "workspace_123",
      versionId: "version_002",
      priorVersionId: "version_001",
      author: { type: "human", id: "user_123" },
      markdown: "# Updated source note\n\nThis version keeps provenance.",
      sourceMetadata: {
        kind: "markdown",
        title: "Founder notes",
        sourceIds: ["source_001"],
      },
      createdAt: "2026-07-01T17:00:00.000Z",
    });

    expect(version).toEqual({
      documentId: "doc_123",
      workspaceId: "workspace_123",
      versionId: "version_002",
      priorVersionId: "version_001",
      author: { type: "human", id: "user_123" },
      markdown: "# Updated source note\n\nThis version keeps provenance.",
      sourceMetadata: {
        kind: "markdown",
        title: "Founder notes",
        sourceIds: ["source_001"],
      },
      createdAt: "2026-07-01T17:00:00.000Z",
      appendOnly: true,
    });
  });

  it("creates annotations against stable markdown ranges for human or agent authors", () => {
    const annotation = createAnnotation({
      annotationId: "annotation_001",
      documentId: "doc_123",
      workspaceId: "workspace_123",
      target: {
        versionId: "version_002",
        startOffset: 4,
        endOffset: 24,
        quotedText: "Updated source note",
      },
      author: { type: "agent", id: "planner_agent" },
      body: "This claim needs a citation before publishing.",
      createdAt: "2026-07-01T17:01:00.000Z",
    });

    expect(annotation).toMatchObject({
      annotationId: "annotation_001",
      documentId: "doc_123",
      workspaceId: "workspace_123",
      target: {
        versionId: "version_002",
        startOffset: 4,
        endOffset: 24,
      },
      author: { type: "agent", id: "planner_agent" },
      status: "open",
    });
  });

  it("represents agent suggestions as typed proposals rather than executable code", () => {
    const suggestion = createAgentSuggestion({
      suggestionId: "suggestion_001",
      documentId: "doc_123",
      workspaceId: "workspace_123",
      versionId: "version_002",
      agentId: "planner_agent",
      proposal: {
        type: "replace-range",
        startOffset: 10,
        endOffset: 18,
        markdown: "source-backed claim",
      },
      reason: "Align wording with approved source language.",
      createdAt: "2026-07-01T17:02:00.000Z",
    });

    expect(suggestion).toEqual({
      suggestionId: "suggestion_001",
      documentId: "doc_123",
      workspaceId: "workspace_123",
      versionId: "version_002",
      agentId: "planner_agent",
      proposal: {
        type: "replace-range",
        startOffset: 10,
        endOffset: 18,
        markdown: "source-backed claim",
      },
      reason: "Align wording with approved source language.",
      createdAt: "2026-07-01T17:02:00.000Z",
      status: "proposed",
    });
  });

  it("rejects invalid ranges and executable agent proposals", () => {
    expect(() =>
      createAnnotation({
        annotationId: "annotation_bad",
        documentId: "doc_123",
        workspaceId: "workspace_123",
        target: {
          versionId: "version_002",
          startOffset: 24,
          endOffset: 4,
          quotedText: "bad",
        },
        author: { type: "human", id: "user_123" },
        body: "bad range",
        createdAt: "2026-07-01T17:03:00.000Z",
      }),
    ).toThrow(CoeditingValidationError);

    expect(() =>
      createAgentSuggestion({
        suggestionId: "suggestion_bad",
        documentId: "doc_123",
        workspaceId: "workspace_123",
        versionId: "version_002",
        agentId: "planner_agent",
        proposal: {
          type: "execute-code",
          code: "deleteEverything()",
        },
        reason: "not allowed",
        createdAt: "2026-07-01T17:04:00.000Z",
      }),
    ).toThrow(CoeditingValidationError);
  });
});
