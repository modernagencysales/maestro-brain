import { useEffect, useState, type FormEvent } from "react";
import {
  useTemplateMutation,
  useTemplateQuery,
} from "../../adapters/confect-state";
import type { TemplateDataState } from "../../adapters/confect-state";
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
import {
  BlockNoteSyncEditor,
  type BlockNoteSyncEditorProps,
} from "@maestro-template/editor-react/client";
import { api } from "@maestro-template/convex";
import { templateConfectRefs } from "@maestro-template/convex/refs";
import type {
  BrainPageDetail,
  BrainPageListData,
  BrainPageSummary,
  BrainPilotSearchData,
  BrainReviewQueueData,
  BrainRevisionHistoryData,
  BrainSearchResult,
  BrainWorkspaceAdapter,
} from "./brain-surface";
import { ReviewQueue, type BrainReviewQueueState } from "./review-queue";
import { RestoreDialog, type BrainRestoreState } from "./restore-dialog";
import { CitationList, type BrainCitation } from "./citation-list";
import { RevisionDiff } from "./revision-diff";
import {
  RevisionHistory,
  type BrainRevisionHistoryState,
} from "./revision-history";
import {
  brainPilotRefs,
  brainWorkspaceRefs,
  createBrainWorkspaceAdapter,
  unwrapBrainMutation,
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

export type BrainWorkspaceActionState =
  | {
      readonly status: "pending_review" | "published" | "rejected";
      readonly sourceKey: string;
    }
  | { readonly status: "saved" | "moved" }
  | { readonly status: "stale_conflict" | "lifecycle_conflict" }
  | { readonly status: "unavailable" | "failure"; readonly message: string };

export const createBrainWorkspaceActions = (
  adapter: BrainWorkspaceAdapter,
) => ({
  submitNote: async (input: {
    readonly title: string;
    readonly markdown: string;
  }): Promise<BrainWorkspaceActionState> => {
    if (adapter.submitNote === undefined) {
      return {
        status: "unavailable",
        message: "Note submission is unavailable.",
      };
    }
    try {
      const result = await adapter.submitNote(input);
      return result.status === "pending_review"
        ? result
        : { status: "failure", message: "The note was not queued for review." };
    } catch (error) {
      return { status: "failure", message: failureMessage(error) };
    }
  },
  reviewNote: async (input: {
    readonly sourceKey: string;
    readonly decision: "approve" | "reject";
  }): Promise<BrainWorkspaceActionState> => {
    if (adapter.reviewNote === undefined) {
      return { status: "unavailable", message: "Note review is unavailable." };
    }
    try {
      const result = await adapter.reviewNote(input);
      return result.status === "published" || result.status === "rejected"
        ? result
        : { status: "failure", message: "The review decision was not saved." };
    } catch (error) {
      return { status: "failure", message: failureMessage(error) };
    }
  },
  savePage: async (input: {
    readonly pageKey: string;
    readonly expectedCurrentRevisionKey: string;
    readonly markdown: string;
  }): Promise<BrainWorkspaceActionState> => {
    if (adapter.updatePage === undefined) {
      return { status: "unavailable", message: "Page saving is unavailable." };
    }
    try {
      await adapter.updatePage(input);
      return { status: "saved" };
    } catch (error) {
      if (hasErrorTag(error, "StaleRevision"))
        return { status: "stale_conflict" };
      if (hasErrorTag(error, "LifecycleRevoked"))
        return { status: "lifecycle_conflict" };
      return { status: "failure", message: failureMessage(error) };
    }
  },
  movePage: async (input: {
    readonly pageKey: string;
    readonly expectedCurrentRevisionKey: string;
    readonly parentPageKey: string | null;
    readonly sortKey: string;
  }): Promise<BrainWorkspaceActionState> => {
    if (adapter.movePage === undefined) {
      return { status: "unavailable", message: "Page moving is unavailable." };
    }
    try {
      await adapter.movePage(input);
      return { status: "moved" };
    } catch (error) {
      if (hasErrorTag(error, "StaleRevision"))
        return { status: "stale_conflict" };
      if (hasErrorTag(error, "LifecycleRevoked"))
        return { status: "lifecycle_conflict" };
      return { status: "failure", message: failureMessage(error) };
    }
  },
  search: async (query: string): Promise<readonly BrainSearchResult[]> => {
    if (adapter.search === undefined) {
      throw new Error("Search is unavailable");
    }
    return adapter.search(query);
  },
});

const failureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "The Brain operation failed.";

const toRevisionHistoryState = (
  state: TemplateDataState<BrainRevisionHistoryData, unknown>,
): BrainRevisionHistoryState => {
  if (state.status === "ready") return { status: "ready", data: state.data };
  if (state.status === "loading" || state.status === "skipped")
    return { status: "loading" };
  return { status: "failure", message: "Unable to load revision history." };
};

const hasErrorTag = (error: unknown, tag: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === tag;

export const BrainWorkspaceRoute = () => {
  const workspace = useWorkspace();
  const [search, setSearch] = useState<BrainSearchState>({ status: "idle" });
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [selectedPageKey, setSelectedPageKey] = useState<string | null>(null);
  const brainKey =
    workspace.status === "ready" ? workspace.activeWorkspace.workspaceId : null;
  const list = useTemplateQuery(
    brainWorkspaceRefs.list,
    brainKey === null ? "skip" : { brainKey },
    { isEmpty: (data: BrainPageListData) => data.pages.length === 0 },
  ) as TemplateDataState<BrainPageListData, unknown>;
  const selected =
    list.status === "ready"
      ? list.data.pages.some((page) => page.pageKey === selectedPageKey)
        ? selectedPageKey
        : list.data.pages[0]?.pageKey
      : null;
  const detail = useTemplateQuery(
    brainWorkspaceRefs.get,
    brainKey === null || selected === undefined || selected === null
      ? "skip"
      : { brainKey, pageKey: selected },
  ) as TemplateDataState<BrainPageDetail, unknown>;
  const history = useTemplateQuery(
    brainWorkspaceRefs.history,
    brainKey === null || selected === undefined || selected === null
      ? "skip"
      : { brainKey, pageKey: selected, limit: 50 },
  ) as TemplateDataState<BrainRevisionHistoryData, unknown>;
  const create = useTemplateMutation(brainWorkspaceRefs.create);
  const rename = useTemplateMutation(brainWorkspaceRefs.rename);
  const favorite = useTemplateMutation(brainWorkspaceRefs.favorite);
  const archive = useTemplateMutation(brainWorkspaceRefs.archive);
  const move = useTemplateMutation(brainWorkspaceRefs.move);
  const restore = useTemplateMutation(brainWorkspaceRefs.restore);
  const submitNote = useTemplateMutation(brainPilotRefs.submitNote);
  const reviewNote = useTemplateMutation(brainPilotRefs.reviewNote);
  const updatePage = useTemplateMutation(brainPilotRefs.updatePage);
  const pilotSearch = useTemplateQuery(
    brainPilotRefs.search,
    brainKey === null || searchQuery === null
      ? "skip"
      : { brainKey, query: searchQuery },
  ) as TemplateDataState<BrainPilotSearchData, unknown>;
  const queue = useTemplateQuery(
    brainPilotRefs.listReviewQueue,
    brainKey === null ? "skip" : { brainKey },
  ) as TemplateDataState<BrainReviewQueueData, unknown>;

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
  const reviewQueue: BrainReviewQueueState =
    queue.status === "ready"
      ? { status: "ready", items: queue.data.items }
      : queue.status === "loading" || queue.status === "skipped"
        ? { status: "loading" }
        : {
            status: "failure",
            message: "Unable to load the Brain review queue.",
          };
  const adapter = createBrainWorkspaceAdapter({
    brainKey: workspace.activeWorkspace.workspaceId,
    canEdit: workspace.activeWorkspace.role !== "viewer",
    mutations: { create, rename, favorite, archive, move },
    pilot: {
      submitNote: async (input) =>
        unwrapBrainMutation(
          await submitNote({
            brainKey: workspace.activeWorkspace.workspaceId,
            ...input,
          }),
        ),
      reviewNote: async (input) =>
        unwrapBrainMutation(
          await reviewNote({
            brainKey: workspace.activeWorkspace.workspaceId,
            ...input,
          }),
        ),
    },
    movePage: async ({
      pageKey,
      expectedCurrentRevisionKey,
      parentPageKey,
      sortKey,
    }) =>
      unwrapBrainMutation(
        await move({
          brainKey: workspace.activeWorkspace.workspaceId,
          pageKey,
          expectedCurrentRevisionKey,
          parentPageKey,
          sortKey,
        }),
      ),
    restorePage: async (input) => unwrapBrainMutation(await restore(input)),
    updatePage:
      detail.status === "ready"
        ? async ({ pageKey, expectedCurrentRevisionKey, markdown }) =>
            unwrapBrainMutation(
              await updatePage({
                brainKey: workspace.activeWorkspace.workspaceId,
                pageKey,
                expectedCurrentRevisionKey,
                markdown,
              }),
            )
        : undefined,
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
            selectedPageKey={selected ?? undefined}
            onSelectPage={setSelectedPageKey}
            history={toRevisionHistoryState(history)}
            editorApi={api.editorSync}
            reviewQueue={reviewQueue}
            role={workspace.activeWorkspace.role}
            onSearch={(query) => {
              setSearchQuery(query);
              setSearch({ status: "loading", query });
            }}
            search={
              searchQuery === null
                ? search
                : pilotSearch.status === "ready"
                  ? {
                      status: "ready",
                      query: searchQuery,
                      results: (pilotSearch.data as BrainPilotSearchData)
                        .results,
                    }
                  : pilotSearch.status === "loading"
                    ? { status: "loading", query: searchQuery }
                    : {
                        status: "failure",
                        query: searchQuery,
                        message: "Unable to search Brain. Try again.",
                      }
            }
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
  history = { status: "loading" },
  editorApi,
  reviewQueue = { status: "loading" },
  role = "viewer",
  selectedPageKey,
  onSelectPage,
}: {
  readonly adapter: BrainWorkspaceAdapter;
  readonly detail: BrainPageDetailState;
  readonly list: BrainPageListState;
  readonly mode?: "read" | "edit";
  readonly onSearch?: (query: string) => void;
  readonly reviewNotice?: BrainReviewNotice;
  readonly search?: BrainSearchState;
  readonly history?: BrainRevisionHistoryState;
  readonly editorApi?: BlockNoteSyncEditorProps["api"];
  readonly reviewQueue?: BrainReviewQueueState;
  readonly role?: "viewer" | "editor" | "admin" | "owner";
  readonly selectedPageKey?: string | undefined;
  readonly onSelectPage?: ((pageKey: string) => void) | undefined;
}) => {
  const actions = createBrainWorkspaceActions(adapter);
  const [mode, setMode] = useState<"read" | "edit">(
    adapter.canEdit ? initialMode : "read",
  );
  const [query, setQuery] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteMarkdown, setNoteMarkdown] = useState("");
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [reviewState, setReviewState] =
    useState<BrainWorkspaceActionState | null>(null);
  const [title, setTitle] = useState(
    detail.status === "ready" ? detail.data.page.title : "",
  );
  const [markdown, setMarkdown] = useState(
    detail.status === "ready" ? detail.data.markdown : "",
  );
  const [operationNotice, setOperationNotice] = useState<string | null>(null);
  const [restoreRevisionKey, setRestoreRevisionKey] = useState<string | null>(
    null,
  );
  const [restoreState, setRestoreState] = useState<BrainRestoreState>("idle");
  const citationItems: readonly BrainCitation[] =
    search.status === "ready"
      ? search.results.map((result) => ({
          citationKey: result.citationKey,
          sourceRevisionKey: result.sourceRevisionKey ?? "unresolved",
          locator: result.locator ?? "unresolved",
          freshness: result.freshness ?? "stale",
          state: result.state ?? "legacy_unresolved",
          quotedText: result.excerpt,
          ...(result.permalink === undefined
            ? {}
            : { permalink: result.permalink }),
        }))
      : [];

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
            <PageTree
              pages={list.data.pages}
              selectedPageKey={selectedPageKey ?? detailPageKey(detail)}
              onSelectPage={onSelectPage}
            />
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
                      title
                        .trim()
                        .toLowerCase()
                        .replace(/[^a-z0-9-]+/g, "-")
                        .replace(/^-+|-+$/g, "") || "new-page",
                    sortKey: String(Date.now()).slice(-10),
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
              <HStack gap="2" wrap="wrap">
                {adapter.canEdit ? (
                  <Button
                    type="button"
                    onClick={() => setMode(mode === "read" ? "edit" : "read")}
                  >
                    {mode === "read" ? "Edit page" : "Cancel edit"}
                  </Button>
                ) : null}
                {adapter.canEdit && mode === "read" ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      const revisionKey = detail.data.page.currentRevisionKey;
                      if (revisionKey === null) return;
                      const result = await actions.movePage({
                        pageKey: detail.data.page.pageKey,
                        expectedCurrentRevisionKey: revisionKey,
                        parentPageKey: null,
                        sortKey: detail.data.page.sortKey,
                      });
                      setOperationNotice(
                        result.status === "moved"
                          ? "Page moved to the top level."
                          : "message" in result
                            ? result.message
                            : "Page move failed.",
                      );
                    }}
                  >
                    Move {detail.data.page.title}
                  </Button>
                ) : null}
                {adapter.canEdit && mode === "read" ? (
                  <Text fontSize="sm">Top level</Text>
                ) : null}
              </HStack>
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
                <HStack gap="2" wrap="wrap">
                  <Button
                    disabled={adapter.movePage === undefined}
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      const revisionKey = detail.data.page.currentRevisionKey;
                      if (revisionKey === null) return;
                      const result = await actions.movePage({
                        pageKey: detail.data.page.pageKey,
                        expectedCurrentRevisionKey: revisionKey,
                        parentPageKey: null,
                        sortKey: detail.data.page.sortKey,
                      });
                      setOperationNotice(
                        result.status === "moved"
                          ? "Page moved to the top level."
                          : result.status === "stale_conflict"
                            ? "A newer revision exists. Reload before moving this page."
                            : result.status === "lifecycle_conflict"
                              ? "This page changed lifecycle state and can no longer be moved."
                              : "message" in result
                                ? result.message
                                : "Page move failed.",
                      );
                    }}
                  >
                    Move {detail.data.page.title}
                  </Button>
                  <Text fontSize="sm">Top level</Text>
                </HStack>
                <HStack gap="2" wrap="wrap">
                  <Button
                    disabled={adapter.favoritePage === undefined}
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      const revisionKey = detail.data.page.currentRevisionKey;
                      if (
                        revisionKey === null ||
                        adapter.favoritePage === undefined
                      )
                        return;
                      try {
                        await adapter.favoritePage({
                          brainKey: adapter.brainKey,
                          pageKey: detail.data.page.pageKey,
                          expectedCurrentRevisionKey: revisionKey,
                          favorite: !detail.data.page.favorite,
                        });
                        setOperationNotice(
                          detail.data.page.favorite
                            ? "Favorite removed."
                            : "Favorite added.",
                        );
                      } catch {
                        setOperationNotice(
                          "Unable to update favorite. Try again.",
                        );
                      }
                    }}
                  >
                    {detail.data.page.favorite
                      ? "Remove favorite"
                      : "Add favorite"}
                  </Button>
                  <Button
                    disabled={adapter.archivePage === undefined}
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      const revisionKey = detail.data.page.currentRevisionKey;
                      if (
                        revisionKey === null ||
                        adapter.archivePage === undefined
                      )
                        return;
                      try {
                        await adapter.archivePage({
                          brainKey: adapter.brainKey,
                          pageKey: detail.data.page.pageKey,
                          expectedCurrentRevisionKey: revisionKey,
                        });
                        setOperationNotice("Page archived.");
                      } catch {
                        setOperationNotice(
                          "Unable to archive page. Try again.",
                        );
                      }
                    }}
                  >
                    Archive page
                  </Button>
                </HStack>
                <label htmlFor="brain-page-markdown">Page markdown</label>
                {editorApi ? (
                  <>
                    <Text fontSize="sm">Live BlockNote document</Text>
                    <BlockNoteSyncEditor
                      api={editorApi}
                      documentId={`brainPage:${adapter.brainKey}:${detail.data.page.pageKey}:${detail.data.page.currentRevisionKey ?? "missing"}`}
                      editable
                      snapshotDebounceMs={500}
                    />
                  </>
                ) : null}
                <textarea
                  aria-label="Page markdown"
                  id="brain-page-markdown"
                  onChange={(event) => setMarkdown(event.target.value)}
                  rows={12}
                  value={markdown}
                />
                <Button
                  disabled={adapter.updatePage === undefined}
                  type="button"
                  onClick={async () => {
                    if (detail.status !== "ready") return;
                    const revisionKey = detail.data.page.currentRevisionKey;
                    if (revisionKey === null) {
                      setOperationNotice(
                        "Unable to save a page without a current revision.",
                      );
                      return;
                    }
                    const result = await actions.savePage({
                      pageKey: detail.data.page.pageKey,
                      expectedCurrentRevisionKey: revisionKey,
                      markdown,
                    });
                    setOperationNotice(
                      result.status === "saved"
                        ? "Page saved."
                        : result.status === "stale_conflict"
                          ? "A newer revision exists. Reload before saving your changes."
                          : result.status === "lifecycle_conflict"
                            ? "This page changed lifecycle state and can no longer be saved."
                            : "message" in result
                              ? result.message
                              : "Page save failed.",
                    );
                  }}
                >
                  Save page
                </Button>
                {operationNotice ? (
                  <Text aria-live="polite" color="gray.600" fontSize="sm">
                    {operationNotice}
                  </Text>
                ) : null}
              </Stack>
            ) : (
              <Text whiteSpace="pre-wrap">{detail.data.markdown}</Text>
            )}
            <Box borderTopWidth="1px" mt="4" pt="3">
              <Heading size="xs">Revision and evidence</Heading>
              <Text fontSize="sm">
                Revision: {detail.data.page.currentRevisionKey ?? "No revision"}
              </Text>
              <Text fontSize="sm">
                Updated: {new Date(detail.data.updatedAt).toLocaleString()}
              </Text>
              <Text fontSize="sm">
                Lifecycle generation: {detail.data.page.lifecycleGeneration}
              </Text>
              <Text fontSize="sm">
                Evidence:{" "}
                {search.status === "ready"
                  ? `${search.results.length} cited result${search.results.length === 1 ? "" : "s"}`
                  : "Search for cited evidence"}
              </Text>
            </Box>
            <RevisionHistory
              canRestore={adapter.canEdit && adapter.restorePage !== undefined}
              history={history}
              onRestore={(revisionKey) => {
                setRestoreRevisionKey(revisionKey);
                setRestoreState("idle");
              }}
            />
            {restoreRevisionKey !== null ? (
              <RestoreDialog
                canRestore={
                  adapter.canEdit && adapter.restorePage !== undefined
                }
                open
                revisionKey={restoreRevisionKey}
                state={restoreState}
                onCancel={() => setRestoreRevisionKey(null)}
                onConfirm={async () => {
                  if (
                    adapter.restorePage === undefined ||
                    detail.status !== "ready" ||
                    detail.data.page.currentRevisionKey === null
                  )
                    return;
                  setRestoreState("restoring");
                  try {
                    await adapter.restorePage({
                      brainKey: adapter.brainKey,
                      pageKey: detail.data.page.pageKey,
                      expectedCurrentRevisionKey:
                        detail.data.page.currentRevisionKey,
                      revisionKey: restoreRevisionKey,
                    });
                    setRestoreState("success");
                    setOperationNotice("Revision restored as a new revision.");
                  } catch {
                    setRestoreState("failure");
                  }
                }}
              />
            ) : null}
            {history.status === "ready" &&
            history.data.revisions.length >= 2 &&
            history.data.revisions[0]?.markdown !== undefined &&
            history.data.revisions[1]?.markdown !== undefined ? (
              <RevisionDiff
                diff={{
                  beforeRevisionKey: history.data.revisions[1].revisionKey,
                  afterRevisionKey: history.data.revisions[0].revisionKey,
                  before: history.data.revisions[1].markdown,
                  after: history.data.revisions[0].markdown,
                }}
              />
            ) : null}
            <CitationList citations={citationItems} />
          </Card.Body>
        </Card.Root>
      ) : (
        <DetailState detail={detail} />
      )}

      <Card.Root>
        <Card.Header>
          <Heading size="sm">Submit a note</Heading>
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
            <form
              aria-label="Submit note"
              onSubmit={async (event) => {
                event.preventDefault();
                const result = await actions.submitNote({
                  title: noteTitle.trim(),
                  markdown: noteMarkdown,
                });
                setReviewState(result);
                if (result.status === "pending_review") {
                  setSourceKey(result.sourceKey);
                }
              }}
            >
              <Stack gap="2">
                <label htmlFor="brain-note-title">Note title</label>
                <Input
                  id="brain-note-title"
                  onChange={(event) => setNoteTitle(event.target.value)}
                  value={noteTitle}
                />
                <label htmlFor="brain-note-markdown">Note markdown</label>
                <textarea
                  id="brain-note-markdown"
                  onChange={(event) => setNoteMarkdown(event.target.value)}
                  rows={6}
                  value={noteMarkdown}
                />
                <Button
                  disabled={adapter.submitNote === undefined}
                  type="submit"
                >
                  Submit note
                </Button>
              </Stack>
            </form>
            {sourceKey !== null && reviewState?.status === "pending_review" ? (
              <HStack gap="2" wrap="wrap">
                <Button
                  disabled={adapter.reviewNote === undefined}
                  type="button"
                  onClick={async () => {
                    const result = await actions.reviewNote({
                      sourceKey,
                      decision: "approve",
                    });
                    setReviewState(result);
                  }}
                >
                  Approve note
                </Button>
                <Button
                  disabled={adapter.reviewNote === undefined}
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const result = await actions.reviewNote({
                      sourceKey,
                      decision: "reject",
                    });
                    setReviewState(result);
                  }}
                >
                  Reject note
                </Button>
              </HStack>
            ) : null}
            {reviewState?.status === "pending_review" ? (
              <Text role="status">Note pending review.</Text>
            ) : null}
            {reviewState?.status === "published" ? (
              <Text role="status">Note approved and published.</Text>
            ) : null}
            {reviewState?.status === "rejected" ? (
              <Text role="status">Note rejected.</Text>
            ) : null}
            {reviewState?.status === "failure" ||
            reviewState?.status === "unavailable" ? (
              <Text role="alert">
                {"message" in reviewState
                  ? reviewState.message
                  : "Brain review failed."}
              </Text>
            ) : null}
            {adapter.submitNote === undefined ||
            adapter.reviewNote === undefined ? (
              <Text color="gray.600" fontSize="sm">
                Review unavailable until the Brain pilot backend is connected.
              </Text>
            ) : null}
          </Stack>
        </Card.Body>
      </Card.Root>
      <ReviewQueue
        nowMs={Date.now()}
        role={role}
        state={reviewQueue}
        onDecision={async (sourceKey, decision) => {
          const result = await actions.reviewNote({ sourceKey, decision });
          setReviewState(result);
        }}
      />
    </Stack>
  );
};

const detailPageKey = (detail: BrainPageDetailState): string | undefined =>
  detail.status === "ready" ? detail.data.page.pageKey : undefined;

const PageTree = ({
  pages,
  selectedPageKey,
  onSelectPage,
}: {
  readonly pages: readonly BrainPageSummary[];
  readonly selectedPageKey?: string | undefined;
  readonly onSelectPage?: ((pageKey: string) => void) | undefined;
}) => {
  const renderLevel = (parentPageKey: string | null) => {
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
          <Box as="li" key={page.pageKey}>
            <Button
              aria-current={
                page.pageKey === selectedPageKey ? "page" : undefined
              }
              justifyContent="space-between"
              type="button"
              variant="ghost"
              width="full"
              onClick={() => onSelectPage?.(page.pageKey)}
            >
              <span>{page.title}</span>
              <span>{page.favorite ? "★" : page.status}</span>
            </Button>
            {renderLevel(page.pageKey)}
          </Box>
        ))}
      </Box>
    );
  };

  return <nav aria-label="Brain pages">{renderLevel(null)}</nav>;
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
