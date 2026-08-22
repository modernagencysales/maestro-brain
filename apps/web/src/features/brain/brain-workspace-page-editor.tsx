import {
  Button,
  Card,
  Heading,
  HStack,
  Input,
  Stack,
  Text,
} from "@saas-ui/react";

import type {
  BrainPageDetail,
  BrainPageSummary,
  BrainWorkspaceAdapter,
} from "./brain-surface";
import { createBrainWorkspaceActions } from "./brain-workspace-actions";
import type { BrainWorkspaceActionState } from "./brain-workspace-types";

type BrainWorkspaceActions = ReturnType<typeof createBrainWorkspaceActions>;

export const BrainPageHeader = ({
  actions,
  adapter,
  mode,
  onModeChange,
  onNotice,
  page,
}: {
  readonly actions: BrainWorkspaceActions;
  readonly adapter: BrainWorkspaceAdapter;
  readonly mode: "read" | "edit";
  readonly onModeChange: (mode: "read" | "edit") => void;
  readonly onNotice: (notice: string) => void;
  readonly page: BrainPageSummary;
}) => (
  <Card.Header>
    <HStack justify="space-between" wrap="wrap" gap="2">
      <Heading size="sm">
        {mode === "edit" ? `Edit ${page.title}` : page.title}
      </Heading>
      <BrainPageHeaderControls
        actions={actions}
        adapter={adapter}
        mode={mode}
        onModeChange={onModeChange}
        onNotice={onNotice}
        page={page}
      />
    </HStack>
  </Card.Header>
);

const BrainPageHeaderControls = ({
  actions,
  adapter,
  mode,
  onModeChange,
  onNotice,
  page,
}: {
  readonly actions: BrainWorkspaceActions;
  readonly adapter: BrainWorkspaceAdapter;
  readonly mode: "read" | "edit";
  readonly onModeChange: (mode: "read" | "edit") => void;
  readonly onNotice: (notice: string) => void;
  readonly page: BrainPageSummary;
}) => {
  return (
    <HStack gap="2" wrap="wrap">
      <BrainPageModeButton
        adapter={adapter}
        mode={mode}
        onModeChange={onModeChange}
      />
      <ReadPageControls
        actions={actions}
        adapter={adapter}
        mode={mode}
        onNotice={onNotice}
        page={page}
      />
    </HStack>
  );
};

const BrainPageModeButton = ({
  adapter,
  mode,
  onModeChange,
}: {
  readonly adapter: BrainWorkspaceAdapter;
  readonly mode: "read" | "edit";
  readonly onModeChange: (mode: "read" | "edit") => void;
}) => {
  if (!adapter.canEdit) return null;
  const nextMode = { read: "edit", edit: "read" } as const;
  const label = { read: "Edit page", edit: "Cancel edit" } as const;
  return (
    <Button type="button" onClick={() => onModeChange(nextMode[mode])}>
      {label[mode]}
    </Button>
  );
};

const ReadPageControls = ({
  actions,
  adapter,
  mode,
  onNotice,
  page,
}: {
  readonly actions: BrainWorkspaceActions;
  readonly adapter: BrainWorkspaceAdapter;
  readonly mode: "read" | "edit";
  readonly onNotice: (notice: string) => void;
  readonly page: BrainPageSummary;
}) => {
  if (!adapter.canEdit || mode !== "read") return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => moveBrainPage(actions, page, onNotice, false)}
      >
        Move {page.title}
      </Button>
      <Text fontSize="sm">Top level</Text>
    </>
  );
};

