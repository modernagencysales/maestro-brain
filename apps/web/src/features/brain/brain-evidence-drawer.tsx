import { Badge, Button, Card, HStack, Stack, Text } from "@saas-ui/react";

export function BrainEvidenceDrawer({
  citations,
  freshness,
  revisionLabel,
}: {
  readonly citations: readonly string[];
  readonly freshness: string;
  readonly revisionLabel: string;
}) {
  return (
    <Card.Root borderRadius="md" h="100%">
      <Card.Header>
        <HStack justify="space-between">
          <Text fontWeight="semibold">Evidence and history</Text>
          <Badge colorPalette="blue">{freshness}</Badge>
        </HStack>
      </Card.Header>
      <Card.Body pt="0">
        <Stack gap="3">
          <Button
            display={{ base: "inline-flex", xl: "none" }}
            variant="outline"
          >
            Mobile evidence drawer
          </Button>
          <Text color="gray.600" fontSize="sm">
            Current revision: {revisionLabel}
          </Text>
          {citations.map((citation) => (
            <Badge alignSelf="flex-start" colorPalette="gray" key={citation}>
              {citation}
            </Badge>
          ))}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
