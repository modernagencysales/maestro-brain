import type { FormEvent } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Input,
  Stack,
  Text,
} from "@saas-ui/react";

import type {
  BrainContextState,
  BrainSearchState,
  BrainSourceState,
  BrainWorkspaceAdapter,
} from "./brain-surface";
import type { BrainCitation } from "./citation-list";
import {
  BrainReadContractStatus,
  PageTree,
  SearchResults,
  detailPageKey,
} from "./brain-workspace-presenters";
import type {
  BrainPageDetailState,
  BrainPageListState,
} from "./brain-workspace-types";

export const brainCitationItems = (
  search: BrainSearchState,
): readonly BrainCitation[] => {
  if (!searchResultStatuses.has(search.status)) return [];
  const results = (
    search as Extract<
      BrainSearchState,
      { readonly status: "ready" | "partial" | "stale" }
    >
  ).results;
  return results.map((result) => ({
    citationKey: result.citationKey,
    publicationSetKey: result.publicationSetKey,
    entryKey: result.entryKey,
    sourceRevisionKey: result.sourceRevisionKey,
    locator: result.locator ?? "Locator not provided",
    ...(result.citationLabel === undefined
      ? {}
      : { label: result.citationLabel }),
    freshness: result.freshness,
    state: result.state,
    quotedText: result.excerpt,
    ...(result.permalink === undefined ? {} : { permalink: result.permalink }),
  }));
};

const searchResultStatuses = new Set<BrainSearchState["status"]>([
  "ready",
  "partial",
  "stale",
]);

export const BrainSearchPanel = ({
  adapter,
  context,
  onQueryChange,
  onSubmit,
  query,
  search,
  source,
}: {
  readonly adapter: BrainWorkspaceAdapter;
  readonly context: BrainContextState;
  readonly onQueryChange: (query: string) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly query: string;
  readonly search: BrainSearchState;
  readonly source: BrainSourceState;
}) => (
  <Card.Root>
    <Card.Header>
      <HStack justify="space-between" wrap="wrap" gap="3">
        <Box>
          <Heading size="md">Brain workspace</Heading>
          <Text color="gray.600" fontSize="sm">
            Review source notes, edit approved pages, and search with citations.
          </Text>
        </Box>
        <Badge colorPalette="blue">{adapter.brainKey}</Badge>
      </HStack>
    </Card.Header>
    <Card.Body>
      <Stack gap="3">
        <form aria-label="Search Brain" onSubmit={onSubmit}>
          <HStack align="flex-end" gap="2">
            <Box flex="1">
              <label htmlFor="brain-search">Search Brain</label>
              <Input
                id="brain-search"
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search approved pages"
                value={query}
              />
            </Box>
            <Button type="submit">Search</Button>
          </HStack>
        </form>
        <SearchResults search={search} />
        <BrainReadContractStatus context={context} source={source} />
      </Stack>
    </Card.Body>
  </Card.Root>
);

export const BrainPagesPanel = ({
  detail,
  list,
  onSelectPage,
  selectedPageKey,
}: {
  readonly detail: BrainPageDetailState;
  readonly list: BrainPageListState;
  readonly onSelectPage?: ((pageKey: string) => void) | undefined;
  readonly selectedPageKey?: string | undefined;
}) => {
  if (list.status !== "ready" || list.data.pages.length === 0) return null;
  return (
    <Card.Root>
      <Card.Header>
        <Heading size="sm">Pages</Heading>
      </Card.Header>
      <Card.Body>
        <PageTree
          pages={list.data.pages}
          selectedPageKey={selectedPageKey ?? detailPageKey(detail)}
          onSelectPage={onSelectPage}
        />
      </Card.Body>
    </Card.Root>
  );
};

export const CreateBrainPagePanel = ({
  adapter,
  onNotice,
  onTitleChange,
  title,
}: {
  readonly adapter: BrainWorkspaceAdapter;
  readonly onNotice: (notice: string) => void;
  readonly onTitleChange: (title: string) => void;
  readonly title: string;
}) => {
  if (!adapter.canEdit) return null;
  return (
    <Card.Root>
      <Card.Header>
        <Heading size="sm">Add a page</Heading>
      </Card.Header>
      <Card.Body>
        <form
          aria-label="Create page"
          onSubmit={(event) => createBrainPage(event, adapter, title, onNotice)}
        >
          <HStack align="flex-end" gap="2" wrap="wrap">
            <Box flex="1" minW="12rem">
              <label htmlFor="new-brain-page-title">Page title</label>
              <Input
                id="new-brain-page-title"
                onChange={(event) => onTitleChange(event.target.value)}
                placeholder="New page title"
                value={title}
              />
            </Box>
            <Button type="submit">Create page</Button>
          </HStack>
        </form>
      </Card.Body>
    </Card.Root>
  );
};

const createBrainPage = async (
  event: FormEvent<HTMLFormElement>,
  adapter: BrainWorkspaceAdapter,
  title: string,
  onNotice: (notice: string) => void,
) => {
  event.preventDefault();
  try {
    const trimmedTitle = title.trim();
    const slug = trimmedTitle
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    await adapter.createPage({
      brainKey: adapter.brainKey,
      parentPageKey: null,
      siblingSlug: slug || "new-page",
      sortKey: String(Date.now()).slice(-10),
      title: trimmedTitle || "Untitled page",
      markdown: "",
      expectedCurrentRevisionKey: null,
    });
    onNotice("Page created.");
  } catch {
    onNotice("Unable to create page. Try again.");
  }
};