export const BrainPageContent = ({
  actions,
  adapter,
  detail,
  markdown,
  mode,
  onMarkdownChange,
  onNotice,
  onTitleChange,
  operationNotice,
  title,
}: {
  readonly actions: BrainWorkspaceActions;
  readonly adapter: BrainWorkspaceAdapter;
  readonly detail: BrainPageDetail;
  readonly markdown: string;
  readonly mode: "read" | "edit";
  readonly onMarkdownChange: (markdown: string) => void;
  readonly onNotice: (notice: string) => void;
  readonly onTitleChange: (title: string) => void;
  readonly operationNotice: string | null;
  readonly title: string;
}) => {
  if (mode === "read")
    return <Text whiteSpace="pre-wrap">{detail.markdown}</Text>;
  return (
    <BrainPageEditor
      actions={actions}
      adapter={adapter}
      markdown={markdown}
      onMarkdownChange={onMarkdownChange}
      onNotice={onNotice}
      onTitleChange={onTitleChange}
      operationNotice={operationNotice}
      page={detail.page}
      title={title}
    />
  );
};

const BrainPageEditor = ({
  actions,
  adapter,
  markdown,
  onMarkdownChange,
  onNotice,
  onTitleChange,
  operationNotice,
  page,
  title,
}: {
  readonly actions: BrainWorkspaceActions;
  readonly adapter: BrainWorkspaceAdapter;
  readonly markdown: string;
  readonly onMarkdownChange: (markdown: string) => void;
  readonly onNotice: (notice: string) => void;
  readonly onTitleChange: (title: string) => void;
  readonly operationNotice: string | null;
  readonly page: BrainPageSummary;
  readonly title: string;
}) => (
  <Stack gap="3">
    <label htmlFor="brain-page-title">Page title</label>
    <Input
      id="brain-page-title"
      onChange={(event) => onTitleChange(event.target.value)}
      value={title}
    />
    <Button
      type="button"
      onClick={() => renameBrainPage(adapter, page, title, onNotice)}
    >
      Rename page
    </Button>
    <HStack gap="2" wrap="wrap">
      <Button
        disabled={adapter.movePage === undefined}
        type="button"
        variant="outline"
        onClick={() => moveBrainPage(actions, page, onNotice, true)}
      >
        Move {page.title}
      </Button>
      <Text fontSize="sm">Top level</Text>
    </HStack>
    <HStack gap="2" wrap="wrap">
      <Button
        disabled={adapter.favoritePage === undefined}
        type="button"
        variant="outline"
        onClick={() => favoriteBrainPage(adapter, page, onNotice)}
      >
        {page.favorite ? "Remove favorite" : "Add favorite"}
      </Button>
      <Button
        disabled={adapter.archivePage === undefined}
        type="button"
        variant="outline"
        onClick={() => archiveBrainPage(adapter, page, onNotice)}
      >
        Archive page
      </Button>
    </HStack>
    <label htmlFor="brain-page-markdown">Page markdown</label>
    <textarea
      aria-label="Page markdown"
      id="brain-page-markdown"
      onChange={(event) => onMarkdownChange(event.target.value)}
      rows={12}
      value={markdown}
    />
    <Button
      disabled={adapter.updatePage === undefined}
      type="button"
      onClick={() => saveBrainPage(actions, page, markdown, onNotice)}
    >
      Save page
    </Button>
    {operationNotice ? (
      <Text aria-live="polite" color="gray.600" fontSize="sm">
        {operationNotice}
      </Text>
    ) : null}
  </Stack>
);

const renameBrainPage = async (
  adapter: BrainWorkspaceAdapter,
  page: BrainPageSummary,
  title: string,
  onNotice: (notice: string) => void,
) =>
  runRevisionMutation({
    failureMessage: "Unable to rename page. Try again.",
    missingRevisionMessage:
      "Unable to rename a page without a current revision.",
    onNotice,
    operation: (revisionKey) =>
      adapter.renamePage({
        brainKey: adapter.brainKey,
        pageKey: page.pageKey,
        expectedCurrentRevisionKey: revisionKey,
        title: title.trim() || "Untitled page",
      }),
    page,
    successMessage: "Page renamed.",
  });

