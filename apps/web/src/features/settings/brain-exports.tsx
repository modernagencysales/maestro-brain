import { Card, Heading, Stack, Text } from "@saas-ui/react";

import type { WorkspaceRole } from "../../providers/workspace";
import { ExportDialog } from "./export-dialog";
import { ExportHistory, type BrainExportViewState } from "./export-history";

export function BrainExports({
  role,
  disabledReason,
  exportState,
  requestPending = false,
  onRequest,
}: {
  readonly role: WorkspaceRole;
  readonly disabledReason?: string;
  readonly exportState: BrainExportViewState;
  readonly requestPending?: boolean;
  readonly onRequest: (idempotencyKey: string) => Promise<void> | void;
}) {
  const canRequest = role === "admin" || role === "owner";

  return (
    <Card.Root>
      <Card.Header>
        <Heading size="md">Brain exports</Heading>
      </Card.Header>
      <Card.Body>
        <Stack gap="6">
          <Text>
            Exports are generated from an authorized Brain snapshot and expire
            automatically.
          </Text>
          {canRequest ? (
            <ExportDialog
              disabled={disabledReason !== undefined}
              {...(disabledReason ? { disabledReason } : {})}
              onRequest={onRequest}
              pending={requestPending}
            />
          ) : (
            <Text>Only workspace admins can request exports.</Text>
          )}
          <ExportHistory state={exportState} />
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
