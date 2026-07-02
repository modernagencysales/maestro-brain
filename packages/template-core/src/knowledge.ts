export type KnowledgeSourceKind = "markdown" | "link" | "note" | "document";

export type KnowledgeFreshness = "fresh" | "review-due" | "stale";

export type KnowledgeConcept = {
  readonly conceptId: string;
  readonly workspaceId: string;
  readonly label: string;
  readonly description: string;
};

export type KnowledgeClaimStatus =
  "supported" | "disputed" | "unsupported-draft";

export type KnowledgeClaim = {
  readonly claimId: string;
  readonly workspaceId: string;
  readonly conceptIds: readonly string[];
  readonly body: string;
  readonly status: KnowledgeClaimStatus;
  readonly citationIds: readonly string[];
  readonly createdAt: string;
};

export type KnowledgeCitation = {
  readonly citationId: string;
  readonly workspaceId: string;
  readonly claimId: string;
  readonly sourceId: string;
  readonly sourceKind: KnowledgeSourceKind;
  readonly sourceTitle: string;
  readonly quotedText: string;
  readonly range: {
    readonly startOffset: number;
    readonly endOffset: number;
  };
  readonly createdAt: string;
};

export type KnowledgeContextPack = {
  readonly contextPackId: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly sourceIds: readonly string[];
  readonly citationIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly freshness: KnowledgeFreshness;
  readonly trustReceiptId: string;
  readonly createdAt: string;
  readonly sourceBacked: true;
};

export type KnowledgeMarkdownDocument = {
  readonly title: string;
  readonly frontmatter: Record<string, string>;
  readonly sections: readonly {
    readonly heading: string;
    readonly body: readonly string[];
  }[];
  readonly citations: readonly {
    readonly id: string;
    readonly sourceId: string;
    readonly quote: string;
  }[];
};

export type KnowledgeSourceMetadata = {
  readonly sourceId: string;
  readonly kind: KnowledgeSourceKind;
  readonly title: string;
  readonly freshness: KnowledgeFreshness;
};

export type OpenKnowledgeFormat = {
  readonly format: "okf";
  readonly version: "0.1";
  readonly workspaceId: string;
  readonly posture: "source-backed-no-default-rag";
  readonly concepts: readonly KnowledgeConcept[];
  readonly claims: readonly KnowledgeClaim[];
  readonly citations: readonly KnowledgeCitation[];
  readonly sources: readonly KnowledgeSourceMetadata[];
};

export class KnowledgeValidationError extends Error {
  readonly _tag = "KnowledgeValidationError";

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeValidationError";
  }
}

const requireNonEmpty = (field: string, value: string): void => {
  if (!value.trim()) {
    throw new KnowledgeValidationError(field, `${field} is required.`);
  }
};

const requireNonEmptyList = (field: string, value: readonly string[]): void => {
  if (value.length === 0 || value.some((item) => !item.trim())) {
    throw new KnowledgeValidationError(
      field,
      `${field} must contain at least one non-empty value.`,
    );
  }
};

const assertRange = (startOffset: number, endOffset: number): void => {
  if (
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset) ||
    startOffset < 0 ||
    endOffset <= startOffset
  ) {
    throw new KnowledgeValidationError(
      "range",
      "citation range must be non-empty and positive.",
    );
  }
};

const dedupe = (items: readonly string[]): readonly string[] => [
  ...new Set(items.map((item) => item.trim()).filter(Boolean)),
];

const yamlQuote = (value: string): string => JSON.stringify(value);

const parseFrontmatterValue = (value: string): string =>
  value.trim().replace(/^"|"$/g, "");

export const createClaim = (input: KnowledgeClaim): KnowledgeClaim => {
  requireNonEmpty("claimId", input.claimId);
  requireNonEmpty("workspaceId", input.workspaceId);
  requireNonEmpty("body", input.body);
  requireNonEmptyList("conceptIds", input.conceptIds);

  if (
    input.status !== "supported" &&
    input.status !== "disputed" &&
    input.status !== "unsupported-draft"
  ) {
    throw new KnowledgeValidationError("status", "claim status is invalid.");
  }

  if (input.status !== "unsupported-draft" && input.citationIds.length === 0) {
    throw new KnowledgeValidationError(
      "citationIds",
      "claims require citations unless they are unsupported drafts.",
    );
  }

  return {
    ...input,
    conceptIds: dedupe(input.conceptIds),
    citationIds: dedupe(input.citationIds),
  };
};

export const attachCitation = (input: {
  readonly citationId: string;
  readonly workspaceId: string;
  readonly claimId: string;
  readonly sourceId: string;
  readonly sourceKind: KnowledgeSourceKind;
  readonly sourceTitle: string;
  readonly quotedText: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly createdAt: string;
}): KnowledgeCitation => {
  requireNonEmpty("citationId", input.citationId);
  requireNonEmpty("workspaceId", input.workspaceId);
  requireNonEmpty("claimId", input.claimId);
  requireNonEmpty("sourceId", input.sourceId);
  requireNonEmpty("sourceTitle", input.sourceTitle);
  requireNonEmpty("quotedText", input.quotedText);
  assertRange(input.startOffset, input.endOffset);

  return {
    citationId: input.citationId,
    workspaceId: input.workspaceId,
    claimId: input.claimId,
    sourceId: input.sourceId,
    sourceKind: input.sourceKind,
    sourceTitle: input.sourceTitle,
    quotedText: input.quotedText,
    range: {
      startOffset: input.startOffset,
      endOffset: input.endOffset,
    },
    createdAt: input.createdAt,
  };
};

