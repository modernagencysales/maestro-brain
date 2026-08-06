import { Button, Card, Heading, Stack, Text } from "@saas-ui/react";
import type { FormEvent } from "react";

export type CallMaintenanceProposal = {
  readonly proposalKey: string;
  readonly unitRevisionKey: string;
  readonly sourceTitle: string;
  readonly sourceUrl: string;
  readonly summary: string;
  readonly routeGeneration: number;
  readonly sourceLifecycleGeneration: number;
  readonly workspaceLifecycleGeneration: number;
  readonly createdAt: number;
  readonly items: readonly {
    readonly itemKey: string;
    readonly pageKey: string;
    readonly title: string;
    readonly expectedRevisionKey: string;
    readonly markdown: string;
    readonly citations: readonly {
      readonly citationKey: string;
      readonly quote: string;
      readonly speakerLabel: string;
      readonly startMs: number | null;
      readonly endMs: number | null;
    }[];
  }[];
};

export type CallMaintenanceDecision = {
  readonly proposal: CallMaintenanceProposal;
  readonly action: "accept" | "edit" | "reject";
  readonly edits: readonly {
    readonly itemKey: string;
    readonly markdown: string;
  }[];
};

export type CallMaintenanceMutationState =
  | { readonly status: "pending"; readonly proposalKey: string }
  | { readonly status: "success" | "failure"; readonly message: string };

export type CallMaintenanceReviewState =
  | { readonly status: "loading" | "empty" }
  | { readonly status: "failure"; readonly message: string }
  | {
      readonly status: "ready";
      readonly items: readonly CallMaintenanceProposal[];
      readonly mutation?: CallMaintenanceMutationState;
    };

export function CallMaintenanceReview({
  role,
  state,
  onReview,
}: {
  readonly role: "viewer" | "editor" | "admin" | "owner";
  readonly state: CallMaintenanceReviewState;
  readonly onReview: (
    decision: CallMaintenanceDecision,
  ) => void | Promise<void>;
}) {
  const canReview = role !== "viewer";
  return (
    <Card.Root>
      <Card.Header>
        <Heading size="md">Call-backed Brain updates</Heading>
        <Text color="gray.600" fontSize="sm">
          Review grouped page changes with exact transcript evidence.
        </Text>
      </Card.Header>
      <Card.Body>
        {state.status === "loading" ? (
          <Text role="status">Loading call updates…</Text>
        ) : null}
        {state.status === "empty" ? (
          <Text>No call updates need review.</Text>
        ) : null}
        {state.status === "failure" ? (
          <Text role="alert">{state.message}</Text>
        ) : null}
        {state.status !== "loading" &&
        state.status !== "failure" &&
        !canReview ? (
          <Text color="gray.600" fontSize="sm">
            Editor access is required to review call updates.
          </Text>
        ) : null}
        {state.status === "ready" ? (
          <Stack gap="4">
            {state.items.map((proposal) => {
              const pending =
                state.mutation?.status === "pending" &&
                state.mutation.proposalKey === proposal.proposalKey;
              return (
                <Card.Root key={proposal.proposalKey} variant="outline">
                  <Card.Body>
                    <form
                      aria-label={`Review ${proposal.sourceTitle}`}
                      onSubmit={(event) =>
                        submitMaintenanceReview(event, proposal, onReview)
                      }
                    >
                      <fieldset disabled={!canReview || pending}>
                        <Stack gap="4">
                          <Stack gap="1">
                            <Heading size="sm">{proposal.sourceTitle}</Heading>
                            <a
                              href={proposal.sourceUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open {proposal.sourceTitle} transcript
                            </a>
                            <Text>{proposal.summary}</Text>
                          </Stack>
                          {proposal.items.map((item) => (
                            <Stack gap="2" key={item.itemKey}>
                              <label htmlFor={`edit-${item.itemKey}`}>
                                {item.title}
                              </label>
                              <textarea
                                defaultValue={item.markdown}
                                id={`edit-${item.itemKey}`}
                                name={item.itemKey}
                                rows={8}
                              />
                              <Stack as="ul" gap="1" pl="5">
                                {item.citations.map((citation) => (
                                  <Text
                                    as="li"
                                    fontSize="sm"
                                    key={citation.citationKey}
                                  >
                                    <strong>{citation.speakerLabel}</strong>{" "}
                                    {timestamp(
                                      citation.startMs,
                                      citation.endMs,
                                    )}
                                    : “{citation.quote}”
                                  </Text>
                                ))}
                              </Stack>
                            </Stack>
                          ))}
                          <Stack
                            direction={{ base: "column", md: "row" }}
                            gap="2"
                          >
                            <Button name="action" type="submit" value="accept">
                              Accept all changes
                            </Button>
                            <Button
                              name="action"
                              type="submit"
                              value="edit"
                              variant="outline"
                            >
                              Publish edited changes
                            </Button>
                            <Button
                              name="action"
                              type="submit"
                              value="reject"
                              variant="outline"
                            >
                              Reject all changes
                            </Button>
                          </Stack>
                          {pending ? (
                            <Text role="status">Publishing call updates…</Text>
                          ) : null}
                        </Stack>
                      </fieldset>
                    </form>
                  </Card.Body>
                </Card.Root>
              );
            })}
            {state.mutation?.status === "success" ? (
              <Text role="status">{state.mutation.message}</Text>
            ) : null}
            {state.mutation?.status === "failure" ? (
              <Text role="alert">{state.mutation.message}</Text>
            ) : null}
          </Stack>
        ) : null}
      </Card.Body>
    </Card.Root>
  );
}

const submitMaintenanceReview = (
  event: FormEvent<HTMLFormElement>,
  proposal: CallMaintenanceProposal,
  onReview: (decision: CallMaintenanceDecision) => void | Promise<void>,
) => {
  event.preventDefault();
  const data = new FormData(
    event.currentTarget,
    (event.nativeEvent as SubmitEvent).submitter,
  );
  void onReview(callMaintenanceDecisionFromFormData(proposal, data));
};

export const callMaintenanceDecisionFromFormData = (
  proposal: CallMaintenanceProposal,
  data: FormData,
): CallMaintenanceDecision => {
  const action = String(
    data.get("action"),
  ) as CallMaintenanceDecision["action"];
  return {
    proposal,
    action,
    edits:
      action === "edit"
        ? proposal.items.map((item) => ({
            itemKey: item.itemKey,
            markdown: String(data.get(item.itemKey) ?? ""),
          }))
        : [],
  };
};

const timestamp = (startMs: number | null, endMs: number | null): string =>
  startMs === null
    ? "Time unavailable"
    : `${clock(startMs)}${endMs === null ? "" : `–${clock(endMs)}`}`;

const clock = (milliseconds: number): string => {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
