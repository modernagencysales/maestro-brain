import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Stack,
  Text,
  Textarea,
} from "@saas-ui/react";
import { useEffect, useState } from "react";
import {
  BlockNoteSyncEditor,
  type BlockNoteSyncEditorProps,
} from "@maestro-template/editor-react/client";
import type { BrainSelectedPage } from "./brain-surface";

export function readMarkdownSaveDraft(
  _original: string,
  draft: string,
): string {
  return draft;
}

export function readEditorDocumentId(
  page: BrainSelectedPage,
): `brainPage:${string}` | null {
  return page.editorTarget?.documentId ?? null;
}

export function BrainEditorPane({
  canEdit,
  conflict,
  page,
  onSaveMarkdown,
  syncApi,
}: {
  readonly canEdit: boolean;
  readonly conflict?: "stale_revision" | undefined;
  readonly page: BrainSelectedPage | null;
  readonly onSaveMarkdown: (markdown: string) => void;
  readonly syncApi?: BlockNoteSyncEditorProps["api"] | undefined;
}) {
  const [markdownDraft, setMarkdownDraft] = useState(page?.markdown ?? "");

  useEffect(() => {
    setMarkdownDraft(page?.markdown ?? "");
  }, [page?.pageKey, page?.markdown]);

  if (page === null) {
    return (
      <StateCard
        title="No page selected"
        description="Select a page from the tree."
      />
    );
  }
  return (
    <Card.Root borderRadius="md" h="100%">
      <Card.Header>
        <Stack gap="3">
          <HStack justify="space-between" align="flex-start">
            <Box>
              <Heading size="lg">{page.title}</Heading>
              <Text color="gray.600" fontSize="sm">
                Updated {formatUtcDate(page.updatedAt)}
              </Text>
            </Box>
            <HStack>
              <Badge colorPalette={canEdit ? "green" : "gray"}>
                {canEdit ? "Editable" : "Read-only viewer"}
              </Badge>
              <Button variant="outline">Ask this Brain</Button>
            </HStack>
          </HStack>
          {conflict === "stale_revision" ? (
            <Badge alignSelf="flex-start" colorPalette="yellow">
              Newer revision available
            </Badge>
          ) : null}
        </Stack>
      </Card.Header>
      <Card.Body pt="0">
        <Stack gap="3">
          {syncApi && page.editorTarget ? (
            <BlockNoteSyncEditor
              api={syncApi}
              documentId={readEditorDocumentId(page) ?? ""}
              editable={canEdit}
              snapshotDebounceMs={750}
            />
          ) : (
            <Textarea
              aria-label="Brain page markdown"
              value={markdownDraft}
              onChange={(event) => setMarkdownDraft(event.currentTarget.value)}
              readOnly={!canEdit}
              minH="280px"
            />
          )}
          {canEdit ? (
            <Button
              alignSelf="flex-start"
              onClick={() =>
                onSaveMarkdown(
                  readMarkdownSaveDraft(page.markdown, markdownDraft),
                )
              }
            >
              Save page
            </Button>
          ) : null}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

function StateCard({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <Card.Root borderRadius="md">
      <Card.Body>
        <Heading size="md">{title}</Heading>
        <Text>{description}</Text>
      </Card.Body>
    </Card.Root>
  );
}

function formatUtcDate(value: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
