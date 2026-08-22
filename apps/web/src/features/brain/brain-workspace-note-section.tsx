import type { FormEvent } from "react";
import {
  Button,
  Card,
  Heading,
  HStack,
  Input,
  Stack,
  Text,
} from "@saas-ui/react";

import type { BrainWorkspaceAdapter } from "./brain-surface";
import { createBrainWorkspaceActions } from "./brain-workspace-actions";
import type {
  BrainReviewNotice,
  BrainWorkspaceActionState,
} from "./brain-workspace-types";

type BrainWorkspaceActions = ReturnType<typeof createBrainWorkspaceActions>;

export const BrainNotePanel = ({
  actions,
  adapter,
  markdown,
  onMarkdownChange,
  onReviewStateChange,
  onSourceKeyChange,
  onTitleChange,
  reviewNotice,
  reviewState,
  sourceKey,
  title,
}: {
  readonly actions: BrainWorkspaceActions;
  readonly adapter: BrainWorkspaceAdapter;
  readonly markdown: string;
  readonly onMarkdownChange: (markdown: string) => void;
  readonly onReviewStateChange: (state: BrainWorkspaceActionState) => void;
  readonly onSourceKeyChange: (sourceKey: string | null) => void;
  readonly onTitleChange: (title: string) => void;
  readonly reviewNotice?: BrainReviewNotice;
  readonly reviewState: BrainWorkspaceActionState | null;
  readonly sourceKey: string | null;
  readonly title: string;
}) => (
  <Card.Root>
    <Card.Header>
      <Heading size="sm">Submit a note</Heading>
    </Card.Header>
    <Card.Body>
      <Stack gap="3">
        <BrainReviewNoticeText notice={reviewNotice} />
        <Text color="gray.600" fontSize="sm">
          Note submission and review are explicit pilot operations.
        </Text>
        <form
          aria-label="Submit note"
          onSubmit={(event) =>
            submitBrainNote({
              actions,
              event,
              markdown,
              onReviewStateChange,
              onSourceKeyChange,
              title,
            })
          }
        >
          <Stack gap="2">
            <label htmlFor="brain-note-title">Note title</label>
            <Input
              id="brain-note-title"
              onChange={(event) => onTitleChange(event.target.value)}
              value={title}
            />
            <label htmlFor="brain-note-markdown">Note markdown</label>
            <textarea
              id="brain-note-markdown"
              onChange={(event) => onMarkdownChange(event.target.value)}
              rows={6}
              value={markdown}
            />
            <Button disabled={adapter.submitNote === undefined} type="submit">
              Submit note
            </Button>
          </Stack>
        </form>
        <BrainNoteReviewControls
          actions={actions}
          adapter={adapter}
          onReviewStateChange={onReviewStateChange}
          reviewState={reviewState}
          sourceKey={sourceKey}
        />
        <BrainReviewStateText state={reviewState} />
        <BrainPilotAvailability adapter={adapter} />
      </Stack>
    </Card.Body>
  </Card.Root>
);

const BrainReviewNoticeText = ({
  notice,
}: {
  readonly notice?: BrainReviewNotice;
}) =>
  notice ? (
    <Text
      aria-live="assertive"
      color={notice.status === "failure" ? "red.600" : "green.600"}
    >
      {notice.message}
    </Text>
  ) : null;

const submitBrainNote = async ({
  actions,
  event,
  markdown,
  onReviewStateChange,
  onSourceKeyChange,
  title,
}: {
  readonly actions: BrainWorkspaceActions;
  readonly event: FormEvent<HTMLFormElement>;
  readonly markdown: string;
  readonly onReviewStateChange: (state: BrainWorkspaceActionState) => void;
  readonly onSourceKeyChange: (sourceKey: string | null) => void;
  readonly title: string;
}) => {
  event.preventDefault();
  const result = await actions.submitNote({
    title: title.trim(),
    markdown,
  });
  onReviewStateChange(result);
  if (result.status === "pending_review") onSourceKeyChange(result.sourceKey);
};

const BrainNoteReviewControls = ({
  actions,
  adapter,
  onReviewStateChange,
  reviewState,
  sourceKey,
}: {
  readonly actions: BrainWorkspaceActions;
  readonly adapter: BrainWorkspaceAdapter;
  readonly onReviewStateChange: (state: BrainWorkspaceActionState) => void;
  readonly reviewState: BrainWorkspaceActionState | null;
  readonly sourceKey: string | null;
}) => {
  if (sourceKey === null || reviewState?.status !== "pending_review")
    return null;
  const review = async (decision: "approve" | "reject") =>
    onReviewStateChange(await actions.reviewNote({ sourceKey, decision }));
  return (
    <HStack gap="2" wrap="wrap">
      <Button
        disabled={adapter.reviewNote === undefined}
        type="button"
        onClick={() => review("approve")}
      >
        Approve note
      </Button>
      <Button
        disabled={adapter.reviewNote === undefined}
        type="button"
        variant="outline"
        onClick={() => review("reject")}
      >
        Reject note
      </Button>
    </HStack>
  );
};

const BrainReviewStateText = ({
  state,
}: {
  readonly state: BrainWorkspaceActionState | null;
}) => {
  if (state === null) return null;
  const staticCopy = reviewStateCopy[state.status];
  const message = staticCopy ?? ("message" in state ? state.message : null);
  const role = failureReviewStatuses.has(state.status) ? "alert" : "status";
  return message === null ? null : <Text role={role}>{message}</Text>;
};

const reviewStateCopy: Partial<
  Record<BrainWorkspaceActionState["status"], string>
> = {
  pending_review: "Note pending review.",
  published: "Note approved and published.",
  rejected: "Note rejected.",
};

const failureReviewStatuses = new Set<BrainWorkspaceActionState["status"]>([
  "failure",
  "unavailable",
]);

const BrainPilotAvailability = ({
  adapter,
}: {
  readonly adapter: BrainWorkspaceAdapter;
}) =>
  [adapter.submitNote, adapter.reviewNote].some(
    (operation) => operation === undefined,
  ) ? (
    <Text color="gray.600" fontSize="sm">
      Review unavailable until the Brain pilot backend is connected.
    </Text>
  ) : null;
