import type { PostHogEvent } from "./index";

export const brainMetricNames = [
  "source_lag",
  "queue_depth",
  "lease_age",
  "dead_letter_count",
  "model_spend_cents",
  "model_tokens",
  "ask_abstention",
  "ask_error",
  "outbox_ambiguity",
  "export_state",
  "capacity_use",
] as const;

export type BrainMetricName = (typeof brainMetricNames)[number];

export type BrainMetricInput = Readonly<{
  readonly metric: BrainMetricName;
  readonly value: number;
  readonly unit: "count" | "milliseconds" | "cents" | "tokens" | "bytes";
  readonly distinctId?: string;
  readonly workspaceId?: string;
  readonly subsystem?: string;
  readonly state?: string;
  readonly errorTag?: string;
  readonly generation?: number;
}>;

export const createBrainMetricEvent = (
  input: BrainMetricInput,
): PostHogEvent => ({
  event: "maestro.brain.metric",
  distinctId: input.distinctId ?? "system",
  properties: {
    metric: input.metric,
    value: input.value,
    unit: input.unit,
    ...(input.workspaceId === undefined
      ? {}
      : { workspaceId: input.workspaceId }),
    ...(input.subsystem === undefined ? {} : { subsystem: input.subsystem }),
    ...(input.state === undefined ? {} : { state: input.state }),
    ...(input.errorTag === undefined ? {} : { errorTag: input.errorTag }),
    ...(input.generation === undefined ? {} : { generation: input.generation }),
  },
});
