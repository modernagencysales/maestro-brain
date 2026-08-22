import { Box, Heading, Text } from "@saas-ui/react";

import type {
  BrainPageDetail,
  BrainSearchState,
  BrainWorkspaceAdapter,
} from "./brain-surface";
import { RestoreDialog, type BrainRestoreState } from "./restore-dialog";
import { RevisionDiff } from "./revision-diff";
import {
  RevisionHistory,
  type BrainRevisionHistoryState,
} from "./revision-history";

export const BrainPageEvidence = ({
  adapter,
  detail,
  history,
  onNotice,
  onRestoreRevisionChange,
  onRestoreStateChange,
  restoreRevisionKey,
  restoreState,
  search,
}: {
  readonly adapter: BrainWorkspaceAdapter;
  readonly detail: BrainPageDetail;
  readonly history: BrainRevisionHistoryState;
  readonly onNotice: (notice: string) => void;
  readonly onRestoreRevisionChange: (revisionKey: string | null) => void;
  readonly onRestoreStateChange: (state: BrainRestoreState) => void;
  readonly restoreRevisionKey: string | null;
  readonly restoreState: BrainRestoreState;
  readonly search: BrainSearchState;
}) => {
  const canRestore = adapter.canEdit && adapter.restorePage !== undefined;
  return (
    <>
      <Box borderTopWidth="1px" mt="4" pt="3">
        <Heading size="xs">Revision and evidence</Heading>
        <Text fontSize="sm">
          Revision: {detail.page.currentRevisionKey ?? "No revision"}
        </Text>
        <Text fontSize="sm">
          Updated: {new Date(detail.updatedAt).toLocaleString()}
        </Text>
        <Text fontSize="sm">
          Lifecycle generation: {detail.page.lifecycleGeneration}
        </Text>
        <Text fontSize="sm">Evidence: {brainEvidenceCopy(search)}</Text>
      </Box>
      <RevisionHistory
        canRestore={canRestore}
        history={history}
        onRestore={(revisionKey) => {
          onRestoreRevisionChange(revisionKey);
          onRestoreStateChange("idle");
        }}
      />
      <BrainRestoreDialog
        adapter={adapter}
        detail={detail}
        onNotice={onNotice}
        onRestoreRevisionChange={onRestoreRevisionChange}
        onRestoreStateChange={onRestoreStateChange}
        restoreRevisionKey={restoreRevisionKey}
        restoreState={restoreState}
      />
      <BrainRevisionDiff history={history} />
    </>
  );
};

const brainEvidenceCopy = (search: BrainSearchState): string => {
  if (search.status !== "ready") return "Search for cited evidence";
  const suffix = search.results.length === 1 ? "" : "s";
  return `${search.results.length} cited result${suffix}`;
};

const BrainRestoreDialog = ({
  adapter,
  detail,
  onNotice,
  onRestoreRevisionChange,
  onRestoreStateChange,
  restoreRevisionKey,
  restoreState,
}: {
  readonly adapter: BrainWorkspaceAdapter;
  readonly detail: BrainPageDetail;
  readonly onNotice: (notice: string) => void;
  readonly onRestoreRevisionChange: (revisionKey: string | null) => void;
  readonly onRestoreStateChange: (state: BrainRestoreState) => void;
  readonly restoreRevisionKey: string | null;
  readonly restoreState: BrainRestoreState;
}) => {
  if (restoreRevisionKey === null) return null;
  return (
    <RestoreDialog
      canRestore={adapter.canEdit && adapter.restorePage !== undefined}
      open
      revisionKey={restoreRevisionKey}
      state={restoreState}
      onCancel={() => onRestoreRevisionChange(null)}
      onConfirm={() =>
        restoreBrainRevision({
          adapter,
          detail,
          onNotice,
          onRestoreStateChange,
          restoreRevisionKey,
        })
      }
    />
  );
};

const restoreBrainRevision = async ({
  adapter,
  detail,
  onNotice,
  onRestoreStateChange,
  restoreRevisionKey,
}: {
  readonly adapter: BrainWorkspaceAdapter;
  readonly detail: BrainPageDetail;
  readonly onNotice: (notice: string) => void;
  readonly onRestoreStateChange: (state: BrainRestoreState) => void;
  readonly restoreRevisionKey: string;
}) => {
  const revisionKey = detail.page.currentRevisionKey;
  if (adapter.restorePage === undefined || revisionKey === null) return;
  onRestoreStateChange("restoring");
  try {
    await adapter.restorePage({
      brainKey: adapter.brainKey,
      pageKey: detail.page.pageKey,
      expectedCurrentRevisionKey: revisionKey,
      revisionKey: restoreRevisionKey,
    });
    onRestoreStateChange("success");
    onNotice("Revision restored as a new revision.");
  } catch {
    onRestoreStateChange("failure");
  }
};

const BrainRevisionDiff = ({
  history,
}: {
  readonly history: BrainRevisionHistoryState;
}) => {
  const diff = latestRevisionDiff(history);
  return diff === null ? null : <RevisionDiff diff={diff} />;
};

const latestRevisionDiff = (history: BrainRevisionHistoryState) => {
  if (history.status !== "ready" || history.data.revisions.length < 2)
    return null;
  const [after, before] = history.data.revisions;
  if (
    before === undefined ||
    after === undefined ||
    before.markdown === undefined ||
    after.markdown === undefined
  )
    return null;
  return {
    beforeRevisionKey: before.revisionKey,
    afterRevisionKey: after.revisionKey,
    before: before.markdown,
    after: after.markdown,
  };
};
