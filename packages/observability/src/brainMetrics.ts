export type BrainOperationSubsystem =
  | "capture"
  | "backfill"
  | "classification"
  | "maintenance"
  | "ask"
  | "slackDelivery"
  | "mcp"
  | "export"
  | "lifecycle";

export type BrainMetricStatus = "ok" | "degraded" | "blocked";

export type BrainMetric = {
  readonly subsystem: BrainOperationSubsystem;
  readonly measuredAt: string;
  readonly status: BrainMetricStatus;
  readonly workspaceId?: string;
  readonly brainKey?: string;
  readonly connectionId?: string;
  readonly channelId?: string;
  readonly sourceHash?: string;
  readonly evalVersion?: string;
  readonly count?: number;
  readonly durationMs?: number;
  readonly lagMs?: number;
  readonly queueDepth?: number;
  readonly leaseCount?: number;
  readonly deadLetterCount?: number;
  readonly spendCents?: number;
  readonly tokenCount?: number;
  readonly storageBytes?: number;
  readonly errorTag?: string;
};

export type BrainBudget =
  | "modelTokens"
  | "modelSpendCents"
  | "slackRate"
  | "storageBytes"
  | "queueDepth"
  | "channelCount";

export type BrainBudgetLimits = Partial<Record<BrainBudget, number>>;

export type BrainBudgetResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly errorTag: "BudgetExceeded";
      readonly budget: BrainBudget;
      readonly limit: number;
      readonly observed: number;
    };

const redactedMetricFields = [
  "authorization",
  "headers",
  "input",
  "inputText",
  "password",
  "prompt",
  "raw",
  "refreshToken",
  "secret",
  "source",
  "sourceText",
  "token",
] as const;

const metricKeys = [
  "subsystem",
  "measuredAt",
  "status",
  "workspaceId",
  "brainKey",
  "connectionId",
  "channelId",
  "sourceHash",
  "evalVersion",
  "count",
  "durationMs",
  "lagMs",
  "queueDepth",
  "leaseCount",
  "deadLetterCount",
  "spendCents",
  "tokenCount",
  "storageBytes",
  "errorTag",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRedactedMetricField = (field: string): boolean =>
  redactedMetricFields.includes(field as (typeof redactedMetricFields)[number]);

export const redactBrainMetricPayload = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactBrainMetricPayload);
  if (!isRecord(value)) return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = isRedactedMetricField(key)
      ? "[redacted]"
      : redactBrainMetricPayload(nested);
  }

  return redacted;
};

export const createBrainMetric = (
  input: Readonly<Record<string, unknown>>,
): BrainMetric => {
  const redacted = redactBrainMetricPayload(input) as Record<string, unknown>;
  const metric: Record<string, unknown> = {};

  for (const key of metricKeys) {
    if (redacted[key] !== undefined) metric[key] = redacted[key];
  }

  return metric as BrainMetric;
};

export const enforceBrainBudget = (
  budget: BrainBudget,
  observed: number,
  limits: BrainBudgetLimits,
): BrainBudgetResult => {
  const limit = limits[budget];
  if (limit === undefined || observed <= limit) return { ok: true };

  return { ok: false, errorTag: "BudgetExceeded", budget, limit, observed };
};
