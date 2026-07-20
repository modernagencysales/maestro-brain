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
          <Stack gap="2">
            <Text fontWeight="semibold">Routing policy</Text>
            {state.controls.routingModes.map((mode) => (
              <label key={mode.value}>
                <input name="routing-policy" type="radio" value={mode.value} />{" "}
                {mode.label}
              </label>
            ))}
          </Stack>
          <Stack gap="2">
            <Text fontWeight="semibold">Target Brain allowlist</Text>
            <Text color="gray.600" fontSize="sm">
              {state.controls.targetBrainHelper}
            </Text>
            <input
              aria-label="Target Brain allowlist"
              placeholder="brain_client_a, brain_client_b"
            />
          </Stack>
          <Stack gap="2">
            <Text fontWeight="semibold">Delivery policy</Text>
            {state.controls.deliveryModes.map((mode) => (
              <label key={mode.value}>
                <input name="delivery-policy" type="radio" value={mode.value} />{" "}
                {mode.label}
              </label>
            ))}
          </Stack>
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
