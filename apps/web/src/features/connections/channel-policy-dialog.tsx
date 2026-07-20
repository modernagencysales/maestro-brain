import { Badge, Button, Card, Stack, Text } from "@saas-ui/react";

import {
  buildChannelPolicyDialogState,
  type ChannelPolicyDeliveryInput,
  type ChannelPolicyRoutingInput,
} from "./channel-policy-view-model";

export function ChannelPolicyDialogSummary({
  clientBrainCount,
  deliveryMode,
  onApply,
  onDeliveryModeChange,
  onRoutingModeChange,
  onTargetBrainKeysChange,
  routingMode,
  selectedChannelCount,
  targetBrainKeys,
}: {
  readonly clientBrainCount: number;
  readonly deliveryMode: ChannelPolicyDeliveryInput;
  readonly onApply?: () => void;
  readonly onDeliveryModeChange?: (mode: ChannelPolicyDeliveryInput) => void;
  readonly onRoutingModeChange?: (mode: ChannelPolicyRoutingInput) => void;
  readonly onTargetBrainKeysChange?: (brainKeys: readonly string[]) => void;
  readonly routingMode: ChannelPolicyRoutingInput;
  readonly selectedChannelCount: number;
  readonly targetBrainKeys: readonly string[];
}) {
  const state = buildChannelPolicyDialogState({
    clientBrainCount,
    deliveryMode,
    routingMode,
    selectedChannelCount,
    targetBrainKeys,
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
                <input
                  checked={routingMode === mode.value}
                  name="routing-policy"
                  onChange={() => onRoutingModeChange?.(mode.value)}
                  type="radio"
                  value={mode.value}
                />{" "}
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
              onChange={(event) =>
                onTargetBrainKeysChange?.(
                  event.currentTarget.value
                    .split(",")
                    .map((brainKey) => brainKey.trim())
                    .filter(Boolean),
                )
              }
              placeholder="brain_client_a, brain_client_b"
              value={targetBrainKeys.join(", ")}
            />
          </Stack>
          <Stack gap="2">
            <Text fontWeight="semibold">Delivery policy</Text>
            {state.controls.deliveryModes.map((mode) => (
              <label key={mode.value}>
                <input
                  checked={deliveryMode === mode.value}
                  name="delivery-policy"
                  onChange={() => onDeliveryModeChange?.(mode.value)}
                  type="radio"
                  value={mode.value}
                />{" "}
                {mode.label}
              </label>
            ))}
          </Stack>
          {state.warnings.map((warning) => (
            <Text color="red.600" key={warning}>
              {warning}
            </Text>
          ))}
          <Button disabled={!state.canSubmit} onClick={onApply}>
            Apply channel policies
          </Button>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
