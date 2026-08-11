import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import * as auth from "../confect/headless/auth";
import * as migrations from "../confect/internal/migrations";
import { executableMigrations } from "../confect/internal/migrations.spec";

const legacyRow = {
  organizationId: "organizations_legacy",
  workspaceId: "workspaces_legacy",
  name: "MCP",
  keyId: "legacy-key-id",
  secretHash: "a".repeat(64),
  hashVersion: "hmac-sha256-v1" as const,
  pepperVersion: "v1" as const,
  preview: "mstro_stg_legacy...abcd",
  scopeKind: "workspace" as const,
  status: "active" as const,
  scopes: ["navigation:write"],
  roleCap: "viewer" as const,
  createdByUserId: "users_legacy",
  createdAt: 1_000,
  expiresAt: null,
  lastUsedAt: 2_000,
  lastUsedIpHash: null,
  lastUsedUserAgentHash: null,
  revokedAt: null,
  revokedByUserId: null,
  revokeReason: null,
  rotationOfKeyId: null,
};

describe("legacy API-key migration", () => {
  it("registers the bounded migration with exact component counters", () => {
    expect(executableMigrations).toHaveProperty("legacyApiKeys.inert.expand", {
      phase: "expand",
      hasExactExecuteCounters: true,
      dryRunSafety: "patchedNoRawDocumentLogs",
      rollbackOwner: "headless-auth",
      observationWindowMs: 24 * 60 * 60_000,
    });
  });

  it("accepts the exact persisted legacy shape only during expansion", () => {
    const storageSchema = (
      auth as typeof auth & { ApiKeyStorageRow?: Schema.Schema.Any }
    ).ApiKeyStorageRow;

    expect(storageSchema).toBeDefined();
    if (storageSchema === undefined) return;
    expect(() =>
      Schema.decodeUnknownSync(storageSchema)(legacyRow),
    ).not.toThrow();
  });

  it("converts a legacy credential into inert modern storage without losing audit metadata", () => {
    const replacement = (
      migrations as typeof migrations & {
        legacyApiKeyReplacement?: (row: typeof legacyRow) => unknown;
      }
    ).legacyApiKeyReplacement;

    expect(replacement).toBeTypeOf("function");
    if (replacement === undefined) return;

    const migrated = replacement(legacyRow) as Record<string, unknown>;
    expect(migrated).toMatchObject({
      id: "legacy_legacy-key-id",
      organizationId: legacyRow.organizationId,
      workspaceId: legacyRow.workspaceId,
      name: legacyRow.name,
      keyHash: legacyRow.secretHash,
      displayPrefix: legacyRow.preview,
      scopes: [],
      status: "active",
      createdByUserId: legacyRow.createdByUserId,
      createdAt: legacyRow.createdAt,
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: legacyRow.lastUsedAt,
    });
    expect(migrated).not.toHaveProperty("principalId");
    expect(migrated).not.toHaveProperty("brainKey");
    expect(migrated).not.toHaveProperty("secretHash");

    const metadata = JSON.parse(String(migrated.legacyMetadataJson));
    expect(metadata).toEqual({
      hashVersion: "hmac-sha256-v1",
      keyId: "legacy-key-id",
      lastUsedIpHash: null,
      lastUsedUserAgentHash: null,
      originalWorkspaceId: "workspaces_legacy",
      pepperVersion: "v1",
      revokeReason: null,
      revokedByUserId: null,
      roleCap: "viewer",
      rotationOfKeyId: null,
      scopeKind: "workspace",
      scopes: ["navigation:write"],
    });
    expect(migrated.legacyMetadataJson).not.toContain(legacyRow.secretHash);
  });

  it("isolates organization-scoped rows that never had a workspace", () => {
    const organizationRow = {
      ...legacyRow,
      workspaceId: null,
      scopeKind: "organization" as const,
    };
    const storageSchema = (
      auth as typeof auth & { ApiKeyStorageRow?: Schema.Schema.Any }
    ).ApiKeyStorageRow;
    const replacement = (
      migrations as typeof migrations & {
        legacyApiKeyReplacement?: (row: typeof organizationRow) => unknown;
      }
    ).legacyApiKeyReplacement;

    expect(storageSchema).toBeDefined();
    expect(replacement).toBeTypeOf("function");
    if (storageSchema === undefined || replacement === undefined) return;
    expect(() =>
      Schema.decodeUnknownSync(storageSchema)(organizationRow),
    ).not.toThrow();
    const migrated = replacement(organizationRow) as Record<string, unknown>;
    expect(migrated.workspaceId).toBe("legacy_unscoped_organizations_legacy");
    expect(JSON.parse(String(migrated.legacyMetadataJson))).toMatchObject({
      originalWorkspaceId: null,
      scopeKind: "organization",
    });
  });
});