const favoriteBrainPage = async (
  adapter: BrainWorkspaceAdapter,
  page: BrainPageSummary,
  onNotice: (notice: string) => void,
) => {
  const favoritePage = adapter.favoritePage;
  return runRevisionMutation({
    failureMessage: "Unable to update favorite. Try again.",
    onNotice,
    operation:
      favoritePage === undefined
        ? undefined
        : (revisionKey) =>
            favoritePage({
              brainKey: adapter.brainKey,
              pageKey: page.pageKey,
              expectedCurrentRevisionKey: revisionKey,
              favorite: !page.favorite,
            }),
    page,
    successMessage: page.favorite ? "Favorite removed." : "Favorite added.",
  });
};

const archiveBrainPage = async (
  adapter: BrainWorkspaceAdapter,
  page: BrainPageSummary,
  onNotice: (notice: string) => void,
) => {
  const archivePage = adapter.archivePage;
  return runRevisionMutation({
    failureMessage: "Unable to archive page. Try again.",
    onNotice,
    operation:
      archivePage === undefined
        ? undefined
        : (revisionKey) =>
            archivePage({
              brainKey: adapter.brainKey,
              pageKey: page.pageKey,
              expectedCurrentRevisionKey: revisionKey,
            }),
    page,
    successMessage: "Page archived.",
  });
};

const runRevisionMutation = async ({
  failureMessage,
  missingRevisionMessage,
  onNotice,
  operation,
  page,
  successMessage,
}: {
  readonly failureMessage: string;
  readonly missingRevisionMessage?: string;
  readonly onNotice: (notice: string) => void;
  readonly operation?: (revisionKey: string) => Promise<unknown>;
  readonly page: BrainPageSummary;
  readonly successMessage: string;
}) => {
  const revisionKey = page.currentRevisionKey;
  if (revisionKey === null) {
    if (missingRevisionMessage !== undefined) onNotice(missingRevisionMessage);
    return;
  }
  if (operation === undefined) return;
  try {
    await operation(revisionKey);
    onNotice(successMessage);
  } catch {
    onNotice(failureMessage);
  }
};

const moveBrainPage = async (
  actions: BrainWorkspaceActions,
  page: BrainPageSummary,
  onNotice: (notice: string) => void,
  detailed: boolean,
) => {
  const revisionKey = page.currentRevisionKey;
  if (revisionKey === null) return;
  const result = await actions.movePage({
    pageKey: page.pageKey,
    expectedCurrentRevisionKey: revisionKey,
    parentPageKey: null,
    sortKey: page.sortKey,
  });
  onNotice(
    workspaceActionMessage(
      result,
      detailed ? moveNotices : {},
      "Page move failed.",
    ),
  );
};

const saveBrainPage = async (
  actions: BrainWorkspaceActions,
  page: BrainPageSummary,
  markdown: string,
  onNotice: (notice: string) => void,
) => {
  const revisionKey = page.currentRevisionKey;
  if (revisionKey === null) {
    onNotice("Unable to save a page without a current revision.");
    return;
  }
  const result = await actions.savePage({
    pageKey: page.pageKey,
    expectedCurrentRevisionKey: revisionKey,
    markdown,
  });
  onNotice(workspaceActionMessage(result, saveNotices, "Page save failed."));
};

const moveNotices = {
  moved: "Page moved to the top level.",
  stale_conflict: "A newer revision exists. Reload before moving this page.",
  lifecycle_conflict:
    "This page changed lifecycle state and can no longer be moved.",
} as const;

const saveNotices = {
  saved: "Page saved.",
  stale_conflict: "A newer revision exists. Reload before saving your changes.",
  lifecycle_conflict:
    "This page changed lifecycle state and can no longer be saved.",
} as const;

const workspaceActionMessage = (
  result: BrainWorkspaceActionState,
  messages: Readonly<
    Partial<Record<BrainWorkspaceActionState["status"], string>>
  >,
  fallback: string,
): string => {
  const message = messages[result.status];
  if (message !== undefined) return message;
  return "message" in result ? result.message : fallback;
};
