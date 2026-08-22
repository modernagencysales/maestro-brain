import {
  useEffect,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react";
import { Card, Stack } from "@saas-ui/react";

import type {
  BrainContextState,
  BrainSearchState,
  BrainSourceState,
  BrainWorkspaceAdapter,
} from "./brain-surface";
import {
  CallMaintenanceReview,
  type CallMaintenanceDecision,
  type CallMaintenanceReviewState,
} from "./call-maintenance-review";
import { ReviewQueue, type BrainReviewQueueState } from "./review-queue";
import type { BrainRestoreState } from "./restore-dialog";
import { CitationList } from "./citation-list";
import type { BrainRevisionHistoryState } from "./revision-history";
import { createBrainWorkspaceActions } from "./brain-workspace-actions";
import {
  BrainPageContent,
  BrainPageHeader,
} from "./brain-workspace-page-editor";
import { BrainPageEvidence } from "./brain-workspace-page-evidence";
import {
  BrainPagesPanel,
  BrainSearchPanel,
  CreateBrainPagePanel,
  brainCitationItems,
} from "./brain-workspace-page-sections";
import { DetailState, PageState } from "./brain-workspace-presenters";
import { BrainNotePanel } from "./brain-workspace-note-section";
import type {
  BrainPageDetailState,
  BrainPageListState,
  BrainReviewNotice,
  BrainWorkspaceActionState,
} from "./brain-workspace-types";

export const BrainWorkspace = ({
  adapter,
  detail,
  list,
  mode: initialMode = "read",
  onSearch,
  reviewNotice,
  search = { status: "idle" },
  context = { status: "idle" },
  source = { status: "idle" },
  history = { status: "loading" },
  reviewQueue = { status: "loading" },
  callMaintenanceReview = { status: "loading" },
  role = "viewer",
  onCallMaintenanceReview,
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
  readonly context?: BrainContextState;
  readonly source?: BrainSourceState;
  readonly history?: BrainRevisionHistoryState;
  readonly reviewQueue?: BrainReviewQueueState;
  readonly callMaintenanceReview?: CallMaintenanceReviewState;
  readonly role?: "viewer" | "editor" | "admin" | "owner";
  readonly onCallMaintenanceReview?: (
    decision: CallMaintenanceDecision,
  ) => void | Promise<void>;
  readonly selectedPageKey?: string | undefined;
  readonly onSelectPage?: ((pageKey: string) => void) | undefined;
}) => {
  const actions = createBrainWorkspaceActions(adapter);
  const [mode, setMode] = useState<"read" | "edit">(
    initialWorkspaceMode(adapter.canEdit, initialMode),
  );
  const [query, setQuery] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteMarkdown, setNoteMarkdown] = useState("");
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [reviewState, setReviewState] =
    useState<BrainWorkspaceActionState | null>(null);
  const [title, setTitle] = useState(initialDetailTitle(detail));
  const [markdown, setMarkdown] = useState(initialDetailMarkdown(detail));
  const [operationNotice, setOperationNotice] = useState<string | null>(null);
  const [restoreRevisionKey, setRestoreRevisionKey] = useState<string | null>(
    null,
  );
  const [restoreState, setRestoreState] = useState<BrainRestoreState>("idle");
  const citationItems = brainCitationItems(search);

  useEffect(() => {
    syncBrainDetail(detail, setTitle, setMarkdown);
  }, [detail]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) =>
    submitBrainSearch(event, query, onSearch);

  return (
    <Stack as="section" aria-label="Brain workspace" gap="4">
      <BrainSearchPanel
        adapter={adapter}
        context={context}
        onQueryChange={setQuery}
        onSubmit={submitSearch}
        query={query}
        search={search}
        source={source}
      />

      <PageState list={list} />
      <BrainPagesPanel
        detail={detail}
        list={list}
        onSelectPage={onSelectPage}
        selectedPageKey={selectedPageKey}
      />
      <CreateBrainPagePanel
        adapter={adapter}
        onNotice={setOperationNotice}
        onTitleChange={setTitle}
        title={title}
      />

      <BrainPageDetailPanel
        actions={actions}
        adapter={adapter}
        citationItems={citationItems}
        detail={detail}
        history={history}
        markdown={markdown}
        mode={mode}
        onMarkdownChange={setMarkdown}
        onModeChange={setMode}
        onNotice={setOperationNotice}
        onRestoreRevisionChange={setRestoreRevisionKey}
        onRestoreStateChange={setRestoreState}
        onTitleChange={setTitle}
        operationNotice={operationNotice}
        restoreRevisionKey={restoreRevisionKey}
        restoreState={restoreState}
        search={search}
        title={title}
      />

      <BrainNotePanel
        actions={actions}
        adapter={adapter}
        markdown={noteMarkdown}
        onMarkdownChange={setNoteMarkdown}
        onReviewStateChange={setReviewState}
        onSourceKeyChange={setSourceKey}
        onTitleChange={setNoteTitle}
        reviewNotice={reviewNotice}
        reviewState={reviewState}
        sourceKey={sourceKey}
        title={noteTitle}
      />
      <ReviewQueue
        nowMs={Date.now()}
        role={role}
        state={reviewQueue}
        onDecision={async (sourceKey, decision) => {
          const result = await actions.reviewNote({ sourceKey, decision });
          setReviewState(result);
        }}
      />
      <CallMaintenanceReview
        role={role}
        state={callMaintenanceReview}
        onReview={(decision) => onCallMaintenanceReview?.(decision)}
      />
    </Stack>
  );
};

