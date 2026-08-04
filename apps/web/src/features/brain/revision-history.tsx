import { Badge, Button, Heading, Stack, Text } from "@saas-ui/react";

import type { BrainRevisionHistoryData } from "./brain-surface";

export type BrainRevisionHistoryState =
  | { readonly status: "loading" }
  | { readonly status: "failure"; readonly message: string }
  | { readonly status: "ready"; readonly data: BrainRevisionHistoryData };

export function RevisionHistory({
  history,
}: {
  readonly history: BrainRevisionHistoryState;
}) {
  return (
    <Stack aria-label="Revision history" as="section" gap="2" mt="4">
      <Heading size="xs">Revision history</Heading>
      {history.status === "loading" ? (
        <Text role="status">Loading revision history…</Text>
      ) : null}
      {history.status === "failure" ? (
        <Text color="red.600" role="alert">
          {history.message}
        </Text>
      ) : null}
      {history.status === "ready" ? (
        <Stack gap="2">
          {history.data.revisions.length === 0 ? (
            <Text>No revisions available.</Text>
          ) : (
            history.data.revisions.map((revision) => (
              <Stack key={revision.revisionKey} gap="1">
                <Text fontWeight="semibold">{revision.revisionKey}</Text>
                <Text fontSize="sm">
                  {new Date(revision.createdAt).toLocaleString()} ·{" "}
                  {revision.causation}
                </Text>
                <Badge width="fit-content">
                  Lifecycle generation {revision.lifecycleGeneration}
                </Badge>
              </Stack>
            ))
          )}
          <Button disabled type="button" variant="outline">
            Restore unavailable
          </Button>
        </Stack>
      ) : null}
    </Stack>
  );
}
