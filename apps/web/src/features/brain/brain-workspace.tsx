import { useEffect, useState, type FormEvent } from "react";
import {
  useTemplateMutation,
  useTemplateQuery,
} from "../../adapters/confect-state";
import { useWorkspace } from "../../providers/workspace";
import {
  BusinessAppShell,
  BusinessPageRoot,
} from "../../saas-ui/business-shell";
import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Input,
  Page,
  Stack,
  Text,
} from "@saas-ui/react";
import type {
  BrainPageDetail,
  BrainPageListData,
  BrainPageSummary,
  BrainSearchResult,
  BrainWorkspaceAdapter,
} from "./brain-surface";
import {
  brainWorkspaceRefs,
  createBrainWorkspaceAdapter,
} from "./brain-surface";

export type BrainPageListState =
  | { readonly status: "loading" | "skipped" }
  | { readonly status: "empty"; readonly data: BrainPageListData }
  | { readonly status: "ready"; readonly data: BrainPageListData }
  | { readonly status: "failure"; readonly message: string };

export type BrainPageDetailState =
  | { readonly status: "loading" | "skipped" }
  | { readonly status: "ready"; readonly data: BrainPageDetail }
  | { readonly status: "failure"; readonly message: string };

export type BrainSearchState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly query: string }
  | {
      readonly status: "ready";
      readonly query: string;
      readonly results: readonly BrainSearchResult[];
    }
  | {
      readonly status: "failure";
      readonly query: string;
      readonly message: string;
    };

export type BrainReviewNotice = {
  readonly status: "success" | "failure";
  readonly message: string;
};

export const BrainWorkspaceRoute = () => {
  const workspace = useWorkspace();
  const [search, setSearch] = useState<BrainSearchState>({ status: "idle" });
  const brainKey =
    workspace.status === "ready" ? workspace.activeWorkspace.workspaceId : null;
  const list = useTemplateQuery(
    brainWorkspaceRefs.list,
    brainKey === null ? "skip" : { brainKey },
    { isEmpty: (data: BrainPageListData) => data.pages.length === 0 },
  );
  const selected = list.status === "ready" ? list.data.pages[0]?.pageKey : null;
  const detail = useTemplateQuery(
    brainWorkspaceRefs.get,
    brainKey === null || selected === undefined || selected === null
      ? "skip"
      : { brainKey, pageKey: selected },
  );
  const create = useTemplateMutation(brainWorkspaceRefs.create);
  const rename = useTemplateMutation(brainWorkspaceRefs.rename);

  if (workspace.status !== "ready") {
    return (
      <BusinessAppShell activePath="/brain">
        <BusinessPageRoot>
          <Page.Header
            title="Agency Brain"
            description="Select an active workspace to load Brain pages."
          />
        </BusinessPageRoot>
      </BusinessAppShell>
    );
  }

  const listState: BrainPageListState =
    list.status === "ready" || list.status === "empty"
      ? list
      : list.status === "loading" || list.status === "skipped"
        ? list
        : { status: "failure", message: "The Brain page list request failed." };
  const detailState: BrainPageDetailState =
    detail.status === "ready"
      ? detail
      : detail.status === "loading" || detail.status === "skipped"
        ? detail
        : { status: "failure", message: "The Brain page request failed." };
  const adapter = createBrainWorkspaceAdapter({
    brainKey: workspace.activeWorkspace.workspaceId,
    canEdit: workspace.activeWorkspace.role !== "viewer",
    mutations: { create, rename },
  });

  return (
    <BusinessAppShell activePath="/brain">
      <BusinessPageRoot>
        <Page.Header
          title="Agency Brain"
          description="Review and edit source-grounded workspace knowledge."
        />
        <Page.Body px={{ base: "4", md: "6" }} pb="8">
          <BrainWorkspace
            adapter={adapter}
            detail={detailState}
            list={listState}
            onSearch={(query) => {
              setSearch({
                status: "failure",
                query,
                message:
                  "Search is unavailable until the Brain pilot backend is connected.",
              });
            }}
            search={search}
          />
        </Page.Body>
      </BusinessPageRoot>
    </BusinessAppShell>
  );
};

