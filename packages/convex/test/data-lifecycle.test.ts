import { describe, expect, it } from "vitest";
import {
  buildRetentionJobPlan,
  buildWorkspaceDsarPlan,
  buildWorkspaceDataLifecyclePlan,
  currentLifecycleResourceIds,
} from "../confect/ops/dataLifecycle";

describe("template data lifecycle plan", () => {
  it("enumerates export, retention, and delete hooks for current resources only", () => {
    const plan = buildWorkspaceDataLifecyclePlan({
      workspaceId: "workspace_123",
      requestedBy: "user_123",
      now: 1_700_000_000_000,
    });

    expect(plan.workspaceId).toBe("workspace_123");
    expect(plan.export.resources.map((resource) => resource.id)).toEqual(
      currentLifecycleResourceIds,
    );
    expect(plan.delete.resources.map((resource) => resource.id)).toEqual(
      currentLifecycleResourceIds,
    );
    expect(plan.retention.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "brainPages",
          action: "retain-until-workspace-delete",
        }),
        expect.objectContaining({
          resourceId: "documents",
          action: "retain-until-workspace-delete",
        }),
        expect.objectContaining({
          resourceId: "concepts",
          action: "retain-until-workspace-delete",
        }),
        expect.objectContaining({
          resourceId: "contextPacks",
          action: "retain-until-workspace-delete",
        }),
        expect.objectContaining({
          resourceId: "versionedEntries",
          action: "retain-audit-window",
        }),
        expect.objectContaining({
          resourceId: "versionFreshness",
          action: "retain-until-workspace-delete",
        }),
        expect.objectContaining({
          resourceId: "transformRuns",
          action: "retain-audit-window",
        }),
        expect.objectContaining({
          resourceId: "apiKeys",
          action: "hash-or-redact-on-export",
        }),
      ]),
    );
  });

  it("covers co-editing and source-backed knowledge resources", () => {
    const plan = buildWorkspaceDataLifecyclePlan({
      workspaceId: "workspace_123",
      requestedBy: "user_123",
      now: 1_700_000_000_000,
    });

    expect(currentLifecycleResourceIds).toEqual(
      expect.arrayContaining([
        "documents",
        "documentVersions",
        "documentAnnotations",
        "concepts",
        "claims",
        "citations",
        "contextPacks",
      ]),
    );
    expect(plan.export.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "documents", exportMode: "markdown" }),
        expect.objectContaining({ id: "claims", exportMode: "json" }),
        expect.objectContaining({ id: "citations", exportMode: "json" }),
      ]),
    );
    expect(plan.delete.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "contextPacks", deleteMode: "delete" }),
        expect.objectContaining({
          id: "documentVersions",
          deleteMode: "retain-audit",
        }),
      ]),
    );
  });

  it("covers reusable versioning history and freshness resources", () => {
    const plan = buildWorkspaceDataLifecyclePlan({
      workspaceId: "workspace_123",
      requestedBy: "user_123",
      now: 1_700_000_000_000,
    });

    expect(currentLifecycleResourceIds).toEqual(
      expect.arrayContaining(["versionedEntries", "versionFreshness"]),
    );
    expect(plan.export.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "versionedEntries",
          exportMode: "json",
          deleteMode: "retain-audit",
        }),
        expect.objectContaining({
          id: "versionFreshness",
          exportMode: "json",
          deleteMode: "delete",
        }),
      ]),
    );
  });

  it("covers traced transform resources", () => {
    const plan = buildWorkspaceDataLifecyclePlan({
      workspaceId: "workspace_123",
      requestedBy: "user_123",
      now: 1_700_000_000_000,
    });

    expect(currentLifecycleResourceIds).toEqual(
      expect.arrayContaining([
        "transformDefinitions",
        "transformRuns",
        "transformBlocks",
      ]),
    );
    expect(plan.export.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "transformDefinitions",
          exportMode: "json",
          deleteMode: "delete",
        }),
        expect.objectContaining({
          id: "transformRuns",
          exportMode: "json",
          deleteMode: "retain-audit",
        }),
        expect.objectContaining({
          id: "transformBlocks",
          exportMode: "json",
          deleteMode: "retain-audit",
        }),
      ]),
    );
  });

  it("covers audited action queue, approvals, triggers, and digests", () => {
    const plan = buildWorkspaceDataLifecyclePlan({
      workspaceId: "workspace_123",
      requestedBy: "user_123",
      now: 1_700_000_000_000,
    });

    expect(currentLifecycleResourceIds).toEqual(
      expect.arrayContaining([
        "actionJobs",
        "actionApprovals",
        "actionTriggers",
        "actionDigests",
      ]),
    );
    expect(plan.export.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "actionJobs",
          exportMode: "json",
          deleteMode: "retain-audit",
        }),
        expect.objectContaining({
          id: "actionApprovals",
          exportMode: "redacted-json",
          deleteMode: "retain-audit",
        }),
        expect.objectContaining({
          id: "actionTriggers",
          exportMode: "json",
          deleteMode: "delete",
        }),
        expect.objectContaining({
          id: "actionDigests",
          exportMode: "redacted-json",
          deleteMode: "retain-audit",
        }),
      ]),
    );
  });

  it("covers billing entitlements and webhook events", () => {
    const plan = buildWorkspaceDataLifecyclePlan({
      workspaceId: "workspace_123",
      requestedBy: "user_123",
      now: 1_700_000_000_000,
    });

    expect(currentLifecycleResourceIds).toEqual(
      expect.arrayContaining(["entitlements", "webhookEvents"]),
    );
    expect(plan.export.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "entitlements",
          exportMode: "json",
          deleteMode: "retain-audit",
        }),
        expect.objectContaining({
          id: "webhookEvents",
          exportMode: "redacted-json",
          deleteMode: "retain-audit",
        }),
      ]),
    );
  });

  it("covers durable feature flag and notification resources", () => {
    const plan = buildWorkspaceDataLifecyclePlan({
      workspaceId: "workspace_123",
      requestedBy: "user_123",
      now: 1_700_000_000_000,
    });

    expect(currentLifecycleResourceIds).toEqual(
      expect.arrayContaining([
        "dsarRequests",
        "featureFlagPolicies",
        "notificationRecords",
        "notificationPreferences",
      ]),
    );
    expect(plan.export.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "dsarRequests",
          exportMode: "redacted-json",
          deleteMode: "retain-audit",
        }),
        expect.objectContaining({
          id: "featureFlagPolicies",
          exportMode: "json",
          deleteMode: "delete",
        }),
        expect.objectContaining({
          id: "notificationRecords",
          exportMode: "redacted-json",
          deleteMode: "retain-audit",
        }),
        expect.objectContaining({
          id: "notificationPreferences",
          exportMode: "json",
          deleteMode: "delete",
        }),
      ]),
    );
    expect(plan.retention.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "dsarRequests",
          action: "retain-audit-window",
        }),
        expect.objectContaining({
          resourceId: "featureFlagPolicies",
          action: "retain-until-workspace-delete",
        }),
        expect.objectContaining({
          resourceId: "notificationRecords",
          action: "hash-or-redact-on-export",
        }),
        expect.objectContaining({
          resourceId: "notificationPreferences",
          action: "retain-until-workspace-delete",
        }),
      ]),
    );
  });

  it("requires typed confirmation before destructive delete execution", () => {
    const plan = buildWorkspaceDataLifecyclePlan({
      workspaceId: "workspace_123",
      requestedBy: "user_123",
      now: 1_700_000_000_000,
    });

    expect(plan.delete.confirmation).toEqual({
      required: true,
      phrase: "delete workspace_123",
      reason: "workspace data deletion is destructive and audited",
    });
  });

  it("builds a DSAR export manifest from the lifecycle plan", () => {
    const dsar = buildWorkspaceDsarPlan({
      requestId: "dsar_export_123",
      workspaceId: "workspace_123",
      requestedBy: "privacy@example.test",
      subjectId: "user_123",
      kind: "export",
      now: 1_700_000_000_000,
    });

    expect(dsar).toMatchObject({
      requestId: "dsar_export_123",
      workspaceId: "workspace_123",
      requestedBy: "privacy@example.test",
      subjectId: "user_123",
      kind: "export",
      status: "ready-for-review",
      dryRunOnly: true,
    });
    expect(dsar.exportManifest.map((entry) => entry.resourceId)).toEqual(
      currentLifecycleResourceIds,
    );
    expect(dsar.exportManifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "brainPages",
          exportMode: "markdown",
        }),
        expect.objectContaining({
          resourceId: "apiKeys",
          exportMode: "redacted-json",
        }),
        expect.objectContaining({
          resourceId: "actionDigests",
          exportMode: "redacted-json",
        }),
      ]),
    );
  });

  it("keeps DSAR delete requests non-executable until exact confirmation", () => {
    const dsar = buildWorkspaceDsarPlan({
      requestId: "dsar_delete_123",
      workspaceId: "workspace_123",
      requestedBy: "privacy@example.test",
      kind: "delete",
      now: 1_700_000_000_000,
      confirmationPhrase: "delete workspace_WRONG",
    });

    expect(dsar.status).toBe("needs-confirmation");
    expect(dsar.confirmation.phrase).toBe("delete workspace_123");
    expect(dsar.deletePlan.every((entry) => entry.executable === false)).toBe(
      true,
    );
    expect(dsar.deletePlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "brainPages",
          deleteMode: "delete",
          reason: "Awaiting exact workspace delete confirmation.",
        }),
        expect.objectContaining({
          resourceId: "creditLedger",
          deleteMode: "retain-audit",
          reason: "Awaiting exact workspace delete confirmation.",
        }),
      ]),
    );
  });

  it("blocks DSAR deletes behind legal hold even with exact confirmation", () => {
    const dsar = buildWorkspaceDsarPlan({
      requestId: "dsar_delete_hold_123",
      workspaceId: "workspace_123",
      requestedBy: "privacy@example.test",
      kind: "delete",
      now: 1_700_000_000_000,
      confirmationPhrase: "delete workspace_123",
      legalHold: {
        enabled: true,
        reason: "open billing dispute",
        expiresAt: 1_700_086_400_000,
      },
    });

    expect(dsar.status).toBe("blocked-by-legal-hold");
    expect(dsar.legalHold).toMatchObject({ reason: "open billing dispute" });
    expect(dsar.deletePlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "documents",
          executable: false,
          reason: "Blocked by legal hold: open billing dispute",
        }),
      ]),
    );
  });

  it("plans retention jobs without performing destructive cron work", () => {
    const retention = buildRetentionJobPlan({
      workspaceId: "workspace_123",
      requestedBy: "privacy@example.test",
      now: 1_700_000_000_000,
      auditWindowDays: 365,
    });

    expect(retention).toMatchObject({
      workspaceId: "workspace_123",
      dryRunOnly: true,
      auditWindowDays: 365,
      nextReviewAt: 1_700_086_400_000,
    });
    expect(
      retention.actions.every((action) => action.executable === false),
    ).toBe(true);
    expect(retention.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "workflowRuns",
          action: "retain-audit-window",
        }),
        expect.objectContaining({
          resourceId: "brainPages",
          action: "retain-until-workspace-delete",
        }),
      ]),
    );
  });
});
