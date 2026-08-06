import { Badge, Button, Card, Heading, Stack, Text } from "@saas-ui/react";
import type { FormEvent } from "react";

export type CallRoutingItem = {
  readonly proposalKey: string;
  readonly unitKey: string;
  readonly unitRevisionKey: string;
  readonly title: string;
  readonly sourceUrl: string;
  readonly outcome: "awaiting_review" | "mixed_client" | "no_match";
  readonly brainKey: string | null;
  readonly candidateBrainKeys: readonly string[];
  readonly reason: string;
  readonly routeGeneration: number;
  readonly sourceLifecycleGeneration: number;
  readonly createdAt: number;
};

export type CallRoutingReview = {
  readonly item: CallRoutingItem;
  readonly action: "confirm" | "change_brain" | "no_route" | "reject";
  readonly targetBrainKey?: string;
  readonly learnScope?: "recurring_meeting" | "email" | "domain";
  readonly learnValue?: string;
};

export type CallRoutingMutationState =
  | { readonly status: "pending"; readonly proposalKey: string }
  | { readonly status: "success" | "failure"; readonly message: string };

export type CallRoutingQueueState =
  | { readonly status: "loading" | "empty" }
  | { readonly status: "failure"; readonly message: string }
  | {
      readonly status: "ready";
      readonly items: readonly CallRoutingItem[];
      readonly mutation?: CallRoutingMutationState;
    };

export function CallRoutingQueue({
  role,
  state,
  onReview,
}: {
  readonly role: "viewer" | "editor" | "admin" | "owner";
  readonly state: CallRoutingQueueState;
  readonly onReview: (review: CallRoutingReview) => void | Promise<void>;
}) {
  const canReview = role === "admin" || role === "owner";
  return (
    <Card.Root>
      <Card.Header>
        <Heading size="md">Calls to route</Heading>
        <Text color="gray.600" fontSize="sm">
          Confirm ambiguous calls before they can update a Client Brain.
        </Text>
      </Card.Header>
      <Card.Body>
        {state.status === "loading" ? (
          <Text role="status">Loading call routing queue…</Text>
        ) : null}
        {state.status === "empty" ? (
          <Stack gap="1">
            <Text fontWeight="medium">No calls need routing</Text>
            <Text color="gray.600" fontSize="sm">
              Calls with exact matches route automatically.
            </Text>
          </Stack>
        ) : null}
        {state.status === "failure" ? (
          <Text role="alert">{state.message}</Text>
        ) : null}
        {state.status === "ready" && !canReview ? (
          <Text color="gray.600" fontSize="sm">
            Admin access is required to route calls.
          </Text>
        ) : null}
        {state.status === "ready" ? (
          <Stack gap="4">
            {state.items.map((item) => {
              const pending =
                state.mutation?.status === "pending" &&
                state.mutation.proposalKey === item.proposalKey;
              const candidates = [
                ...new Set(
                  item.brainKey === null
                    ? item.candidateBrainKeys
                    : [item.brainKey, ...item.candidateBrainKeys],
                ),
              ];
              return (
                <Card.Root key={item.proposalKey} variant="outline">
                  <Card.Body>
                    <form
                      aria-label={`Route ${item.title}`}
                      onSubmit={(event) =>
                        submitRouteReview(event, item, onReview)
                      }
                    >
                      <fieldset disabled={!canReview || pending}>
                        <Stack gap="3">
                          <Stack gap="1">
                            <Heading size="sm">{item.title}</Heading>
                            <a
                              href={item.sourceUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open {item.title} transcript
                            </a>
                            <Text color="gray.600" fontSize="sm">
                              {item.reason}
                            </Text>
                          </Stack>
                          <label htmlFor={`target-${item.proposalKey}`}>
                            Target Brain
                          </label>
                          <select
                            defaultValue={item.brainKey ?? candidates[0] ?? ""}
                            id={`target-${item.proposalKey}`}
                            name="targetBrainKey"
                            required
                          >
                            <option value="">Select a Brain</option>
                            {candidates.map((brainKey) => (
                              <option key={brainKey} value={brainKey}>
                                {brainKey}
                              </option>
                            ))}
                          </select>
                          <label htmlFor={`learn-scope-${item.proposalKey}`}>
                            Remember this route
                          </label>
                          <select
                            defaultValue=""
                            id={`learn-scope-${item.proposalKey}`}
                            name="learnScope"
                          >
                            <option value="">Do not remember</option>
                            <option value="recurring_meeting">
                              Recurring meeting
                            </option>
                            <option value="email">Participant email</option>
                            <option value="domain">Participant domain</option>
                          </select>
                          <label htmlFor={`learn-value-${item.proposalKey}`}>
                            Match value
                          </label>
                          <input
                            id={`learn-value-${item.proposalKey}`}
                            name="learnValue"
                            placeholder="acme.com"
                            type="text"
                          />
                          <Stack
                            direction={{ base: "column", md: "row" }}
                            gap="2"
                          >
                            <Button name="action" type="submit" value="confirm">
                              Confirm route
                            </Button>
                            <Button
                              name="action"
                              type="submit"
                              value="change_brain"
                              variant="outline"
                            >
                              Change Brain
                            </Button>
                            <Button
                              name="action"
                              type="submit"
                              value="no_route"
                              variant="outline"
                              formNoValidate
                            >
                              Mark no route
                            </Button>
                            <Button
                              name="action"
                              type="submit"
                              value="reject"
                              variant="outline"
                              formNoValidate
                            >
                              Reject proposal
                            </Button>
                          </Stack>
                          {pending ? (
                            <Text role="status">Saving route review…</Text>
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

const submitRouteReview = (
  event: FormEvent<HTMLFormElement>,
  item: CallRoutingItem,
  onReview: (review: CallRoutingReview) => void | Promise<void>,
) => {
  event.preventDefault();
  const data = new FormData(
    event.currentTarget,
    (event.nativeEvent as SubmitEvent).submitter,
  );
  void onReview(callRoutingReviewFromFormData(item, data));
};

export const callRoutingReviewFromFormData = (
  item: CallRoutingItem,
  data: FormData,
): CallRoutingReview => {
  const action = String(data.get("action")) as CallRoutingReview["action"];
  const targetBrainKey = String(data.get("targetBrainKey") ?? "").trim();
  const learnScope = String(data.get("learnScope") ?? "") as
    CallRoutingReview["learnScope"] | "";
  const learnValue = String(data.get("learnValue") ?? "").trim();
  return {
    item,
    action,
    ...(targetBrainKey ? { targetBrainKey } : {}),
    ...(learnScope ? { learnScope } : {}),
    ...(learnValue ? { learnValue } : {}),
  };
};