export const buildContextPack = (
  input: Omit<KnowledgeContextPack, "sourceBacked">,
): KnowledgeContextPack => {
  requireNonEmpty("contextPackId", input.contextPackId);
  requireNonEmpty("workspaceId", input.workspaceId);
  requireNonEmpty("title", input.title);
  requireNonEmptyList("sourceIds", input.sourceIds);
  requireNonEmptyList("citationIds", input.citationIds);
  requireNonEmptyList("claimIds", input.claimIds);
  requireNonEmpty("trustReceiptId", input.trustReceiptId);

  return {
    ...input,
    sourceIds: dedupe(input.sourceIds),
    citationIds: dedupe(input.citationIds),
    claimIds: dedupe(input.claimIds),
    sourceBacked: true,
  };
};

export const encodeKnowledgeMarkdown = (
  document: KnowledgeMarkdownDocument,
): string => {
  requireNonEmpty("title", document.title);
  const frontmatter = Object.entries(document.frontmatter)
    .map(([key, value]) => `${key}: ${yamlQuote(value)}`)
    .join("\n");
  const sections = document.sections
    .map((section) =>
      `## ${section.heading}\n\n${section.body.join("\n")}`.trimEnd(),
    )
    .join("\n\n");
  const citations = document.citations
    .map(
      (citation) =>
        `[^${citation.id}]: source=${citation.sourceId} quote=${yamlQuote(citation.quote)}`,
    )
    .join("\n");

  return [
    "---",
    frontmatter,
    "---",
    `# ${document.title}`,
    sections,
    citations ? "## Citations" : "",
    citations,
  ]
    .filter((part) => part.length > 0)
    .join("\n\n")
    .concat("\n");
};

export const decodeKnowledgeMarkdown = (
  markdown: string,
): KnowledgeMarkdownDocument => {
  const lines = markdown.split(/\r?\n/);
  const frontmatter: Record<string, string> = {};
  let cursor = 0;

  if (lines[cursor] === "---") {
    cursor += 1;
    while (cursor < lines.length && lines[cursor] !== "---") {
      const line = lines[cursor] ?? "";
      const separator = line.indexOf(":");
      if (separator > 0) {
        frontmatter[line.slice(0, separator).trim()] = parseFrontmatterValue(
          line.slice(separator + 1),
        );
      }
      cursor += 1;
    }
    cursor += 1;
  }

  while (cursor < lines.length && !lines[cursor]?.startsWith("# ")) {
    cursor += 1;
  }
  const title = (lines[cursor] ?? "# Untitled").replace(/^#\s+/, "").trim();
  cursor += 1;

  const sections: {
    readonly heading: string;
    readonly body: readonly string[];
  }[] = [];
  const citations: {
    readonly id: string;
    readonly sourceId: string;
    readonly quote: string;
  }[] = [];
  let current:
    | {
        heading: string;
        body: string[];
      }
    | undefined;

  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] ?? "";

    if (line.startsWith("## ")) {
      if (current && current.heading !== "Citations") {
        sections.push({
          heading: current.heading,
          body: current.body.filter((entry) => entry.trim().length > 0),
        });
      }
      current = { heading: line.replace(/^##\s+/, "").trim(), body: [] };
      continue;
    }

    if (line.startsWith("[^")) {
      const match = line.match(
        /^\[\^([^\]]+)\]: source=([^\s]+) quote="(.*)"$/,
      );
      if (match) {
        citations.push({
          id: match[1] ?? "",
          sourceId: match[2] ?? "",
          quote: match[3] ?? "",
        });
      }
      continue;
    }

    current?.body.push(line);
  }

  if (current && current.heading !== "Citations") {
    sections.push({
      heading: current.heading,
      body: current.body.filter((entry) => entry.trim().length > 0),
    });
  }

  return {
    title,
    frontmatter,
    sections,
    citations,
  };
};

export const exportOkf = (input: {
  readonly workspaceId: string;
  readonly concepts: readonly KnowledgeConcept[];
  readonly claims: readonly KnowledgeClaim[];
  readonly citations: readonly KnowledgeCitation[];
  readonly sources: readonly KnowledgeSourceMetadata[];
}): OpenKnowledgeFormat => {
  requireNonEmpty("workspaceId", input.workspaceId);

  return {
    format: "okf",
    version: "0.1",
    workspaceId: input.workspaceId,
    posture: "source-backed-no-default-rag",
    concepts: input.concepts,
    claims: input.claims.map(createClaim),
    citations: input.citations,
    sources: input.sources,
  };
};
