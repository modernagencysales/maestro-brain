import { createHash } from "node:crypto";

export type ActionTargetKind = "email" | "crm" | "webhook" | "notion" | "api";

export type ActionJobStatus = "queued" | "waiting_for_approval";

export type ActionJob = {
  readonly jobId: string;
  readonly workspaceId: string;
  readonly workflowRunId: string;
  readonly capabilityId: string;
  readonly targetKind: ActionTargetKind;
  readonly targetRef: string;
  readonly payloadHash: string;
  readonly approvalPolicyId: string | undefined;
  readonly safeModeExemptionReason: string | undefined;
  readonly status: ActionJobStatus;
  readonly createdAt: string;
};

export type ReviewLinkToken = {
  readonly approvalId: string;
  readonly workspaceId: string;
  readonly reviewerId: string;
  readonly tokenHash: string;
  readonly scope: "action:approve" | "action:review";
  readonly expiresAt: string;
  readonly createdAt: string;
};

export type ActionTriggerKind = "refresh" | "publish" | "sync";

export type ActionTrigger = {
  readonly triggerId: string;
  readonly workspaceId: string;
  readonly actionKind: ActionTriggerKind;
  readonly schedule: string;
  readonly capabilityId: string;
  readonly configHash: string;
  readonly enabled: boolean;
  readonly idempotencyKey: string;
  readonly createdAt: string;
};

export type ActionDigestPayload = {
  readonly digestId: string;
  readonly workspaceId: string;
  readonly recipientId: string;
  readonly subject: string;
  readonly body: string;
  readonly dedupeKey: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
};

export class ActionValidationError extends Error {
  readonly _tag = "ActionValidationError";

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "ActionValidationError";
  }
}

const requireNonEmpty = (field: string, value: string): void => {
  if (!value.trim()) {
    throw new ActionValidationError(field, `${field} is required.`);
  }
};

const requireNonNegativeInteger = (field: string, value: number): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new ActionValidationError(
      field,
      `${field} must be a non-negative integer.`,
    );
  }
};

const actionTargetKinds = new Set<ActionTargetKind>([
  "email",
  "crm",
  "webhook",
  "notion",
  "api",
]);

const actionTriggerKinds = new Set<ActionTriggerKind>([
  "refresh",
  "publish",
  "sync",
]);

const assertTargetKind = (targetKind: string): ActionTargetKind => {
  if (!actionTargetKinds.has(targetKind as ActionTargetKind)) {
    throw new ActionValidationError(
      "targetKind",
      "action target kind is invalid.",
    );
  }

  return targetKind as ActionTargetKind;
};

const assertTriggerKind = (actionKind: string): ActionTriggerKind => {
  if (!actionTriggerKinds.has(actionKind as ActionTriggerKind)) {
    throw new ActionValidationError(
      "actionKind",
      "action trigger kind is invalid.",
    );
  }

  return actionKind as ActionTriggerKind;
};

const assertScope = (scope: string): "action:approve" | "action:review" => {
  if (scope !== "action:approve" && scope !== "action:review") {
    throw new ActionValidationError("scope", "review token scope is invalid.");
  }

  return scope;
};

const hashSecret = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const urlSafeKeyPart = (value: string): string =>
  Array.from(value)
    .map((char) => {
      if (/^[A-Za-z0-9._-]$/.test(char)) {
        return char;
      }

      if (char === "~") {
        return "~~";
      }

      return `~${char.codePointAt(0)?.toString(16) ?? "0"}~`;
    })
    .join("");

const actionKey = (prefix: string, parts: readonly string[]): string =>
  [prefix, ...parts.map(urlSafeKeyPart)].join(".");

export const createActionJob = (input: {
  readonly jobId: string;
  readonly workspaceId: string;
  readonly workflowRunId: string;
  readonly capabilityId: string;
  readonly targetKind: string;
  readonly targetRef: string;
  readonly payloadHash: string;
  readonly approvalPolicyId: string | undefined;
  readonly safeModeExemptionReason: string | undefined;
  readonly createdAt: string;
}): ActionJob => {
  requireNonEmpty("jobId", input.jobId);
  requireNonEmpty("workspaceId", input.workspaceId);
  requireNonEmpty("workflowRunId", input.workflowRunId);
  requireNonEmpty("capabilityId", input.capabilityId);
  requireNonEmpty("targetRef", input.targetRef);
  requireNonEmpty("payloadHash", input.payloadHash);

  const approvalPolicyId = input.approvalPolicyId?.trim() || undefined;
  const safeModeExemptionReason =
    input.safeModeExemptionReason?.trim() || undefined;

  if (!approvalPolicyId && !safeModeExemptionReason) {
    throw new ActionValidationError(
      "approvalPolicyId",
      "publish jobs require an approval policy or explicit safe-mode exemption.",
    );
  }

  return {
    jobId: input.jobId,
    workspaceId: input.workspaceId,
    workflowRunId: input.workflowRunId,
    capabilityId: input.capabilityId,
    targetKind: assertTargetKind(input.targetKind),
    targetRef: input.targetRef,
    payloadHash: input.payloadHash,
    approvalPolicyId,
    safeModeExemptionReason,
    status: approvalPolicyId ? "waiting_for_approval" : "queued",
    createdAt: input.createdAt,
  };
};

