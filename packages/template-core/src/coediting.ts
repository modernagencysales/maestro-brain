export type CoeditingActor = {
  readonly type: "human" | "agent";
  readonly id: string;
};

export type DocumentSourceMetadata = {
  readonly kind: "markdown" | "link" | "note" | "document";
  readonly title: string;
  readonly sourceIds: readonly string[];
};

export type DocumentVersion = {
  readonly documentId: string;
  readonly workspaceId: string;
  readonly versionId: string;
  readonly priorVersionId?: string;
  readonly author: CoeditingActor;
  readonly markdown: string;
  readonly sourceMetadata: DocumentSourceMetadata;
  readonly createdAt: string;
  readonly appendOnly: true;
};

export type AnnotationTarget = {
  readonly versionId: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly quotedText: string;
};

export type DocumentAnnotation = {
  readonly annotationId: string;
  readonly documentId: string;
  readonly workspaceId: string;
  readonly target: AnnotationTarget;
  readonly author: CoeditingActor;
  readonly body: string;
  readonly createdAt: string;
  readonly status: "open" | "resolved";
};

export type ReplaceRangeProposal = {
  readonly type: "replace-range";
  readonly startOffset: number;
  readonly endOffset: number;
  readonly markdown: string;
};

export type InsertMarkdownProposal = {
  readonly type: "insert-markdown";
  readonly offset: number;
  readonly markdown: string;
};

export type AgentSuggestionProposal =
  ReplaceRangeProposal | InsertMarkdownProposal;

export type AgentSuggestion = {
  readonly suggestionId: string;
  readonly documentId: string;
  readonly workspaceId: string;
  readonly versionId: string;
  readonly agentId: string;
  readonly proposal: AgentSuggestionProposal;
  readonly reason: string;
  readonly createdAt: string;
  readonly status: "proposed" | "accepted" | "rejected";
};

export class CoeditingValidationError extends Error {
  readonly _tag = "CoeditingValidationError";

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "CoeditingValidationError";
  }
}

const requireNonEmpty = (field: string, value: string): void => {
  if (!value.trim()) {
    throw new CoeditingValidationError(field, `${field} is required.`);
  }
};

const assertRange = (
  startOffset: number,
  endOffset: number,
  field = "target",
): void => {
  if (
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset) ||
    startOffset < 0 ||
    endOffset <= startOffset
  ) {
    throw new CoeditingValidationError(
      field,
      `${field} must have a non-empty positive range.`,
    );
  }
};

const assertActor = (actor: CoeditingActor): void => {
  if (actor.type !== "human" && actor.type !== "agent") {
    throw new CoeditingValidationError("author", "author type is invalid.");
  }
  requireNonEmpty("author.id", actor.id);
};

const assertSourceMetadata = (metadata: DocumentSourceMetadata): void => {
  if (
    metadata.kind !== "markdown" &&
    metadata.kind !== "link" &&
    metadata.kind !== "note" &&
    metadata.kind !== "document"
  ) {
    throw new CoeditingValidationError(
      "sourceMetadata.kind",
      "source metadata kind is invalid.",
    );
  }
  requireNonEmpty("sourceMetadata.title", metadata.title);
};

const parseProposal = (proposal: unknown): AgentSuggestionProposal => {
  if (!proposal || typeof proposal !== "object" || !("type" in proposal)) {
    throw new CoeditingValidationError(
      "proposal.type",
      "agent suggestions must be typed markdown proposals.",
    );
  }

  const candidate = proposal as Record<string, unknown>;

  if (candidate.type === "replace-range") {
    if (
      typeof candidate.startOffset !== "number" ||
      typeof candidate.endOffset !== "number" ||
      typeof candidate.markdown !== "string"
    ) {
      throw new CoeditingValidationError(
        "proposal",
        "replace-range proposals require numeric offsets and markdown.",
      );
    }
    assertRange(candidate.startOffset, candidate.endOffset, "proposal");
    requireNonEmpty("proposal.markdown", candidate.markdown);
    return {
      type: "replace-range",
      startOffset: candidate.startOffset,
      endOffset: candidate.endOffset,
      markdown: candidate.markdown,
    };
  }

  if (candidate.type === "insert-markdown") {
    if (
      typeof candidate.offset !== "number" ||
      typeof candidate.markdown !== "string"
    ) {
      throw new CoeditingValidationError(
        "proposal",
        "insert-markdown proposals require an offset and markdown.",
      );
    }
    if (!Number.isInteger(candidate.offset) || candidate.offset < 0) {
      throw new CoeditingValidationError(
        "proposal.offset",
        "proposal offset must be zero or greater.",
      );
    }
    requireNonEmpty("proposal.markdown", candidate.markdown);
    return {
      type: "insert-markdown",
      offset: candidate.offset,
      markdown: candidate.markdown,
    };
  }

  throw new CoeditingValidationError(
    "proposal.type",
    "agent suggestions must be typed markdown proposals.",
  );
};

export const createDocumentVersion = (
  input: Omit<DocumentVersion, "appendOnly">,
): DocumentVersion => {
  requireNonEmpty("documentId", input.documentId);
  requireNonEmpty("workspaceId", input.workspaceId);
  requireNonEmpty("versionId", input.versionId);
  requireNonEmpty("markdown", input.markdown);
  assertActor(input.author);
  assertSourceMetadata(input.sourceMetadata);

  return {
    ...input,
    appendOnly: true,
  };
};

export const createAnnotation = (
  input: Omit<DocumentAnnotation, "status">,
): DocumentAnnotation => {
  requireNonEmpty("annotationId", input.annotationId);
  requireNonEmpty("documentId", input.documentId);
  requireNonEmpty("workspaceId", input.workspaceId);
  requireNonEmpty("body", input.body);
  assertActor(input.author);
  assertRange(input.target.startOffset, input.target.endOffset);
  requireNonEmpty("target.quotedText", input.target.quotedText);

  return {
    ...input,
    status: "open",
  };
};

export const createAgentSuggestion = (
  input:
    | Omit<AgentSuggestion, "status">
    | (Omit<AgentSuggestion, "status" | "proposal"> & {
        readonly proposal: Record<string, unknown>;
      }),
): AgentSuggestion => {
  requireNonEmpty("suggestionId", input.suggestionId);
  requireNonEmpty("documentId", input.documentId);
  requireNonEmpty("workspaceId", input.workspaceId);
  requireNonEmpty("versionId", input.versionId);
  requireNonEmpty("agentId", input.agentId);
  requireNonEmpty("reason", input.reason);
  const proposal = parseProposal(input.proposal);

  return {
    suggestionId: input.suggestionId,
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    versionId: input.versionId,
    agentId: input.agentId,
    proposal,
    reason: input.reason,
    createdAt: input.createdAt,
    status: "proposed",
  };
};
