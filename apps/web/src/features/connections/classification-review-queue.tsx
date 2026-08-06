import { Badge, Card, Heading, Stack, Text } from "@saas-ui/react";

export type ClassificationReviewState =
  "proposed_zero" | "proposed_one" | "proposed_mixed";
export type ClassificationReviewItem = {
  readonly decisionKey: string;
  readonly channelName: string;
  readonly state: ClassificationReviewState;
  readonly proposedBrainName: string | null;
  readonly confidence: number;
  readonly evidenceQuotes: readonly string[];
};
export type ClassificationQueueSummary = {
  readonly proposedOne: number;
  readonly proposedZero: number;
  readonly proposedMixed: number;
  readonly routeReadyWithoutReview: 0;
};
export const summarizeClassificationQueue = (
  items: readonly ClassificationReviewItem[],
): ClassificationQueueSummary => ({
  proposedOne: items.filter((item) => item.state === "proposed_one").length,
  proposedZero: items.filter((item) => item.state === "proposed_zero").length,
  proposedMixed: items.filter((item) => item.state === "proposed_mixed").length,
  routeReadyWithoutReview: 0,
});

const label = (item: ClassificationReviewItem) =>
  item.state === "proposed_mixed"
    ? "Mixed client — no route in V1"
    : item.state === "proposed_zero"
      ? "No route"
      : (item.proposedBrainName ?? "Allowed target required");

export function ClassificationReviewQueue({
  items,
}: {
  readonly items: readonly ClassificationReviewItem[];
}) {
  const summary = summarizeClassificationQueue(items);
  return (
    <Card.Root>
      <Card.Header>
        <Heading size="md">Classification review queue</Heading>
        <Badge colorPalette="blue">Admin review required</Badge>
      </Card.Header>
      <Card.Body>
        {items.length === 0 ? (
          <Text>No classification proposals awaiting review.</Text>
        ) : (
          <Stack gap="3">
            <Text>
              One target: {summary.proposedOne}; No route:{" "}
              {summary.proposedZero}; Mixed client: {summary.proposedMixed}
            </Text>
            {items.map((item) => (
              <Stack key={item.decisionKey} gap="1">
                <Text>
                  {item.channelName}: {label(item)}
                </Text>
                <Text>
                  Confidence {Math.round(item.confidence * 100)}% is diagnostic
                  only; admins may accept, no-route, or reject from the
                  generated capability controls.
                </Text>
                <Text>{item.evidenceQuotes.join(" • ")}</Text>
              </Stack>
            ))}
          </Stack>
        )}
      </Card.Body>
    </Card.Root>
  );
}
