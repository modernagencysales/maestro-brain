import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../_generated/schema";
import { sha256Hex } from "../shared/sha256";
import actions from "./actions.spec";

const now = 1_700_000_000_000;

// node:crypto is unavailable in the Convex isolate runtime.
const hashSecret = (value: string): string => `sha256:${sha256Hex(value)}`;

const enqueueAction = FunctionImpl.make(
  databaseSchema,
  actions,
  "enqueueAction",
  (input) =>
    Effect.succeed({
      jobId: `action_job_${input.workflowRunId}`,
      workspaceId: input.workspaceId,
      workflowRunId: input.workflowRunId,
      capabilityId: input.capabilityId,
      targetKind: input.targetKind,
      targetRef: input.targetRef,
      payloadHash: input.payloadHash,
      approvalPolicyId: input.approvalPolicyId,
      safeModeExemptionReason: input.safeModeExemptionReason,
      status: input.approvalPolicyId
        ? ("waiting_for_approval" as const)
        : ("queued" as const),
      createdAt: now,
    }),
);

const approveAction = FunctionImpl.make(
  databaseSchema,
  actions,
  "approveAction",
  (input) =>
    Effect.succeed({
      approvalId: input.approvalId,
      workspaceId: input.workspaceId,
      jobId: `action_job_${input.approvalId}`,
      reviewerId: input.reviewerId,
      tokenHash: hashSecret(input.rawToken),
      scope: "action:approve" as const,
      status: "approved" as const,
      expiresAt: input.now + 86_400_000,
      createdAt: now,
      reviewedAt: input.now,
    }),
);

const configureTrigger = FunctionImpl.make(
  databaseSchema,
  actions,
  "configureTrigger",
  (input) =>
    Effect.succeed({
      triggerId: input.triggerId,
      workspaceId: input.workspaceId,
      actionKind: input.actionKind,
      schedule: input.schedule,
      capabilityId: input.capabilityId,
      configHash: input.configHash,
      enabled: input.enabled,
      idempotencyKey: `action-trigger:${input.workspaceId}:${input.triggerId}:${input.configHash}`,
      createdAt: now,
    }),
);

const sendDigest = FunctionImpl.make(
  databaseSchema,
  actions,
  "sendDigest",
  (input) =>
    Effect.succeed({
      digestId: `digest_${input.workspaceId}_${input.recipientId}`,
      workspaceId: input.workspaceId,
      recipientId: input.recipientId,
      subject: `Action digest: ${input.jobsQueued} queued, ${input.approvalsWaiting} waiting, ${input.actionsPublished} published`,
      body: `Your audited action queue has ${input.jobsQueued} queued jobs, ${input.approvalsWaiting} approvals waiting, and ${input.actionsPublished} published action.`,
      dedupeKey: `action-digest:${input.workspaceId}:${input.recipientId}:${input.periodStart}:${input.periodEnd}`,
      metadata: {
        providerMetadata: "[redacted]" as const,
        customerMetadata: "[redacted]" as const,
      },
      createdAt: now,
      sentAt: now,
    }),
);

export default GroupImpl.make(databaseSchema, actions).pipe(
  Layer.provide(enqueueAction),
  Layer.provide(approveAction),
  Layer.provide(configureTrigger),
  Layer.provide(sendDigest),
  GroupImpl.finalize,
);
