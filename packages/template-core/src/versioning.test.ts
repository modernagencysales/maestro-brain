import { describe, expect, it } from "vitest";
import {
  appendVersion,
  markFreshness,
  reconcileExternalVersion,
  restoreVersion,
  VersioningValidationError,
} from "./versioning";

const now = "2026-07-01T19:00:00.000Z";

describe("versioning domain", () => {
  it("appends immutable versions with approved causation", () => {
    const version = appendVersion({
      workspaceId: "workspace_123",
      entityKey: "brain/page/founder-notes",
      versionKey: "v1",
      causation: "human-edit",
      actorId: "user_123",
      payloadHash: "sha256:abc",
      payload: { title: "Founder notes" },
      idempotencyKey: "append-v1",
      createdAt: now,
    });

    expect(version).toMatchObject({
      workspaceId: "workspace_123",
      entityKey: "brain/page/founder-notes",
      versionKey: "v1",
      causation: "human-edit",
      appendOnly: true,
    });
  });

  it("restores by creating a new version rather than mutating history", () => {
    const restored = restoreVersion({
      workspaceId: "workspace_123",
      entityKey: "brain/page/founder-notes",
      restoredFromVersionKey: "v1",
      versionKey: "v3",
      actorId: "user_123",
      payloadHash: "sha256:restored",
      payload: { title: "Founder notes restored" },
      idempotencyKey: "restore-v3",
      createdAt: now,
    });

    expect(restored).toMatchObject({
      versionKey: "v3",
      priorVersionKey: "v1",
      restoredFromVersionKey: "v1",
      causation: "restore",
      appendOnly: true,
    });
  });

  it("stores freshness separately from immutable entry history", () => {
    const freshness = markFreshness({
      workspaceId: "workspace_123",
      entityKey: "brain/page/founder-notes",
      status: "review-due",
      reason: "Source is older than 30 days.",
      checkedAt: now,
      nextReviewAt: "2026-08-01T00:00:00.000Z",
    });

    expect(freshness).toEqual({
      workspaceId: "workspace_123",
      entityKey: "brain/page/founder-notes",
      status: "review-due",
      reason: "Source is older than 30 days.",
      checkedAt: now,
      nextReviewAt: "2026-08-01T00:00:00.000Z",
      mutableFreshness: true,
    });
  });

  it("reconciles external versions idempotently by workspace, entity, external version, and idempotency key", () => {
    const first = reconcileExternalVersion({
      workspaceId: "workspace_123",
      entityKey: "crm/account/acme",
      externalVersion: "salesforce:001:7",
      idempotencyKey: "sync-001",
      actorId: "sync_worker",
      payloadHash: "sha256:crm",
      payload: { accountName: "Acme" },
      createdAt: now,
    });
    const second = reconcileExternalVersion({
      workspaceId: "workspace_123",
      entityKey: "crm/account/acme",
      externalVersion: "salesforce:001:7",
      idempotencyKey: "sync-001",
      actorId: "sync_worker",
      payloadHash: "sha256:crm",
      payload: { accountName: "Acme" },
      createdAt: now,
    });

    expect(first.reconciliationKey).toBe(second.reconciliationKey);
    expect(first).toMatchObject({
      causation: "reconcile",
      versionKey: "external:salesforce:001:7",
      appendOnly: true,
    });
  });

  it("rejects unknown causation and blank identity fields", () => {
    expect(() =>
      appendVersion({
        workspaceId: "",
        entityKey: "brain/page/founder-notes",
        versionKey: "v1",
        causation: "human-edit",
        actorId: "user_123",
        payloadHash: "sha256:abc",
        payload: {},
        idempotencyKey: "append-v1",
        createdAt: now,
      }),
    ).toThrow(VersioningValidationError);

    expect(() =>
      appendVersion({
        workspaceId: "workspace_123",
        entityKey: "brain/page/founder-notes",
        versionKey: "v1",
        causation: "botched-merge",
        actorId: "user_123",
        payloadHash: "sha256:abc",
        payload: {},
        idempotencyKey: "append-v1",
        createdAt: now,
      }),
    ).toThrow(VersioningValidationError);
  });

  it("rejects malformed idempotency keys before appending version history", () => {
    expect(() =>
      appendVersion({
        workspaceId: "workspace_123",
        entityKey: "brain/page/founder-notes",
        versionKey: "v1",
        causation: "human-edit",
        actorId: "user_123",
        payloadHash: "sha256:abc",
        payload: {},
        idempotencyKey: " append-v1 ",
        createdAt: now,
      }),
    ).toThrow(
      new VersioningValidationError(
        "idempotencyKey",
        "idempotencyKey must not have leading or trailing whitespace.",
      ),
    );

    expect(() =>
      restoreVersion({
        workspaceId: "workspace_123",
        entityKey: "brain/page/founder-notes",
        restoredFromVersionKey: "v1",
        versionKey: "v3",
        actorId: "user_123",
        payloadHash: "sha256:restored",
        payload: {},
        idempotencyKey: "restore/v3",
        createdAt: now,
      }),
    ).toThrow(
      new VersioningValidationError(
        "idempotencyKey",
        "idempotencyKey must contain only URL-safe letters, numbers, '.', '_', '~', or '-'.",
      ),
    );
  });

  it("rejects malformed reconciliation idempotency keys before deriving reconciliation keys", () => {
    expect(() =>
      reconcileExternalVersion({
        workspaceId: "workspace_123",
        entityKey: "crm/account/acme",
        externalVersion: "salesforce:001:7",
        idempotencyKey: " sync-001 ",
        actorId: "sync_worker",
        payloadHash: "sha256:crm",
        payload: { accountName: "Acme" },
        createdAt: now,
      }),
    ).toThrow(
      new VersioningValidationError(
        "idempotencyKey",
        "idempotencyKey must not have leading or trailing whitespace.",
      ),
    );
  });
});
