import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Stack,
  Text,
} from "@saas-ui/react";

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

const summaryBadges = (summary: ClassificationQueueSummary) =>
  [
    ["green", `One target: ${summary.proposedOne}`],
    ["gray", `No route: ${summary.proposedZero}`],
    ["orange", `Mixed client: ${summary.proposedMixed}`],
  ] as const;

export function ClassificationReviewQueue({
  items,
}: {
  readonly items: readonly ClassificationReviewItem[];
}) {
  const summary = summarizeClassificationQueue(items);
  return (
    <Card.Root borderRadius="md">
      <Card.Header>
        <Flex align="start" justify="space-between" gap="4">
          <Box>
            <Heading size="md">Classification review queue</Heading>
            <Text color="gray.600" fontSize="sm">
              Admin review required before any classified source unit can route.
            </Text>
          </Box>
          <Badge colorPalette="blue">Admin review required</Badge>
        </Flex>
      </Card.Header>
      <Card.Body pt="0">
        {items.length === 0 ? (
          <Text color="gray.600">
            No classification proposals awaiting review.
          </Text>
        ) : (
          <Stack gap="4">
            <Flex gap="2" wrap="wrap">
              {summaryBadges(summary).map(([colorPalette, label]) => (
                <Badge key={label} colorPalette={colorPalette}>
                  {label}
                </Badge>
              ))}
            </Flex>
            <Stack aria-label="Classification review list" gap="3">
              {items.map((item) => (
                <ClassificationReviewRow key={item.decisionKey} item={item} />
              ))}
            </Stack>
          </Stack>
        )}
      </Card.Body>
    </Card.Root>
  );
}

const ClassificationReviewRow = ({
  item,
}: {
  readonly item: ClassificationReviewItem;
}) => (
  <Box borderWidth="1px" borderRadius="md" p="3">
    <Flex align="start" justify="space-between" gap="3" wrap="wrap">
      <Box>
        <Text fontWeight="medium">
          {item.channelName}: {proposalLabel(item)}
        </Text>
        <Text color="gray.600" fontSize="sm">
          Confidence {Math.round(item.confidence * 100)}% is diagnostic only.
        </Text>
        <Text fontSize="sm">{item.evidenceQuotes.join(" • ")}</Text>
      </Box>
      <Flex gap="2" wrap="wrap">
        {item.state === "proposed_one" ? (
          <Button size="xs">Accept</Button>
        ) : null}
        <Button size="xs" variant="outline">
          No route
        </Button>
        <Button size="xs" variant="outline">
          Reject
        </Button>
      </Flex>
    </Flex>
  </Box>
);

const proposalLabel = (item: ClassificationReviewItem): string => {
  if (item.state === "proposed_mixed") return "Mixed client — no route in V1";
  if (item.state === "proposed_zero") return "No route";
  return item.proposedBrainName ?? "Allowed target required";
};
