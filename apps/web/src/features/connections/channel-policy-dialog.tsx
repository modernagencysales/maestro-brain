import { Badge, Button, Card, Stack, Text } from "@saas-ui/react";

import { buildChannelPolicyDialogState } from "./channel-policy-view-model";

export function ChannelPolicyDialogSummary({
  clientBrainCount,
  selectedChannelCount,
}: {
  readonly clientBrainCount: number;
  readonly selectedChannelCount: number;
}) {
  const state = buildChannelPolicyDialogState({
    clientBrainCount,
    selectedChannelCount,
  });
  return (
    <Card.Root borderRadius="md">
      <Card.Body>
        <Stack gap="3">
          <Badge
            alignSelf="flex-start"
            colorPalette={state.canSubmit ? "green" : "red"}
          >
            Bulk policy control
          </Badge>
          <Text>{state.channelCapacityLabel}</Text>
          <Text>{state.targetCapacityLabel}</Text>
          {state.warnings.map((warning) => (
            <Text color="red.600" key={warning}>
              {warning}
            </Text>
          ))}
          <Button disabled={!state.canSubmit}>Apply channel policies</Button>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
