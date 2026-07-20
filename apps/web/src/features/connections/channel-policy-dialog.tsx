import { useState } from "react";

import type { Ref } from "@confect/core";
import { templateConfectRefs } from "@maestro-template/convex/refs";
import { Badge, Button, Card, Heading, Stack, Text } from "@saas-ui/react";

import { useTemplateMutation } from "../../adapters/confect-state";

import {
  buildChannelPolicyDialogState,
  buildChannelPolicyRows,
  buildChannelPolicySubmitRequest,
  type ChannelPolicyDeliveryInput,
  type ChannelPolicyRoutingInput,
} from "./channel-policy-view-model";
import { ChannelTable } from "./channel-table";
import { localChannelPolicyFixture } from "./connections-adapter";

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

type BulkSetChannelPolicies = (
  request: ReturnType<typeof buildChannelPolicySubmitRequest>,
) => Promise<unknown> | unknown;

type ChannelPolicyConfectRefs = {
  readonly public: {
    readonly slack?: {
      readonly channelPolicies: {
        readonly bulkSetChannelPolicies: Ref.AnyPublicMutation;
      };
    };
  };
};

const channelPolicyGeneratedRefPendingIntegration = {
  functionNamespace: "slack/channelPolicies",
  functionSpec: { name: "bulkSetChannelPolicies" },
} as unknown as Ref.AnyPublicMutation;

export function ChannelPolicyCard({
  bulkSetChannelPolicies,
}: {
  readonly bulkSetChannelPolicies?: BulkSetChannelPolicies;
} = {}) {
  const [selectedChannelKeys, setSelectedChannelKeys] = useState<
    readonly string[]
  >(localChannelPolicyFixture.channels.map((channel) => channel.channelKey));
  const [routingMode, setRoutingMode] =
    useState<ChannelPolicyRoutingInput>("direct");
  const [deliveryMode, setDeliveryMode] =
    useState<ChannelPolicyDeliveryInput>("requester_private");
  const [targetBrainKeys, setTargetBrainKeys] = useState<readonly string[]>(
    localChannelPolicyFixture.defaultTargetBrainKeys,
  );
  const [lastSubmission, setLastSubmission] = useState<string | null>(null);
  const generatedBulkSetChannelPoliciesRef = (
    templateConfectRefs as ChannelPolicyConfectRefs
  ).public.slack?.channelPolicies.bulkSetChannelPolicies;
  const generatedBulkSetChannelPolicies = useTemplateMutation(
    generatedBulkSetChannelPoliciesRef ??
      channelPolicyGeneratedRefPendingIntegration,
  );
  const applyBulkSetChannelPolicies =
    bulkSetChannelPolicies ?? generatedBulkSetChannelPolicies;

  const submit = () => {
    const request = buildChannelPolicySubmitRequest({
      organizationKey: localChannelPolicyFixture.organizationKey,
      expectedConnectionGeneration:
        localChannelPolicyFixture.expectedConnectionGeneration,
      expectedChannelAccessGeneration:
        localChannelPolicyFixture.expectedChannelAccessGeneration,
      channels: localChannelPolicyFixture.channels,
      selectedChannelKeys,
      routingMode,
      targetBrainKeys,
      deliveryMode,
    });
    void applyBulkSetChannelPolicies(request);
    setLastSubmission(
      `${request.changes.length} channel policy change${
        request.changes.length === 1 ? "" : "s"
      } submitted to bulkSetChannelPolicies`,
    );
  };

  return (
    <Card.Root borderRadius="md">
      <Card.Header>
        <Heading size="md">Slack channel policies</Heading>
        <Text color="gray.600" fontSize="sm">
          Bulk-select joined channels and apply immutable routing and delivery
          policies.
        </Text>
      </Card.Header>
      <Card.Body>
        <Stack gap="4">
          <ChannelTable
            onSelectionChange={(channelKey, selected) =>
              setSelectedChannelKeys((current) =>
                selected
                  ? [...new Set([...current, channelKey])]
                  : current.filter((key) => key !== channelKey),
              )
            }
            rows={buildChannelPolicyRows(
              localChannelPolicyFixture.channels,
              selectedChannelKeys,
            )}
          />
          <ChannelPolicyDialogSummary
            clientBrainCount={localChannelPolicyFixture.clientBrainCount}
            deliveryMode={deliveryMode}
            onApply={submit}
            onDeliveryModeChange={setDeliveryMode}
            onRoutingModeChange={setRoutingMode}
            onTargetBrainKeysChange={setTargetBrainKeys}
            routingMode={routingMode}
            selectedChannelCount={selectedChannelKeys.length}
            targetBrainKeys={targetBrainKeys}
          />
          {lastSubmission ? (
            <Text color="green.700" fontSize="sm">
              {lastSubmission}
            </Text>
          ) : null}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
