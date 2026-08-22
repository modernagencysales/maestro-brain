import type { BrainWorkspaceAdapter } from "./brain-surface";
import type { BrainWorkspaceActionState } from "./brain-workspace-types";

type SubmitNoteInput = {
  readonly title: string;
  readonly markdown: string;
};
type ReviewNoteInput = {
  readonly sourceKey: string;
  readonly decision: "approve" | "reject";
};
type SavePageInput = {
  readonly pageKey: string;
  readonly expectedCurrentRevisionKey: string;
  readonly markdown: string;
};
type MovePageInput = {
  readonly pageKey: string;
  readonly expectedCurrentRevisionKey: string;
  readonly parentPageKey: string | null;
  readonly sortKey: string;
};

export const createBrainWorkspaceActions = (
  adapter: BrainWorkspaceAdapter,
) => ({
  submitNote: (input: SubmitNoteInput): Promise<BrainWorkspaceActionState> =>
    runPilotAction({
      acceptedStatuses: pendingReviewStatuses,
      input,
      operation: adapter.submitNote,
      rejectedMessage: "The note was not queued for review.",
      unavailableMessage: "Note submission is unavailable.",
    }),
  reviewNote: (input: ReviewNoteInput): Promise<BrainWorkspaceActionState> =>
    runPilotAction({
      acceptedStatuses: completedReviewStatuses,
      input,
      operation: adapter.reviewNote,
      rejectedMessage: "The review decision was not saved.",
      unavailableMessage: "Note review is unavailable.",
    }),
  savePage: (input: SavePageInput): Promise<BrainWorkspaceActionState> =>
    runPageAction({
      input,
      operation: adapter.updatePage,
      successStatus: "saved",
      unavailableMessage: "Page saving is unavailable.",
    }),
  movePage: (input: MovePageInput): Promise<BrainWorkspaceActionState> =>
    runPageAction({
      input,
      operation: adapter.movePage,
      successStatus: "moved",
      unavailableMessage: "Page moving is unavailable.",
    }),
});

const pendingReviewStatuses = new Set(["pending_review"]);
const completedReviewStatuses = new Set(["published", "rejected"]);

const runPilotAction = async <Input>({
  acceptedStatuses,
  input,
  operation,
  rejectedMessage,
  unavailableMessage,
}: {
  readonly acceptedStatuses: ReadonlySet<string>;
  readonly input: Input;
  readonly operation?: (input: Input) => Promise<{
    readonly sourceKey: string;
    readonly status: "pending_review" | "published" | "rejected";
  }>;
  readonly rejectedMessage: string;
  readonly unavailableMessage: string;
}): Promise<BrainWorkspaceActionState> => {
  if (operation === undefined)
    return { status: "unavailable", message: unavailableMessage };
  try {
    const result = await operation(input);
    return acceptedStatuses.has(result.status)
      ? result
      : { status: "failure", message: rejectedMessage };
  } catch (error) {
    return { status: "failure", message: failureMessage(error) };
  }
};

const runPageAction = async <Input>({
  input,
  operation,
  successStatus,
  unavailableMessage,
}: {
  readonly input: Input;
  readonly operation?: (input: Input) => Promise<unknown>;
  readonly successStatus: "saved" | "moved";
  readonly unavailableMessage: string;
}): Promise<BrainWorkspaceActionState> => {
  if (operation === undefined)
    return { status: "unavailable", message: unavailableMessage };
  try {
    await operation(input);
    return { status: successStatus };
  } catch (error) {
    return pageActionFailure(error);
  }
};

const pageActionFailure = (error: unknown): BrainWorkspaceActionState => {
  const tag = Reflect.get(Object(error), "_tag") as string | undefined;
  return (
    pageConflictStates[tag as keyof typeof pageConflictStates] ?? {
      status: "failure",
      message: failureMessage(error),
    }
  );
};

const pageConflictStates = {
  StaleRevision: { status: "stale_conflict" },
  LifecycleRevoked: { status: "lifecycle_conflict" },
} as const satisfies Record<string, BrainWorkspaceActionState>;

const failureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "The Brain operation failed.";
