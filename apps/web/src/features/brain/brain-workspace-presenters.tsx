import { Box, Button, Heading, Stack, Text } from "@saas-ui/react";

import type {
  BrainContextPackData,
  BrainContextState,
  BrainPageSummary,
  BrainSearchState,
  BrainSourceGetData,
  BrainSourceState,
} from "./brain-surface";
import type {
  BrainPageDetailState,
  BrainPageListState,
} from "./brain-workspace-types";

export const detailPageKey = (
  detail: BrainPageDetailState,
): string | undefined =>
  detail.status === "ready" ? detail.data.page.pageKey : undefined;

export const PageTree = ({
  pages,
  selectedPageKey,
  onSelectPage,
}: {
  readonly pages: readonly BrainPageSummary[];
  readonly selectedPageKey?: string | undefined;
  readonly onSelectPage?: ((pageKey: string) => void) | undefined;
}) => (
  <nav aria-label="Brain pages">
    <PageTreeLevel
      onSelectPage={onSelectPage}
      pages={pages}
      parentPageKey={null}
      selectedPageKey={selectedPageKey}
    />
  </nav>
);

const PageTreeLevel = ({
  onSelectPage,
  pages,
  parentPageKey,
  selectedPageKey,
}: {
  readonly onSelectPage?: ((pageKey: string) => void) | undefined;
  readonly pages: readonly BrainPageSummary[];
  readonly parentPageKey: string | null;
  readonly selectedPageKey?: string | undefined;
}) => {
  const children = pages
    .filter((page) => page.parentPageKey === parentPageKey)
    .slice()
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  if (children.length === 0) return null;
  return (
    <Box
      as="ul"
      listStyleType="none"
      m="0"
      pl={parentPageKey === null ? "0" : "4"}
    >
      {children.map((page) => (
        <PageTreeItem
          key={page.pageKey}
          onSelectPage={onSelectPage}
          page={page}
          pages={pages}
          selectedPageKey={selectedPageKey}
        />
      ))}
    </Box>
  );
};

const PageTreeItem = ({
  onSelectPage,
  page,
  pages,
  selectedPageKey,
}: {
  readonly onSelectPage?: ((pageKey: string) => void) | undefined;
  readonly page: BrainPageSummary;
  readonly pages: readonly BrainPageSummary[];
  readonly selectedPageKey?: string | undefined;
}) => (
  <Box as="li">
    <Button
      aria-current={page.pageKey === selectedPageKey ? "page" : undefined}
      justifyContent="space-between"
      type="button"
      variant="ghost"
      width="full"
      onClick={() => onSelectPage?.(page.pageKey)}
    >
      <span>{page.title}</span>
      <span>{page.favorite ? "★" : page.status}</span>
    </Button>
    <PageTreeLevel
      onSelectPage={onSelectPage}
      pages={pages}
      parentPageKey={page.pageKey}
      selectedPageKey={selectedPageKey}
    />
  </Box>
);

export const PageState = ({ list }: { readonly list: BrainPageListState }) => {
  const failureMessage = Reflect.get(Object(list), "message") as string;
  const message = {
    loading: "Loading Brain pages",
    skipped: "Select a workspace to load Brain pages.",
    empty: "No Brain pages yet. Submit a note to start the review queue.",
    failure: `Unable to load Brain pages. ${failureMessage}`,
    ready: null,
  }[list.status];
  if (message === null) return null;
  return (
    <Text role={list.status === "failure" ? "alert" : "status"}>{message}</Text>
  );
};

export const DetailState = ({
  detail,
}: {
  readonly detail: BrainPageDetailState;
}) => {
  const failureMessage = Reflect.get(Object(detail), "message") as string;
  const message = {
    loading: "Loading Brain page",
    skipped: null,
    failure: `Unable to load this Brain page. ${failureMessage}`,
    ready: null,
  }[detail.status];
  if (message === null) return null;
  return (
    <Text role={detail.status === "loading" ? "status" : "alert"}>
      {message}
    </Text>
  );
};

const resultStatuses = new Set<BrainSearchState["status"]>([
  "ready",
  "partial",
  "stale",
]);