export const createReviewLinkToken = (input: {
  readonly approvalId: string;
  readonly workspaceId: string;
  readonly reviewerId: string;
  readonly rawToken: string;
  readonly scope: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}): ReviewLinkToken => {
  requireNonEmpty("approvalId", input.approvalId);
  requireNonEmpty("workspaceId", input.workspaceId);
  requireNonEmpty("reviewerId", input.reviewerId);
  requireNonEmpty("rawToken", input.rawToken);
  requireNonEmpty("expiresAt", input.expiresAt);

  return {
    approvalId: input.approvalId,
    workspaceId: input.workspaceId,
    reviewerId: input.reviewerId,
    tokenHash: hashSecret(input.rawToken),
    scope: assertScope(input.scope),
    expiresAt: input.expiresAt,
    createdAt: input.createdAt,
  };
};

export const configureActionTrigger = (input: {
  readonly triggerId: string;
  readonly workspaceId: string;
  readonly actionKind: string;
  readonly schedule: string;
  readonly capabilityId: string;
  readonly configHash: string;
  readonly enabled: boolean;
  readonly createdAt: string;
}): ActionTrigger => {
  requireNonEmpty("triggerId", input.triggerId);
  requireNonEmpty("workspaceId", input.workspaceId);
  requireNonEmpty("schedule", input.schedule);
  requireNonEmpty("capabilityId", input.capabilityId);
  requireNonEmpty("configHash", input.configHash);

  return {
    triggerId: input.triggerId,
    workspaceId: input.workspaceId,
    actionKind: assertTriggerKind(input.actionKind),
    schedule: input.schedule,
    capabilityId: input.capabilityId,
    configHash: input.configHash,
    enabled: input.enabled,
    idempotencyKey: actionKey("action-trigger", [
      input.workspaceId,
      input.triggerId,
      input.configHash,
    ]),
    createdAt: input.createdAt,
  };
};

export const buildActionDigestPayload = (input: {
  readonly digestId: string;
  readonly workspaceId: string;
  readonly recipientId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly jobsQueued: number;
  readonly approvalsWaiting: number;
  readonly actionsPublished: number;
  readonly providerMetadata: Readonly<Record<string, unknown>>;
  readonly customerMetadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}): ActionDigestPayload => {
  requireNonEmpty("digestId", input.digestId);
  requireNonEmpty("workspaceId", input.workspaceId);
  requireNonEmpty("recipientId", input.recipientId);
  requireNonEmpty("periodStart", input.periodStart);
  requireNonEmpty("periodEnd", input.periodEnd);
  requireNonNegativeInteger("jobsQueued", input.jobsQueued);
  requireNonNegativeInteger("approvalsWaiting", input.approvalsWaiting);
  requireNonNegativeInteger("actionsPublished", input.actionsPublished);

  return {
    digestId: input.digestId,
    workspaceId: input.workspaceId,
    recipientId: input.recipientId,
    subject: `Action digest: ${input.jobsQueued} queued, ${input.approvalsWaiting} waiting, ${input.actionsPublished} published`,
    body: `Your audited action queue has ${input.jobsQueued} queued jobs, ${input.approvalsWaiting} approvals waiting, and ${input.actionsPublished} published action.`,
    dedupeKey: actionKey("action-digest", [
      input.workspaceId,
      input.recipientId,
      input.periodStart,
      input.periodEnd,
    ]),
    metadata: {
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      jobsQueued: input.jobsQueued,
      approvalsWaiting: input.approvalsWaiting,
      actionsPublished: input.actionsPublished,
      providerMetadata: "[redacted]",
      customerMetadata: "[redacted]",
    },
    createdAt: input.createdAt,
  };
};
