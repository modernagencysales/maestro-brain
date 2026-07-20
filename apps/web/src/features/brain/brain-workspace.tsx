import {
  Badge,
  Button,
  Card,
  Heading,
  Page,
  SimpleGrid,
  Stack,
  Text,
} from "@saas-ui/react";
import { TemplateDialog } from "@maestro-template/ui";
import { useRef, useState } from "react";
import { BrainEditorPane, type BrainEditorSnapshot } from "./brain-editor-pane";
import { BrainEvidenceDrawer } from "./brain-evidence-drawer";
import { BrainPageTree } from "./brain-page-tree";
import {
  describeBrainWorkspaceState,
  type BrainWorkspaceState,
} from "./brain-surface";
import type { Ref } from "@confect/core";
import type { BlockNoteSyncEditorProps } from "@maestro-template/editor-react/client";
import type { TemplateConfectRefs } from "@maestro-template/convex/refs";
import type { TemplateMutationState } from "../../adapters/confect-state";

type EditorSyncRefs = BlockNoteSyncEditorProps["api"];

export type BrainMarkdownSaveArgs = Ref.Args<
  TemplateConfectRefs["public"]["brain"]["pages"]["recordSnapshot"]
>;

export function buildWorkspaceSaveArgs(
  state: BrainWorkspaceState,
  snapshot: string,
  version?: number,
  expectedCurrentRevisionKey?: string,
): BrainMarkdownSaveArgs | null {
  if (
    state.status !== "ready" ||
    !state.canEdit ||
    state.selectedPage === null
  ) {
    return null;
  }

  const { selectedPage } = state;
  if (selectedPage.currentRevisionKey === null) return null;
  if (selectedPage.editorTarget === null) return null;

  return {
    documentId: selectedPage.editorTarget.documentId,
    expectedCurrentRevisionKey:
      expectedCurrentRevisionKey ?? selectedPage.currentRevisionKey,
    snapshot,
    version: version ?? selectedPage.editorTarget.snapshotVersion + 1,
  };
}

export function readWorkspaceEditorRevisionFence(
  current: {
    readonly documentId: string | null;
    readonly revisionKey: string | null;
  },
  selected: {
    readonly documentId: string | null;
    readonly revisionKey: string | null;
  },
  saved: {
    readonly documentId: string | null;
    readonly revisionKey: string | null;
  } = { documentId: null, revisionKey: null },
): string | null {
  if (selected.documentId === null || selected.revisionKey === null) {
    return null;
  }
  if (saved.documentId === selected.documentId && saved.revisionKey !== null) {
    return saved.revisionKey;
  }
  if (
    current.documentId === selected.documentId &&
    current.revisionKey !== null
  ) {
    return current.revisionKey;
  }
  return selected.revisionKey;
}

export function reduceWorkspaceEditorRevisionFenceAfterSave(
  result: TemplateMutationState<unknown, { readonly _tag?: string }>,
  currentRevisionKey: string | null,
): string | null {
  if (result.status !== "ready") return currentRevisionKey;
  const data = result.data as { readonly pageRevisionKey?: unknown };
  return typeof data.pageRevisionKey === "string"
    ? data.pageRevisionKey
    : currentRevisionKey;
}

export function reduceSaveConflict(
  result: TemplateMutationState<unknown, { readonly _tag?: string }>,
): "stale_revision" | undefined {
  return result.status === "typed_failure" &&
    (result.error._tag === "StaleRevision" ||
      result.error._tag === "LifecycleRevoked")
    ? "stale_revision"
    : undefined;
}

export type MobileBrainDrawer = "tree" | "evidence";
export type MobileBrainDrawerAction = "open_tree" | "open_evidence" | "close";

export function reduceMobileDrawerState(
  current: MobileBrainDrawer | null,
  action: MobileBrainDrawerAction,
): MobileBrainDrawer | null {
  switch (action) {
    case "open_tree":
      return "tree";
    case "open_evidence":
      return "evidence";
    case "close":
      return null;
    default:
      return current;
  }
}