export const SearchResults = ({
  search,
}: {
  readonly search: BrainSearchState;
}) => {
  if (resultStatuses.has(search.status))
    return <ReadySearchResults search={search as ReadyBrainSearchState} />;
  const query = Reflect.get(Object(search), "query") as string;
  const message = Reflect.get(Object(search), "message") as string;
  const copy = {
    idle: null,
    loading: "Searching Brain",
    empty: `No Brain results for ${query}.`,
    unavailable: `Brain search is unavailable. ${message}`,
    integrity_failure: `Brain citation integrity check failed. ${message}`,
    capacity_failure: `Brain retrieval capacity was exceeded. ${message}`,
    ready: null,
    partial: null,
    stale: null,
  }[search.status];
  if (copy === null) return null;
  return (
    <Text role={searchFailureStatuses.has(search.status) ? "alert" : "status"}>
      {copy}
    </Text>
  );
};

type ReadyBrainSearchState = Extract<
  BrainSearchState,
  { readonly status: "ready" | "partial" | "stale" }
>;

const searchFailureStatuses = new Set<BrainSearchState["status"]>([
  "unavailable",
  "integrity_failure",
  "capacity_failure",
]);

const ReadySearchResults = ({
  search,
}: {
  readonly search: ReadyBrainSearchState;
}) => {
  const statusMessage = {
    ready: null,
    partial:
      "Brain results are partial. Missing coverage or omissions may affect the answer.",
    stale:
      "Brain results may be stale. Check source freshness before relying on them.",
  }[search.status];
  return (
    <Stack aria-label={`Search results for ${search.query}`} gap="2">
      <Heading size="xs">Search results for {search.query}</Heading>
      {statusMessage === null ? null : (
        <Text role="status">{statusMessage}</Text>
      )}
      {search.results.map((result) => (
        <Box
          borderColor="gray.200"
          borderWidth="1px"
          key={`${result.publicationSetKey}:${result.entryKey}`}
          p="3"
        >
          <Text fontWeight="semibold">{result.title}</Text>
          <Text>{result.excerpt}</Text>
          <Text color="gray.600" fontSize="sm">
            Citation: {result.citationKey}
          </Text>
          <Text color="gray.600" fontSize="sm">
            Exact evidence: {result.publicationSetKey} / {result.entryKey}
          </Text>
        </Box>
      ))}
    </Stack>
  );
};

export const BrainReadContractStatus = ({
  context,
  source,
}: {
  readonly context: BrainContextState;
  readonly source: BrainSourceState;
}) => {
  const contextCopy = contextContractCopy(context);
  const sourceCopy = sourceContractCopy(source);
  if ([contextCopy, sourceCopy].every((copy) => copy === null)) return null;
  return (
    <Stack aria-label="Brain read contract status" gap="1">
      <BrainContractStatusLine copy={contextCopy} />
      <BrainContractStatusLine copy={sourceCopy} />
    </Stack>
  );
};

const contextContractCopy = (context: BrainContextState): string | null => {
  const data = Reflect.get(Object(context), "data") as
    BrainContextPackData | undefined;
  const message = Reflect.get(Object(context), "message") as string;
  return {
    idle: null,
    loading: "Loading ContextPack.",
    empty: "ContextPack has no evidence.",
    ready: `ContextPack ready: ${data?.entries.length ?? 0} entries · request ${data?.requestId ?? ""}.`,
    partial: "ContextPack is partial; review coverage and omissions.",
    stale: "ContextPack contains stale or unknown evidence.",
    blocked: `ContextPack is blocked by backend rollout readiness. ${message}`,
    integrity_failure: `ContextPack integrity check failed. ${message}`,
    capacity_failure: `ContextPack capacity was exceeded. ${message}`,
    unavailable: `ContextPack is unavailable. ${message}`,
  }[context.status];
};

const sourceContractCopy = (source: BrainSourceState): string | null => {
  const data = Reflect.get(Object(source), "data") as
    BrainSourceGetData | undefined;
  const message = Reflect.get(Object(source), "message") as string;
  const exactState = source.status === "stale" ? "is stale" : "verified";
  return {
    idle: null,
    loading: "Verifying exact citation.",
    ready: `Exact citation ${exactState}: ${data?.publicationSetKey ?? ""} / ${data?.entryKey ?? ""}.`,
    stale: `Exact citation ${exactState}: ${data?.publicationSetKey ?? ""} / ${data?.entryKey ?? ""}.`,
    integrity_failure: `Exact citation integrity check failed. ${message}`,
    capacity_failure: `Exact citation capacity was exceeded. ${message}`,
    unavailable: `Exact citation is unavailable. ${message}`,
  }[source.status];
};

const BrainContractStatusLine = ({ copy }: { readonly copy: string | null }) =>
  copy === null ? null : (
    <Text role="status" fontSize="sm">
      {copy}
    </Text>
  );
