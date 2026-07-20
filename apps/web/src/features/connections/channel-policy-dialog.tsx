import { useEffect, useMemo, useState } from "react";
import type { Ref } from "@confect/core";
import { templateConfectRefs } from "@maestro-template/convex/refs";
import { Badge, Button, Card, Heading, Stack, Text } from "@saas-ui/react";
import {
  useTemplateMutation,
  useTemplateQuery,
} from "../../adapters/confect-state";
import { isConvexConfigured } from "../../env";
import { useWorkspace } from "../../providers/workspace";
import {
  buildChannelPolicyDialogState,
  buildChannelPolicyRows,
  buildChannelPolicySubmitRequest,
  type ChannelPolicyDeliveryInput,
  type ChannelPolicyRoutingInput,
} from "./channel-policy-view-model";
import { ChannelTable } from "./channel-table";
import {
  buildChannelPolicyAdapterState,
  type ChannelPolicyAdapterState,
} from "./connections-adapter";

type PendingChannelPolicyRefs = {
  readonly getChannelPolicyReadModel: Ref.AnyPublicQuery;
  readonly bulkSetChannelPolicies: Ref.AnyPublicMutation;
};
const channelPolicyRefs = (
  templateConfectRefs.public as typeof templateConfectRefs.public & {
    readonly slack?: { readonly channelPolicies?: PendingChannelPolicyRefs };
  }
).slack?.channelPolicies;
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
const emptyChannelPolicyState = (
  organizationKey: string,
): ChannelPolicyAdapterState => ({
  organizationKey,
  expectedConnectionGeneration: 0,
  expectedChannelAccessGeneration: 0,
  selectedChannelCount: 0,
  clientBrainCount: 0,
  defaultTargetBrainKeys: [],
  channels: [],
});
function ChannelPolicyUnavailableCard() {
  return (
    <Card.Root borderRadius="md">
      <Card.Header>
        <Heading size="md">Slack channel policies</Heading>
        <Text color="gray.600" fontSize="sm">
          Channel policy controls are waiting for centralized Confect ref
          generation.
        </Text>
      </Card.Header>
    </Card.Root>
  );
}
export function ChannelPolicyCard({
  bulkSetChannelPolicies,
  initialState,
}: {
  readonly bulkSetChannelPolicies?: BulkSetChannelPolicies;
  readonly initialState?: ChannelPolicyAdapterState;
} = {}) {
  if (!channelPolicyRefs) return <ChannelPolicyUnavailableCard />;
  return (
    <ChannelPolicyCardWithRefs
      {...(bulkSetChannelPolicies ? { bulkSetChannelPolicies } : {})}
      {...(initialState ? { initialState } : {})}
      refs={channelPolicyRefs}
    />
  );
}
function ChannelPolicyCardWithRefs({
  bulkSetChannelPolicies,
  initialState,
  refs,
}: {
  readonly bulkSetChannelPolicies?: BulkSetChannelPolicies;
  readonly initialState?: ChannelPolicyAdapterState;
  readonly refs: PendingChannelPolicyRefs;
}) {
  const workspace = useWorkspace();
  const activeOrganizationKey =
    workspace.status === "ready"
      ? workspace.activeWorkspace.organizationId
      : "";
  const liveReadModel = useTemplateQuery(
    refs.getChannelPolicyReadModel,
    isConvexConfigured() && activeOrganizationKey !== ""
      ? { organizationKey: activeOrganizationKey }
      : "skip",
  );
  const policyState = useMemo(
    () =>
      initialState ??
      (workspace.status !== "ready" || liveReadModel.status !== "ready"
        ? emptyChannelPolicyState(activeOrganizationKey)
        : buildChannelPolicyAdapterState({
            activeWorkspace: workspace.activeWorkspace,
            channels: liveReadModel.data.channels,
            clientBrains: liveReadModel.data.clientBrains,
          })),
    [activeOrganizationKey, initialState, liveReadModel, workspace],
  );
  const [selectedChannelKeys, setSelectedChannelKeys] = useState<
    readonly string[]
  >([]);
  const [routingMode, setRoutingMode] =
    useState<ChannelPolicyRoutingInput>("direct");
  const [deliveryMode, setDeliveryMode] =
    useState<ChannelPolicyDeliveryInput>("requester_private");
  const [targetBrainKeys, setTargetBrainKeys] = useState<readonly string[]>([]);
  const [lastSubmission, setLastSubmission] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  useEffect(() => {
    setSelectedChannelKeys(
      policyState.channels.map((channel) => channel.channelKey),
    );
    setTargetBrainKeys(policyState.defaultTargetBrainKeys);
  }, [policyState]);
  const applyBulkSetChannelPolicies =
    bulkSetChannelPolicies ?? useTemplateMutation(refs.bulkSetChannelPolicies);
  const submit = async () => {
    setLastSubmission(null);
    setSubmissionError(null);
    const request = buildChannelPolicySubmitRequest({
      organizationKey: policyState.organizationKey,
      expectedConnectionGeneration: policyState.expectedConnectionGeneration,
      expectedChannelAccessGeneration:
        policyState.expectedChannelAccessGeneration,
      channels: policyState.channels,
      selectedChannelKeys,
      routingMode,
      targetBrainKeys,
      deliveryMode,
    });
    try {
      const result = await applyBulkSetChannelPolicies(request);
      setLastSubmission(
        `${request.changes.length} channel policy change${request.changes.length === 1 ? "" : "s"} applied by bulkSetChannelPolicies: ${JSON.stringify(result)}`,
      );
    } catch (error) {
      setSubmissionError(
        error instanceof Error ? error.message : "Channel policy update failed",
      );
    }
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
              policyState.channels,
              selectedChannelKeys,
            )}
          />
          <ChannelPolicyDialogSummary
            clientBrainCount={policyState.clientBrainCount}
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
          {submissionError ? (
            <Text color="red.700" fontSize="sm">
              {submissionError}
            </Text>
          ) : null}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
