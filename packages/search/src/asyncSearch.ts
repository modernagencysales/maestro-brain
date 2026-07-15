import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export type SearchMode = "test" | "live";

// invariant: retrieval feeds bounded prompt context; higher recall comes from
// re-querying, not from raising this cap.
export const MAX_SEARCH_LIMIT = 50;

export type SearchDocument = {
  readonly workspaceSlug: string;
  readonly brainKey: string;
  readonly projectionKey: string;
  readonly revisionKey: string;
  readonly sourceTitle: string;
  readonly text: string;
};

export type SearchFilters = Readonly<Record<string, string | boolean | number>>;

export type SearchInput = {
  readonly workspaceSlug: string;
  readonly brainKey: string;
  readonly query: string;
  readonly cap?: number;
  readonly cursor?: string;
  readonly filters?: SearchFilters;
};

export type SearchCandidate = {
  readonly projectionKey: string;
  readonly revisionKey: string;
  readonly sourceTitle: string;
  readonly snippet: string;
  readonly score: number;
  readonly order: number;
};

export type SearchPage = {
  readonly candidates: readonly SearchCandidate[];
  readonly nextCursor: string | null;
};

export type ValidatedSearchInput = Required<
  Pick<SearchInput, "workspaceSlug" | "brainKey" | "query">
> & {
  readonly cap: number;
  readonly cursor?: string;
  readonly filters?: SearchFilters;
};

export class SearchUnavailable extends Schema.TaggedError<SearchUnavailable>()(
  "SearchUnavailable",
  { retryable: Schema.Boolean },
) {}

export class SearchTimeout extends Schema.TaggedError<SearchTimeout>()(
  "SearchTimeout",
  { timeoutMillis: Schema.Number },
) {}

export class SearchQueryInvalid extends Schema.TaggedError<SearchQueryInvalid>()(
  "SearchQueryInvalid",
  { reason: Schema.Literal("empty-query", "invalid-cap") },
) {}

export class SearchCursorInvalid extends Schema.TaggedError<SearchCursorInvalid>()(
  "SearchCursorInvalid",
  { cursor: Schema.String },
) {}

export type SearchError =
  SearchUnavailable | SearchTimeout | SearchQueryInvalid | SearchCursorInvalid;

export type SearchProviderAdapter = {
  readonly search: (
    input: ValidatedSearchInput,
  ) => Effect.Effect<SearchPage, SearchError>;
};

export class SearchProvider extends Context.Tag("SearchProvider")<
  SearchProvider,
  SearchProviderAdapter
>() {}

export type AsyncSearchService = {
  readonly mode: SearchMode;
  readonly search: (
    input: SearchInput,
  ) => Effect.Effect<SearchPage, SearchError, SearchProvider>;
};

const DEFAULT_CAP = 10;
const DEFAULT_TIMEOUT_MILLIS = 5_000;
const SNIPPET_LENGTH = 160;
const CURSOR_PATTERN = /^[A-Za-z0-9._:-]+$/;

const tokenize = (value: string): readonly string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);

const snippetOf = (text: string): string =>
  text.length <= SNIPPET_LENGTH
    ? text
    : `${text.slice(0, SNIPPET_LENGTH - 1).trimEnd()}…`;

const scoreDocument = (
  queryTokens: readonly string[],
  document: SearchDocument,
): number => {
  const documentTokens = new Set(
    tokenize(`${document.sourceTitle} ${document.text}`),
  );
  if (documentTokens.size === 0) {
    return 0;
  }

  return (
    queryTokens.filter((token) => documentTokens.has(token)).length /
    queryTokens.length
  );
};

const validate = (
  input: SearchInput,
): ValidatedSearchInput | SearchQueryInvalid | SearchCursorInvalid => {
  const query = input.query.trim();
  if (query.length === 0) {
    return new SearchQueryInvalid({ reason: "empty-query" });
  }

  const cap = input.cap ?? DEFAULT_CAP;
  if (!Number.isInteger(cap) || cap < 1 || cap > MAX_SEARCH_LIMIT) {
    return new SearchQueryInvalid({ reason: "invalid-cap" });
  }

  if (input.cursor !== undefined && !CURSOR_PATTERN.test(input.cursor)) {
    return new SearchCursorInvalid({ cursor: input.cursor });
  }

  return {
    workspaceSlug: input.workspaceSlug,
    brainKey: input.brainKey,
    query,
    cap,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.filters ? { filters: input.filters } : {}),
  };
};

const fakeSearch = (
  documents: readonly SearchDocument[],
  input: ValidatedSearchInput,
): SearchPage => {
  const queryTokens = tokenize(input.query);
  if (queryTokens.length === 0) {
    return { candidates: [], nextCursor: null };
  }

  const candidates = documents
    .filter(
      (document) =>
        document.workspaceSlug === input.workspaceSlug &&
        document.brainKey === input.brainKey,
    )
    .map((document) => ({
      document,
      score: scoreDocument(queryTokens, document),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.document.projectionKey.localeCompare(right.document.projectionKey),
    )
    .slice(0, input.cap)
    .map(({ document, score }, order) => ({
      projectionKey: document.projectionKey,
      revisionKey: document.revisionKey,
      sourceTitle: document.sourceTitle,
      snippet: snippetOf(document.text),
      score,
      order,
    }));

  return { candidates, nextCursor: null };
};

export const createAsyncSearchService = (options: {
  readonly mode: SearchMode;
  /** Test/rollback-only deterministic fake documents; never used in live mode. */
  readonly documents?: readonly SearchDocument[];
  readonly timeoutMillis?: number;
}): AsyncSearchService => {
  const documents = options.documents ?? [];
  const timeoutMillis = options.timeoutMillis ?? DEFAULT_TIMEOUT_MILLIS;

  const search = (input: SearchInput) =>
    Effect.gen(function* () {
      const validated = validate(input);
      if (
        validated instanceof SearchQueryInvalid ||
        validated instanceof SearchCursorInvalid
      ) {
        return yield* Effect.fail(validated);
      }

      if (options.mode === "live") {
        const provider = yield* SearchProvider;
        return yield* provider.search(validated).pipe(
          Effect.timeoutFail({
            duration: `${timeoutMillis} millis`,
            onTimeout: () => new SearchTimeout({ timeoutMillis }),
          }),
        );
      }

      return fakeSearch(documents, validated);
    });

  return { mode: options.mode, search };
};
