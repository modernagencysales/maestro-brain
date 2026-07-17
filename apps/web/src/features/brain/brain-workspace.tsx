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
import { useState } from "react";
import { BrainEditorPane } from "./brain-editor-pane";
import { BrainEvidenceDrawer } from "./brain-evidence-drawer";
import { BrainPageTree } from "./brain-page-tree";
import {
  describeBrainWorkspaceState,
  type BrainWorkspaceState,
} from "./brain-surface";
import type { Ref } from "@confect/core";
import type { TemplateConfectRefs } from "@maestro-template/convex/refs";
import type { TemplateMutationState } from "../../adapters/confect-state";

export type BrainMarkdownSaveArgs = Ref.Args<
  TemplateConfectRefs["public"]["editorSync"]["submitSnapshot"]
>;

export function buildWorkspaceSaveArgs(
  state: BrainWorkspaceState,
  markdown: string,
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
    id: selectedPage.editorTarget.documentId,
    version: selectedPage.editorTarget.snapshotVersion,
    content: markdown,
  };
}

export function reduceSaveConflict(
  result: TemplateMutationState<unknown, { readonly _tag?: string }>,
): "stale_revision" | undefined {
  return result.status === "typed_failure" &&
    result.error._tag === "StaleRevision"
    ? "stale_revision"
    : undefined;
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
}) {
  const [saveConflict, setSaveConflict] = useState<
    "stale_revision" | undefined
  >();
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
            <Button
              display={{ base: "inline-flex", lg: "none" }}
              variant="outline"
            >
              Mobile page drawer
            </Button>
            <SimpleGrid columns={{ base: 1, lg: 12 }} gap="4">
              <Stack gridColumn={{ lg: "span 3" }}>
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
              </Stack>
              <Stack gridColumn={{ lg: "span 6" }}>
                <BrainEditorPane
                  canEdit={state.canEdit}
                  page={state.selectedPage}
                  conflict={saveConflict}
                  onSaveMarkdown={(markdown) => {
                    setSaveConflict(undefined);
                    const saveArgs = buildWorkspaceSaveArgs(state, markdown);
                    void onSaveMarkdown(saveArgs).then((result) => {
                      setSaveConflict(reduceSaveConflict(result));
                    });
                  }}
                />
              </Stack>
              <Stack gridColumn={{ lg: "span 3" }}>
                <BrainEvidenceDrawer
                  citations={state.pages.map((page) => page.title)}
                  freshness={state.freshness}
                  revisionLabel={
                    state.selectedPage?.currentRevisionKey ?? "No revision"
                  }
                />
              </Stack>
            </SimpleGrid>
          </Stack>
        ) : (
          <BrainWorkspaceStateCard state={state} />
        )}
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
