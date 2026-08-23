export type SearchMode = "fake" | "test" | "live";

export type SearchChunk = {
  readonly workspaceSlug: string;
  readonly chunkId: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly text: string;
};

export type SearchQueryInput = {
  readonly workspaceSlug: string;
  readonly query: string;
  readonly limit?: number;
};

export type SearchHit = {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly snippet: string;
  readonly score: number;
};

// invariant: retrieval feeds bounded prompt context; higher recall comes from
// re-querying, not from raising this cap.
export const MAX_SEARCH_LIMIT = 50;
const DEFAULT_LIMIT = 10;
const SNIPPET_LENGTH = 160;

export class SearchQueryError extends Error {
  readonly _tag = "SearchQueryError";

  constructor(readonly reason: "empty-query" | "invalid-limit") {
    super(
      reason === "empty-query"
        ? "Search query must not be blank."
        : `Search limit must be between 1 and ${String(MAX_SEARCH_LIMIT)}.`,
    );
    this.name = "SearchQueryError";
  }
}

export class SearchConfigError extends Error {
  readonly _tag = "SearchConfigError";

  constructor(readonly mode: SearchMode) {
    super(
      `Search mode "${mode}" requires an injected retrieval adapter. ` +
        "Client forks wire a vector/full-text backend here; the template " +
        "defaults to the deterministic fake index.",
    );
    this.name = "SearchConfigError";
  }
}

export type SearchService = {
  readonly mode: SearchMode;
  readonly query: (input: SearchQueryInput) => readonly SearchHit[];
};

export type LiveSearchAdapter = (
  input: Required<SearchQueryInput>,
) => readonly SearchHit[];

const tokenize = (value: string): readonly string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);

const snippetOf = (text: string): string =>
  text.length <= SNIPPET_LENGTH
    ? text
    : `${text.slice(0, SNIPPET_LENGTH - 1).trimEnd()}…`;

const scoreChunk = (
  queryTokens: readonly string[],
  chunk: SearchChunk,
): number => {
  const chunkTokens = new Set(tokenize(`${chunk.sourceTitle} ${chunk.text}`));
  if (chunkTokens.size === 0) {
    return 0;
  }
  const matched = queryTokens.filter((token) => chunkTokens.has(token));
  return matched.length / queryTokens.length;
};

const validate = (input: SearchQueryInput): Required<SearchQueryInput> => {
  const query = input.query.trim();
  if (query.length === 0) {
    throw new SearchQueryError("empty-query");
  }
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
    throw new SearchQueryError("invalid-limit");
  }
  return { workspaceSlug: input.workspaceSlug, query, limit };
};

/**
 * Deterministic workspace-scoped retrieval seam. Fake/test modes rank the
 * provided chunks by token overlap; live mode requires an injected adapter so
 * provider SDKs never leak into this package. Tenant scoping happens here, in
 * one place: a query can only ever see chunks from its own workspace.
 */
export const createSearchService = (options: {
  readonly mode: SearchMode;
  readonly chunks?: readonly SearchChunk[];
  readonly liveAdapter?: LiveSearchAdapter;
}): SearchService => {
  const chunks = options.chunks ?? [];

  const query = (input: SearchQueryInput): readonly SearchHit[] => {
    const validated = validate(input);

    if (options.mode === "live") {
      if (!options.liveAdapter) {
        throw new SearchConfigError(options.mode);
      }
      return options.liveAdapter(validated);
    }

    const queryTokens = tokenize(validated.query);
    if (queryTokens.length === 0) {
      return [];
    }

    return chunks
      .filter((chunk) => chunk.workspaceSlug === validated.workspaceSlug)
      .map((chunk) => ({
        chunkId: chunk.chunkId,
        sourceId: chunk.sourceId,
        sourceTitle: chunk.sourceTitle,
        snippet: snippetOf(chunk.text),
        score: scoreChunk(queryTokens, chunk),
      }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId))
      .slice(0, validated.limit);
  };

  return { mode: options.mode, query };
};