const initialWorkspaceMode = (
  canEdit: boolean,
  initialMode: "read" | "edit",
): "read" | "edit" => (canEdit ? initialMode : "read");

const initialDetailTitle = (detail: BrainPageDetailState): string =>
  detail.status === "ready" ? detail.data.page.title : "";

const initialDetailMarkdown = (detail: BrainPageDetailState): string =>
  detail.status === "ready" ? detail.data.markdown : "";

const syncBrainDetail = (
  detail: BrainPageDetailState,
  setTitle: (title: string) => void,
  setMarkdown: (markdown: string) => void,
) => {
  if (detail.status !== "ready") return;
  setTitle(detail.data.page.title);
  setMarkdown(detail.data.markdown);
};

const submitBrainSearch = (
  event: FormEvent<HTMLFormElement>,
  query: string,
  onSearch?: (query: string) => void,
) => {
  event.preventDefault();
  const nextQuery = query.trim();
  if (nextQuery.length > 0) onSearch?.(nextQuery);
};

type BrainWorkspaceActions = ReturnType<typeof createBrainWorkspaceActions>;

const BrainPageDetailPanel = ({
  actions,
  adapter,
  citationItems,
  detail,
  history,
  markdown,
  mode,
  onMarkdownChange,
  onModeChange,
  onNotice,
  onRestoreRevisionChange,
  onRestoreStateChange,
  onTitleChange,
  operationNotice,
  restoreRevisionKey,
  restoreState,
  search,
  title,
}: {
  readonly actions: BrainWorkspaceActions;
  readonly adapter: BrainWorkspaceAdapter;
  readonly citationItems: ComponentProps<typeof CitationList>["citations"];
  readonly detail: BrainPageDetailState;
  readonly history: BrainRevisionHistoryState;
  readonly markdown: string;
  readonly mode: "read" | "edit";
  readonly onMarkdownChange: (markdown: string) => void;
  readonly onModeChange: (mode: "read" | "edit") => void;
  readonly onNotice: (notice: string) => void;
  readonly onRestoreRevisionChange: (revisionKey: string | null) => void;
  readonly onRestoreStateChange: (state: BrainRestoreState) => void;
  readonly onTitleChange: (title: string) => void;
  readonly operationNotice: string | null;
  readonly restoreRevisionKey: string | null;
  readonly restoreState: BrainRestoreState;
  readonly search: BrainSearchState;
  readonly title: string;
}) => {
  if (detail.status !== "ready") return <DetailState detail={detail} />;
  return (
    <Card.Root>
      <BrainPageHeader
        actions={actions}
        adapter={adapter}
        mode={mode}
        onModeChange={onModeChange}
        onNotice={onNotice}
        page={detail.data.page}
      />
      <Card.Body>
        <BrainPageContent
          actions={actions}
          adapter={adapter}
          detail={detail.data}
          markdown={markdown}
          mode={mode}
          onMarkdownChange={onMarkdownChange}
          onNotice={onNotice}
          onTitleChange={onTitleChange}
          operationNotice={operationNotice}
          title={title}
        />
        <BrainPageEvidence
          adapter={adapter}
          detail={detail.data}
          history={history}
          onNotice={onNotice}
          onRestoreRevisionChange={onRestoreRevisionChange}
          onRestoreStateChange={onRestoreStateChange}
          restoreRevisionKey={restoreRevisionKey}
          restoreState={restoreState}
          search={search}
        />
        <CitationList citations={citationItems} />
      </Card.Body>
    </Card.Root>
  );
};