export function BrainWorkspace({
  state,
  onArchivePage,
  onCreatePage,
  onFavoritePage,
  onMovePage,
  onRenamePage,
  onSaveMarkdown,
  onSelectPage,
  syncApi,
}: {
  readonly state: BrainWorkspaceState;
  readonly onArchivePage: (pageKey: string, revisionKey: string | null) => void;
  readonly onCreatePage: () => void;
  readonly onFavoritePage: (
    pageKey: string,
    favorite: boolean,
    revisionKey: string | null,
  ) => void;
  readonly onMovePage: (
    pageKey: string,
    parentPageKey: string | null,
    revisionKey: string | null,
  ) => void;
  readonly onRenamePage: (
    pageKey: string,
    title: string,
    revisionKey: string | null,
  ) => void;
  readonly onSaveMarkdown: (
    args: BrainMarkdownSaveArgs | null,
  ) => Promise<TemplateMutationState<unknown, { readonly _tag?: string }>>;
  readonly onSelectPage: (pageKey: string) => void;
  readonly syncApi: EditorSyncRefs;
}) {
  const [saveConflict, setSaveConflict] = useState<
    "stale_revision" | undefined
  >();
  const [mobileDrawer, setMobileDrawer] = useState<MobileBrainDrawer | null>(
    null,
  );
  const [savedEditorFence, setSavedEditorFence] = useState<{
    readonly documentId: string | null;
    readonly revisionKey: string | null;
  }>({ documentId: null, revisionKey: null });
  const editorFenceRef = useRef<{
    documentId: string | null;
    revisionKey: string | null;
  }>({ documentId: null, revisionKey: null });
  const selectedEditorTarget =
    state.status === "ready" ? state.selectedPage?.editorTarget : null;
  const editorRevisionFence = readWorkspaceEditorRevisionFence(
    editorFenceRef.current,
    {
      documentId: selectedEditorTarget?.documentId ?? null,
      revisionKey: selectedEditorTarget?.revisionKey ?? null,
    },
    savedEditorFence,
  );
  editorFenceRef.current = {
    documentId: selectedEditorTarget?.documentId ?? null,
    revisionKey: editorRevisionFence,
  };
  const pageTree =
    state.status === "ready" ? (
      <BrainPageTree
        canEdit={state.canEdit}
        pages={state.pages}
        onArchivePage={onArchivePage}
        onCreatePage={onCreatePage}
        onFavoritePage={onFavoritePage}
        onMovePage={onMovePage}
        onRenamePage={onRenamePage}
        onSelectPage={onSelectPage}
      />
    ) : null;
  const evidenceDrawer =
    state.status === "ready" ? (
      <BrainEvidenceDrawer
        citations={state.pages.map((page) => page.title)}
        freshness={state.freshness}
        revisionLabel={state.selectedPage?.currentRevisionKey ?? "No revision"}
      />
    ) : null;
  const updateMobileDrawer = (action: MobileBrainDrawerAction) =>
    setMobileDrawer((current) => reduceMobileDrawerState(current, action));

  return (
    <>
      <Page.Header
        title="Client Brain"
        description="Stable page tree, BlockNote editor, and source evidence."
        actions={<Button variant="outline">Ask this Brain</Button>}
      />
      <Page.Body px={{ base: "4", md: "6" }} pb="8">
        {state.status === "ready" ? (
          <Stack gap="3">
            <SimpleGrid
              columns={{ base: 2, lg: 1 }}
              gap="2"
              display={{ base: "grid", lg: "none" }}
            >
              <Button
                aria-controls="brain-mobile-page-tree-drawer"
                aria-expanded={mobileDrawer === "tree"}
                variant="outline"
                onClick={() => updateMobileDrawer("open_tree")}
              >
                Open page tree
              </Button>
              <Button
                aria-controls="brain-mobile-evidence-drawer"
                aria-expanded={mobileDrawer === "evidence"}
                variant="outline"
                onClick={() => updateMobileDrawer("open_evidence")}
              >
                Open evidence drawer
              </Button>
            </SimpleGrid>
            <SimpleGrid columns={{ base: 1, lg: 12 }} gap="4">
              <Stack
                data-testid="brain-desktop-page-tree-region"
                display={{ base: "none", lg: "block" }}
                gridColumn={{ lg: "span 3" }}
              >
                {pageTree}
              </Stack>
              <Stack gridColumn={{ lg: "span 6" }}>
                <BrainEditorPane
                  canEdit={state.canEdit}
                  page={state.selectedPage}
                  editorRevisionFence={editorRevisionFence}
                  conflict={saveConflict}
                  syncApi={syncApi}
                  onSaveMarkdown={(markdown) => {
                    setSaveConflict(undefined);
                    const saveArgs = buildWorkspaceSaveArgs(
                      state,
                      markdown,
                      undefined,
                      editorRevisionFence ?? undefined,
                    );
                    void onSaveMarkdown(saveArgs).then((result) => {
                      const nextRevisionFence =
                        reduceWorkspaceEditorRevisionFenceAfterSave(
                          result,
                          editorRevisionFence,
                        );
                      if (nextRevisionFence !== editorRevisionFence) {
                        setSavedEditorFence({
                          documentId: saveArgs?.documentId ?? null,
                          revisionKey: nextRevisionFence,
                        });
                      }
                      setSaveConflict(reduceSaveConflict(result));
                    });
                  }}
                  onSaveSnapshot={(snapshot: BrainEditorSnapshot) => {
                    setSaveConflict(undefined);
                    const saveArgs = buildWorkspaceSaveArgs(
                      state,
                      snapshot.snapshot,
                      snapshot.version,
                      snapshot.expectedCurrentRevisionKey,
                    );
                    void onSaveMarkdown(saveArgs).then((result) => {
                      const nextRevisionFence =
                        reduceWorkspaceEditorRevisionFenceAfterSave(
                          result,
                          snapshot.expectedCurrentRevisionKey,
                        );
                      if (
                        nextRevisionFence !==
                        snapshot.expectedCurrentRevisionKey
                      ) {
                        setSavedEditorFence({
                          documentId: saveArgs?.documentId ?? null,
                          revisionKey: nextRevisionFence,
                        });
                      }
                      setSaveConflict(reduceSaveConflict(result));
                    });
                  }}
                  onSyncError={() => setSaveConflict("stale_revision")}
                />
              </Stack>
              <Stack
                data-testid="brain-desktop-evidence-region"
                display={{ base: "none", lg: "block" }}
                gridColumn={{ lg: "span 3" }}
              >
                {evidenceDrawer}
              </Stack>
            </SimpleGrid>
          </Stack>
        ) : (
          <BrainWorkspaceStateCard state={state} />
        )}
        {state.status === "ready" ? (
          <>
            <TemplateDialog
              isOpen={mobileDrawer === "tree"}
              onClose={() => updateMobileDrawer("close")}
              title="Page tree"
            >
              <div id="brain-mobile-page-tree-drawer">{pageTree}</div>
            </TemplateDialog>
            <TemplateDialog
              isOpen={mobileDrawer === "evidence"}
              onClose={() => updateMobileDrawer("close")}
              title="Evidence and history"
            >
              <div id="brain-mobile-evidence-drawer">{evidenceDrawer}</div>
            </TemplateDialog>
          </>
        ) : null}
      </Page.Body>
    </>
  );
}

function BrainWorkspaceStateCard({
  state,
}: {
  readonly state: Exclude<BrainWorkspaceState, { readonly status: "ready" }>;
}) {
  const titleByStatus = {
    loading: "Loading Brain workspace",
    empty: "No pages in this Brain",
    not_found: "Brain page not found",
    forbidden: "Brain access denied",
    stale_revision: "Newer revision available",
    transport_failure: "Brain workspace unavailable",
  } as const;
  return (
    <Card.Root borderRadius="md">
      <Card.Body>
        <Stack gap="3">
          <Badge
            alignSelf="flex-start"
            colorPalette={state.status === "transport_failure" ? "red" : "blue"}
          >
            {state.status}
          </Badge>
          <Heading size="md">{titleByStatus[state.status]}</Heading>
          <Text color="gray.600">{describeBrainWorkspaceState(state)}</Text>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