export const BrainWorkspace = ({
  adapter,
  detail,
  list,
  mode: initialMode = "read",
  onSearch,
  reviewNotice,
  search = { status: "idle" },
}: {
  readonly adapter: BrainWorkspaceAdapter;
  readonly detail: BrainPageDetailState;
  readonly list: BrainPageListState;
  readonly mode?: "read" | "edit";
  readonly onSearch?: (query: string) => void;
  readonly reviewNotice?: BrainReviewNotice;
  readonly search?: BrainSearchState;
}) => {
  const [mode, setMode] = useState(initialMode);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState(
    detail.status === "ready" ? detail.data.page.title : "",
  );
  const [markdown, setMarkdown] = useState(
    detail.status === "ready" ? detail.data.markdown : "",
  );
  const [operationNotice, setOperationNotice] = useState<string | null>(null);

  useEffect(() => {
    if (detail.status === "ready") {
      setTitle(detail.data.page.title);
      setMarkdown(detail.data.markdown);
    }
  }, [detail]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = query.trim();
    if (nextQuery.length > 0) onSearch?.(nextQuery);
  };

  return (
    <Stack as="section" aria-label="Brain workspace" gap="4">
      <Card.Root>
        <Card.Header>
          <HStack justify="space-between" wrap="wrap" gap="3">
            <Box>
              <Heading size="md">Brain workspace</Heading>
              <Text color="gray.600" fontSize="sm">
                Review source notes, edit approved pages, and search with
                citations.
              </Text>
            </Box>
            <Badge colorPalette="blue">{adapter.brainKey}</Badge>
          </HStack>
        </Card.Header>
        <Card.Body>
          <Stack gap="3">
            <form aria-label="Search Brain" onSubmit={submitSearch}>
              <HStack align="flex-end" gap="2">
                <Box flex="1">
                  <label htmlFor="brain-search">Search Brain</label>
                  <Input
                    id="brain-search"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search approved pages"
                    value={query}
                  />
                </Box>
                <Button type="submit">Search</Button>
              </HStack>
            </form>
            <SearchResults search={search} />
          </Stack>
        </Card.Body>
      </Card.Root>

      <PageState list={list} />
      {list.status === "ready" && list.data.pages.length > 0 ? (
        <Card.Root>
          <Card.Header>
            <Heading size="sm">Pages</Heading>
          </Card.Header>
          <Card.Body>
            <Stack gap="2">
              {list.data.pages.map((page: BrainPageSummary) => (
                <Box
                  borderColor="gray.200"
                  borderWidth="1px"
                  key={page.pageKey}
                  p="3"
                >
                  <HStack justify="space-between" wrap="wrap" gap="2">
                    <Text fontWeight="semibold">{page.title}</Text>
                    <Badge
                      colorPalette={page.status === "active" ? "green" : "gray"}
                    >
                      {page.status}
                    </Badge>
                  </HStack>
                </Box>
              ))}
            </Stack>
          </Card.Body>
        </Card.Root>
      ) : null}

      {adapter.canEdit ? (
        <Card.Root>
          <Card.Header>
            <Heading size="sm">Add a page</Heading>
          </Card.Header>
          <Card.Body>
            <form
              aria-label="Create page"
              onSubmit={async (event) => {
                event.preventDefault();
                try {
                  await adapter.createPage({
                    brainKey: adapter.brainKey,
                    parentPageKey: null,
                    siblingSlug:
                      title.trim().toLowerCase().replaceAll(" ", "-") ||
                      "new-page",
                    sortKey: String(Date.now()),
                    title: title.trim() || "Untitled page",
                    markdown: "",
                    expectedCurrentRevisionKey: null,
                  });
                  setOperationNotice("Page created.");
                } catch {
                  setOperationNotice("Unable to create page. Try again.");
                }
              }}
            >
              <HStack align="flex-end" gap="2" wrap="wrap">
                <Box flex="1" minW="12rem">
                  <label htmlFor="new-brain-page-title">Page title</label>
                  <Input
                    id="new-brain-page-title"
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="New page title"
                    value={title}
                  />
                </Box>
                <Button type="submit">Create page</Button>
              </HStack>
            </form>
          </Card.Body>
        </Card.Root>
      ) : null}

      {detail.status === "ready" ? (
        <Card.Root>
          <Card.Header>
            <HStack justify="space-between" wrap="wrap" gap="2">
              <Heading size="sm">
                {mode === "edit"
                  ? `Edit ${detail.data.page.title}`
                  : detail.data.page.title}
              </Heading>
              {adapter.canEdit ? (
                <Button
                  type="button"
                  onClick={() => setMode(mode === "read" ? "edit" : "read")}
                >
                  {mode === "read" ? "Edit page" : "Cancel edit"}
                </Button>
              ) : null}
            </HStack>
          </Card.Header>
          <Card.Body>
            {mode === "edit" ? (
              <Stack gap="3">
                <label htmlFor="brain-page-title">Page title</label>
                <Input
                  id="brain-page-title"
                  onChange={(event) => setTitle(event.target.value)}
                  value={title}
                />
                <Button
                  type="button"
                  onClick={async () => {
                    const revisionKey = detail.data.page.currentRevisionKey;
                    if (revisionKey === null) {
                      setOperationNotice(
                        "Unable to rename a page without a current revision.",
                      );
                      return;
                    }
                    try {
                      await adapter.renamePage({
                        brainKey: adapter.brainKey,
                        pageKey: detail.data.page.pageKey,
                        expectedCurrentRevisionKey: revisionKey,
                        title: title.trim() || "Untitled page",
                      });
                      setOperationNotice("Page renamed.");
                    } catch {
                      setOperationNotice("Unable to rename page. Try again.");
                    }
                  }}
                >
                  Rename page
                </Button>
                <label htmlFor="brain-page-markdown">Page markdown</label>
                <textarea
                  aria-label="Page markdown"
                  id="brain-page-markdown"
                  onChange={(event) => setMarkdown(event.target.value)}
                  rows={12}
                  value={markdown}
                />
                <Button
                  disabled={adapter.savePage === undefined}
                  type="button"
                  onClick={() => undefined}
                >
                  Save page
                </Button>
                {adapter.savePage === undefined ? (
                  <Text color="gray.600" fontSize="sm">
                    Page content saving is unavailable until the public snapshot
                    ref is connected.
                  </Text>
                ) : null}
                {operationNotice ? (
                  <Text aria-live="polite" color="gray.600" fontSize="sm">
                    {operationNotice}
                  </Text>
                ) : null}
              </Stack>
            ) : (
              <Text whiteSpace="pre-wrap">{detail.data.markdown}</Text>
            )}
          </Card.Body>
        </Card.Root>
      ) : (
        <DetailState detail={detail} />
      )}

      <Card.Root>
        <Card.Header>
          <Heading size="sm">Review queue</Heading>
        </Card.Header>
        <Card.Body>
          <Stack gap="3">
            {reviewNotice ? (
              <Text
                aria-live="assertive"
                color={
                  reviewNotice.status === "failure" ? "red.600" : "green.600"
                }
              >
                {reviewNotice.message}
              </Text>
            ) : null}
            <Text color="gray.600" fontSize="sm">
              Note submission and review are explicit pilot operations.
            </Text>
            <HStack gap="2" wrap="wrap">
              <Button disabled={adapter.submitNote === undefined} type="button">
                Submit note
              </Button>
              <Button
                disabled={adapter.reviewNote === undefined}
                type="button"
                variant="outline"
              >
                Approve note
              </Button>
            </HStack>
            {adapter.submitNote === undefined ||
            adapter.reviewNote === undefined ? (
              <Text color="gray.600" fontSize="sm">
                Review unavailable until the Brain pilot backend is connected.
              </Text>
            ) : null}
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
};

const PageState = ({ list }: { readonly list: BrainPageListState }) => {
  if (list.status === "loading")
    return <Text role="status">Loading Brain pages</Text>;
  if (list.status === "skipped")
    return <Text role="status">Select a workspace to load Brain pages.</Text>;
  if (list.status === "empty")
    return (
      <Text role="status">
        No Brain pages yet. Submit a note to start the review queue.
      </Text>
    );
  if (list.status === "failure")
    return <Text role="alert">Unable to load Brain pages. {list.message}</Text>;
  return null;
};

const DetailState = ({ detail }: { readonly detail: BrainPageDetailState }) => {
  if (detail.status === "loading")
    return <Text role="status">Loading Brain page</Text>;
  if (detail.status === "skipped") return null;
  return (
    <Text role="alert">
      Unable to load this Brain page.{" "}
      {detail.status === "failure" ? detail.message : ""}
    </Text>
  );
};

const SearchResults = ({ search }: { readonly search: BrainSearchState }) => {
  if (search.status === "idle") return null;
  if (search.status === "loading")
    return <Text role="status">Searching Brain</Text>;
  if (search.status === "failure")
    return <Text role="alert">Unable to search Brain. {search.message}</Text>;
  if (search.results.length === 0)
    return <Text role="status">No Brain results for {search.query}.</Text>;
  return (
    <Stack aria-label={`Search results for ${search.query}`} gap="2">
      <Heading size="xs">Search results for {search.query}</Heading>
      {search.results.map((result) => (
        <Box
          borderColor="gray.200"
          borderWidth="1px"
          key={result.citationKey}
          p="3"
        >
          <Text fontWeight="semibold">{result.title}</Text>
          <Text>{result.excerpt}</Text>
          <Text color="gray.600" fontSize="sm">
            Citation: {result.citationKey}
          </Text>
        </Box>
      ))}
    </Stack>
  );
};
