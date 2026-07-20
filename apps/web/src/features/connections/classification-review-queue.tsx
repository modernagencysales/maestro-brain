import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Stack,
  Table,
  Text,
} from "@saas-ui/react";

export type ClassificationReviewState =
  "proposed_zero" | "proposed_one" | "proposed_mixed";

export type ClassificationReviewItem = {
  readonly decisionKey: string;
  readonly sourceUnitRevisionKey: string;
  readonly channelName: string;
  readonly state: ClassificationReviewState;
  readonly contentScope: "single_target" | "mixed_client" | "no_target";
  readonly proposedBrainName: string | null;
  readonly allowedTargetNames: readonly string[];
  readonly confidence: number;
  readonly rationale: string;
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
              <Badge colorPalette="green">
                One target: {summary.proposedOne}
              </Badge>
              <Badge colorPalette="gray">
                No route: {summary.proposedZero}
              </Badge>
              <Badge colorPalette="orange">
                Mixed client: {summary.proposedMixed}
              </Badge>
            </Flex>
            <Box
              aria-label="Classification review table"
              overflowX="auto"
              tabIndex={0}
            >
              <Table.Root minW="760px">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Channel</Table.ColumnHeader>
                    <Table.ColumnHeader>Proposal</Table.ColumnHeader>
                    <Table.ColumnHeader>Evidence</Table.ColumnHeader>
                    <Table.ColumnHeader>Allowed actions</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {items.map((item) => (
                    <Table.Row key={item.decisionKey}>
                      <Table.Cell>{item.channelName}</Table.Cell>
                      <Table.Cell>
                        <Stack gap="1">
                          <Text fontWeight="medium">{proposalLabel(item)}</Text>
                          <Text color="gray.600" fontSize="sm">
                            Confidence {Math.round(item.confidence * 100)}% is
                            diagnostic only.
                          </Text>
                        </Stack>
                      </Table.Cell>
                      <Table.Cell>{item.evidenceQuotes.join(" • ")}</Table.Cell>
                      <Table.Cell>
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
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>
          </Stack>
        )}
      </Card.Body>
    </Card.Root>
  );
}

const proposalLabel = (item: ClassificationReviewItem): string => {
  if (item.state === "proposed_mixed") {
    return "Mixed client — no route in V1";
  }
  if (item.state === "proposed_zero") {
    return "No route";
  }
  return item.proposedBrainName ?? "Allowed target required";
};
