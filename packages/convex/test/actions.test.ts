import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import actionsImpl from "../confect/ops/actions.impl";
import actions, {
  ActionApprovalReturn,
  ActionDigestReturn,
  ActionError,
  ActionJobReturn,
  ActionTriggerReturn,
  ApproveActionArgs,
  ConfigureTriggerArgs,
  EnqueueActionArgs,
  SendDigestArgs,
} from "../confect/ops/actions.spec";
import actionApprovals from "../confect/tables/actionApprovals";
import actionDigests from "../confect/tables/actionDigests";
import actionJobs from "../confect/tables/actionJobs";
import actionTriggers from "../confect/tables/actionTriggers";

describe("action Confect contracts", () => {
  it("declares action job, approval, trigger, and digest tables", () => {
    expect(actionJobs.indexes).toMatchObject({
      by_workspace: ["workspaceId"],
      by_workflow_run: ["workspaceId", "workflowRunId"],
      by_status: ["workspaceId", "status"],
    });
    expect(actionApprovals.indexes).toMatchObject({
      by_workspace: ["workspaceId"],
      by_job: ["workspaceId", "jobId"],
      by_token_hash: ["tokenHash"],
    });
    expect(actionTriggers.indexes).toMatchObject({
      by_workspace: ["workspaceId"],
      by_idempotency_key: ["workspaceId", "idempotencyKey"],
    });
    expect(actionDigests.indexes).toMatchObject({
      by_workspace: ["workspaceId"],
      by_recipient: ["workspaceId", "recipientId"],
      by_dedupe_key: ["workspaceId", "dedupeKey"],
    });
  });

  it("validates enqueue, approve, trigger, and digest args with Effect schemas", () => {
    expect(
      Schema.decodeUnknownSync(EnqueueActionArgs)({
        workspaceId: "workspace_123",
        workflowRunId: "run_001",
        capabilityId: "cap_publish_email",
        targetKind: "email",
        targetRef: "campaign_follow_up",
        payloadHash: "sha256:payload",
        approvalPolicyId: "policy_approval_required",
      }),
    ).toMatchObject({ targetKind: "email" });

    expect(
      Schema.decodeUnknownSync(ApproveActionArgs)({
        workspaceId: "workspace_123",
        approvalId: "approval_001",
        reviewerId: "user_reviewer",
        rawToken: "secret-review-token",
        now: 1_700_000_000_000,
      }),
    ).toMatchObject({ approvalId: "approval_001" });

    expect(
      Schema.decodeUnknownSync(ConfigureTriggerArgs)({
        workspaceId: "workspace_123",
        triggerId: "trigger_daily_refresh",
        actionKind: "refresh",
        schedule: "0 9 * * 1-5",
        capabilityId: "cap_refresh_context",
        configHash: "sha256:trigger-config",
        enabled: true,
      }),
    ).toMatchObject({ actionKind: "refresh" });

    expect(
      Schema.decodeUnknownSync(SendDigestArgs)({
        workspaceId: "workspace_123",
        recipientId: "user_ops",
        periodStart: 1,
        periodEnd: 2,
        jobsQueued: 5,
        approvalsWaiting: 2,
        actionsPublished: 1,
      }),
    ).toMatchObject({ recipientId: "user_ops" });
  });

  it("declares action return schemas with redacted public boundaries", () => {
    expect(
      Schema.decodeUnknownSync(ActionJobReturn)({
        jobId: "action_job_001",
        workspaceId: "workspace_123",
        workflowRunId: "run_001",
        capabilityId: "cap_publish_email",
        targetKind: "email",
        targetRef: "campaign_follow_up",
        payloadHash: "sha256:payload",
        approvalPolicyId: "policy_approval_required",
        safeModeExemptionReason: undefined,
        status: "waiting_for_approval",
        createdAt: 1,
      }),
    ).toMatchObject({ status: "waiting_for_approval" });

    expect(
      Schema.decodeUnknownSync(ActionApprovalReturn)({
        approvalId: "approval_001",
        workspaceId: "workspace_123",
        jobId: "action_job_001",
        reviewerId: "user_reviewer",
        tokenHash: "sha256:token",
        scope: "action:approve",
        status: "approved",
        expiresAt: 2,
        createdAt: 1,
        reviewedAt: 2,
      }),
    ).toMatchObject({ tokenHash: "sha256:token" });

    expect(
      Schema.decodeUnknownSync(ActionTriggerReturn)({
        triggerId: "trigger_daily_refresh",
        workspaceId: "workspace_123",
        actionKind: "refresh",
        schedule: "0 9 * * 1-5",
        capabilityId: "cap_refresh_context",
        configHash: "sha256:trigger-config",
        enabled: true,
        idempotencyKey:
          "action-trigger:workspace_123:trigger_daily_refresh:sha256:trigger-config",
        createdAt: 1,
      }),
    ).toMatchObject({ enabled: true });

    const digest = Schema.decodeUnknownSync(ActionDigestReturn)({
      digestId: "digest_001",
      workspaceId: "workspace_123",
      recipientId: "user_ops",
      subject: "Action digest",
      body: "Queue summary",
      dedupeKey: "action-digest:workspace_123:user_ops:1:2",
      metadata: {
        providerMetadata: "[redacted]",
        customerMetadata: "[redacted]",
      },
      createdAt: 1,
      sentAt: 1,
    });

    expect(JSON.stringify(digest)).not.toContain("buyer@example.com");
  });

  it("declares public-safe typed action errors", () => {
    const encoded = [
      new ActionError.ApprovalRequired({ jobId: "action_job_001" }),
      new ActionError.TokenExpired({ approvalId: "approval_001" }),
      new ActionError.Unauthorized({ reason: "reviewer mismatch" }),
      new ActionError.ValidationFailed({
        field: "payloadHash",
        message: "payloadHash is required.",
      }),
    ].map((error) => Schema.encodeSync(ActionError.Schema)(error));

    expect(encoded.map((error) => error._tag)).toEqual([
      "ApprovalRequired",
      "TokenExpired",
      "Unauthorized",
      "ValidationFailed",
    ]);
    expect(JSON.stringify(encoded)).not.toContain("secret-review-token");
  });

  it("registers public Confect action functions", () => {
    const serialized = JSON.stringify(actions);

    expect(serialized).toContain("enqueueAction");
    expect(serialized).toContain("approveAction");
    expect(serialized).toContain("configureTrigger");
    expect(serialized).toContain("sendDigest");
    expect(serialized).toContain("public");
  });

  it("exports a finalized fake/local Confect implementation", () => {
    expect(actionsImpl).toMatchObject({
      _op_layer: "Fold",
    });
  });
});
