import { describe, expect, it } from "vitest";
import {
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
});
