import { TestConfect } from "@confect/test";
import * as Either from "effect/Either";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  createApiKey,
  createBrainApiKey,
  createPublicBrainApiKey,
  hashPresentedApiKey,
  listApiKeyMetadata,
  rotateBrainApiKey,
  revokeBrainApiKey,
  verifyApiKey,
} from "../confect/headless/auth";
import apiKeys from "../confect/tables/apiKeys";
import servicePrincipals from "../confect/tables/servicePrincipals";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import { Forbidden } from "../confect/errors";
import {
  authenticateBrainBearer,
  authenticateBrainKeyHash,
  createApiKeyForBrain,
  listApiKeysForBrain,
  markApiKeyLastUsed,
  revokeApiKeyForBrain,
  rotateApiKeyForBrain,
} from "../confect/headless/apiKeys.impl";
import { testConfectLayer } from "./support/confect";

const adminActor = {
  userId: "user_admin",
  role: "admin",
} as const;

const baseInput = {
  organizationId: "org_acme",
  workspaceId: "workspace_acme",
  brainKey: "brain_client_alpha",
  name: "Client Alpha read key",
  scopes: ["brain:read"],
  actor: adminActor,
  nowMs: 1_000,
  expiresAt: 2_000,
  randomBytes: () => new Uint8Array(32).fill(3),
} as const;

describe("one-Brain API key CRUD", () => {
  it("derives key and principal ids from at least 128 digest bits", async () => {
    const first = await createBrainApiKey(baseInput);
    const second = await createBrainApiKey({
      ...baseInput,
      randomBytes: () => new Uint8Array(32).fill(4),
    });

    expect(first.key.id).toMatch(/^api_key_[A-Za-z0-9_-]{22}/);
    expect(first.principal.id).toMatch(/^service_principal_[A-Za-z0-9_-]{22}/);
    expect(first.key.id).not.toBe(second.key.id);
    expect(first.principal.id).not.toBe(second.principal.id);
  });

  it("mints display-once one-Brain keys and stores only hash/prefix metadata", async () => {
    const created = await createBrainApiKey(baseInput);

    expect(created.displayKey).toMatch(/^mbk_live_/);
    expect(created.key).toMatchObject({
      organizationId: "org_acme",
      workspaceId: "workspace_acme",
      brainKey: "brain_client_alpha",
      name: "Client Alpha read key",
      scopes: ["brain:read"],
      principalGeneration: 1,
      roleCeiling: "viewer",
      status: "active",
      createdByUserId: "user_admin",
      expiresAt: 2_000,
      revokedAt: null,
    });
    expect(created.principal).toMatchObject({
      organizationId: "org_acme",
      workspaceId: "workspace_acme",
      brainKey: "brain_client_alpha",
      roleCeiling: "viewer",
      status: "active",
      generation: 1,
      createdByUserId: "user_admin",
    });
    expect(JSON.stringify(created.key)).not.toContain(created.displayKey);
    expect(JSON.stringify(created.principal)).not.toContain(created.displayKey);
    expect(listApiKeyMetadata([created.key])).toEqual([
      {
        id: created.key.id,
        principalId: created.principal.id,
        organizationId: "org_acme",
        workspaceId: "workspace_acme",
        brainKey: "brain_client_alpha",
        name: "Client Alpha read key",
        displayPrefix: created.key.displayPrefix,
        scopes: ["brain:read"],
        principalGeneration: 1,
        roleCeiling: "viewer",
        status: "active",
        createdByUserId: "user_admin",
        createdAt: 1_000,
        expiresAt: 2_000,
        revokedAt: null,
        lastUsedAt: null,
      },
    ]);
  });

  it("derives public Brain API key authority server-side and strips internal ids", async () => {
    const created = await createPublicBrainApiKey({
      publicInput: {
        name: "Client Alpha read key",
        scopes: ["brain:read"],
        actor: adminActor,
        nowMs: 1_000,
        expiresAt: 2_000,
        randomBytes: () => new Uint8Array(32).fill(9),
      },
      serverScope: {
        organizationId: "org_server",
        workspaceId: "workspace_server",
        brainKey: "brain_server",
      },
    });

    expect(created.displayKey).toMatch(/^mbk_live_/);
    expect(created.key).toEqual({
      name: "Client Alpha read key",
      displayPrefix: expect.stringMatching(/^mbk_live_/),
      scopes: ["brain:read"],
      roleCeiling: "viewer",
      status: "active",
      createdAt: 1_000,
      expiresAt: 2_000,
    });
    expect(JSON.stringify(created.key)).not.toContain("org_server");
    expect(JSON.stringify(created.key)).not.toContain("workspace_server");
    expect(JSON.stringify(created.key)).not.toContain("brain_server");
    expect(JSON.stringify(created.key)).not.toContain("api_key_");
    expect(JSON.stringify(created.key)).not.toContain("service_principal_");
  });

  it("rejects non-admin creators, invalid scopes, no expiry, and overlong expiry", async () => {
    await expect(
      createBrainApiKey({
        ...baseInput,
        actor: { userId: "user_viewer", role: "viewer" },
      }),
    ).rejects.toMatchObject({ _tag: "Forbidden" });

    await expect(
      createBrainApiKey({ ...baseInput, scopes: ["brain:read", "admin"] }),
    ).rejects.toMatchObject({ _tag: "ApiKeyScopeInvalid" });

    await expect(
      createBrainApiKey({ ...baseInput, scopes: ["brain:ask"] }),
    ).rejects.toMatchObject({ _tag: "ApiKeyScopeInvalid" });

    await expect(
      createBrainApiKey({ ...baseInput, scopes: [] }),
    ).rejects.toMatchObject({ _tag: "ApiKeyScopeInvalid" });

    await expect(
      createBrainApiKey({
        organizationId: baseInput.organizationId,
        workspaceId: baseInput.workspaceId,
        brainKey: baseInput.brainKey,
        name: baseInput.name,
        scopes: baseInput.scopes,
        actor: baseInput.actor,
        nowMs: baseInput.nowMs,
        randomBytes: baseInput.randomBytes,
      }),
    ).rejects.toMatchObject({ _tag: "ApiKeyExpiryInvalid" });

    await expect(
      createBrainApiKey({
        ...baseInput,
        expiresAt: baseInput.nowMs + 91 * 24 * 60 * 60 * 1_000,
      }),
    ).rejects.toMatchObject({ _tag: "ApiKeyExpiryInvalid" });
  });

  it("fails closed for Brain scopes without an exact active service principal", async () => {
    const created = await createBrainApiKey(baseInput);

    await expect(
      verifyApiKey({
        presentedKey: created.displayKey,
        keys: [created.key],
        principals: [],
        nowMs: 1_500,
        requiredScope: "brain:read",
        brainKey: "brain_client_alpha",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "SERVICE_PRINCIPAL_MISSING" },
    });

    await expect(
      verifyApiKey({
        presentedKey: created.displayKey,
        keys: [created.key],
        principals: [{ ...created.principal, workspaceId: "workspace_other" }],
        nowMs: 1_500,
        requiredScope: "brain:read",
        brainKey: "brain_client_alpha",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "API_KEY_FORBIDDEN" },
    });

    const legacy = await createApiKey({
      workspaceId: "workspace_acme",
      name: "legacy admin",
      scopes: ["admin"],
      createdByUserId: "user_admin",
      nowMs: 1_000,
      randomBytes: () => new Uint8Array(32).fill(5),
    });

    await expect(
      verifyApiKey({
        presentedKey: legacy.displayKey,
        keys: [legacy.row],
        principals: [],
        nowMs: 1_500,
        requiredScope: "brain:read",
        brainKey: "brain_client_alpha",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "SERVICE_PRINCIPAL_MISSING" },
    });
  });

  it("verifies scope, Brain, expiry, key revocation, and principal revocation", async () => {
    const created = await createBrainApiKey(baseInput);

    await expect(
      verifyApiKey({
        presentedKey: created.displayKey,
        keys: [created.key],
        principals: [created.principal],
        nowMs: 1_500,
        requiredScope: "brain:read",
        brainKey: "brain_client_alpha",
      }),
    ).resolves.toMatchObject({
      ok: true,
      organizationId: "org_acme",
      workspaceId: "workspace_acme",
      brainKey: "brain_client_alpha",
      roleCeiling: "viewer",
    });

    await expect(
      verifyApiKey({
        presentedKey: created.displayKey,
        keys: [created.key],
        principals: [created.principal],
        nowMs: 1_500,
        requiredScope: "brain:ask",
        brainKey: "brain_client_alpha",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "API_KEY_FORBIDDEN" },
    });

    await expect(
      verifyApiKey({
        presentedKey: created.displayKey,
        keys: [created.key],
        principals: [created.principal],
        nowMs: 1_500,
        requiredScope: "brain:read",
        brainKey: "brain_other",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "API_KEY_FORBIDDEN" },
    });

    await expect(
      verifyApiKey({
        presentedKey: created.displayKey,
        keys: [{ ...created.key, status: "revoked", revokedAt: 1_400 }],
        principals: [created.principal],
        nowMs: 1_500,
        requiredScope: "brain:read",
        brainKey: "brain_client_alpha",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "API_KEY_REVOKED" } });

    await expect(
      verifyApiKey({
        presentedKey: created.displayKey,
        keys: [created.key],
        principals: [
          { ...created.principal, status: "revoked", revokedAt: 1_400 },
        ],
        nowMs: 1_500,
        requiredScope: "brain:read",
        brainKey: "brain_client_alpha",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "SERVICE_PRINCIPAL_REVOKED" },
    });

    await expect(
      verifyApiKey({
        presentedKey: created.displayKey,
        keys: [created.key],
        principals: [created.principal],
        nowMs: 2_000,
        requiredScope: "brain:read",
        brainKey: "brain_client_alpha",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "API_KEY_EXPIRED" } });

    await expect(
      verifyApiKey({
        presentedKey: created.displayKey,
        keys: [{ ...created.key, status: "expired", expiresAt: null }],
        principals: [created.principal],
        nowMs: 1_500,
        requiredScope: "brain:read",
        brainKey: "brain_client_alpha",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "API_KEY_EXPIRED" } });

    await expect(
      verifyApiKey({
        presentedKey: created.displayKey,
        keys: [created.key],
        principals: [
          { ...created.principal, status: "expired", revokedAt: null },
        ],
        nowMs: 1_500,
        requiredScope: "brain:read",
        brainKey: "brain_client_alpha",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "SERVICE_PRINCIPAL_REVOKED" },
    });
  });

  it("revokes and rotates keys without reusing the old secret", async () => {
    const created = await createBrainApiKey(baseInput);
    const revoked = revokeBrainApiKey({
      key: created.key,
      actor: adminActor,
      nowMs: 1_200,
    });
    const rotated = await rotateBrainApiKey({
      key: created.key,
      principal: created.principal,
      actor: adminActor,
      nowMs: 1_300,
      expiresAt: 2_300,
      randomBytes: () => new Uint8Array(32).fill(4),
    });

    expect(revoked.status).toBe("revoked");
    expect(rotated.revokedKey.status).toBe("revoked");
    expect(rotated.key.id).not.toBe(created.key.id);
    expect(rotated.key.principalId).toBe(created.principal.id);
    expect(rotated.key.principalGeneration).toBe(2);
    expect(rotated.displayKey).not.toBe(created.displayKey);
    expect(rotated.principal.generation).toBe(2);

    await expect(
      verifyApiKey({
        presentedKey: rotated.displayKey,
        keys: [rotated.key],
        principals: [{ ...rotated.principal, generation: 3 }],
        nowMs: 1_500,
        requiredScope: "brain:read",
        brainKey: "brain_client_alpha",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "SERVICE_PRINCIPAL_REVOKED" },
    });

    await expect(
      rotateBrainApiKey({
        key: revoked,
        principal: created.principal,
        actor: adminActor,
        nowMs: 1_400,
        expiresAt: 2_400,
      }),
    ).rejects.toMatchObject({ _tag: "ApiKeyRevoked" });
  });

  it("declares service-principal and one-Brain API-key table indexes", () => {
    expect(apiKeys.indexes).toMatchObject({
      by_key_hash: ["keyHash"],
      by_principal: ["principalId"],
      by_principal_status: ["principalId", "status"],
      by_brain_status: ["workspaceId", "brainKey", "status"],
      by_expiry: ["expiresAt"],
    });
    expect(servicePrincipals.indexes).toMatchObject({
      by_brain_status: ["workspaceId", "brainKey", "status"],
      by_workspace: ["workspaceId"],
      by_workspace_status: ["workspaceId", "status"],
      by_organization_status: ["organizationId", "status"],
      by_principal_key: ["id"],
      by_created_by: ["createdByUserId"],
    });
  });
});

describe("durable one-Brain API-key Confect handlers", () => {
  it("derives public CRUD authority from server tenant and actor state", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );

      return yield* confect.run(
        Effect.gen(function* () {
          const seeded = yield* seedApiKeyTenant();
          const scope = {
            organizationId: seeded.organizationId,
            workspaceId: seeded.workspaceId,
            brainKey: "brain_acme",
          };
          const actor = { userId: seeded.adminUserId, role: "admin" as const };
          const created = yield* createApiKeyForBrain({
            publicInput: {
              name: "Client Alpha read key",
              scopes: ["brain:read"],
              expiresAt: 20_000,
              randomBytes: () => new Uint8Array(32).fill(21),
            },
            serverScope: scope,
            actor,
            nowMs: 10_000,
          });
          const listed = yield* listApiKeysForBrain({
            serverScope: scope,
            actor,
          });
          yield* revokeApiKeyForBrain({
            keyId: listed[0]?.id ?? "missing",
            serverScope: scope,
            actor,
            nowMs: 12_000,
          });
          const revoked = yield* listApiKeysForBrain({
            serverScope: scope,
            actor,
          });

          return { created, listed, revoked };
        }),
        Schema.Any,
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.created.displayKey).toMatch(/^mbk_live_/);
    expect(result.created.key).toEqual({
      name: "Client Alpha read key",
      displayPrefix: expect.stringMatching(/^mbk_live_/),
      scopes: ["brain:read"],
      roleCeiling: "viewer",
      status: "active",
      createdAt: 10_000,
      expiresAt: 20_000,
    });
    expect(JSON.stringify(result.created.key)).not.toContain("organizations_");
    expect(JSON.stringify(result.created.key)).not.toContain("workspaces_");
    expect(result.listed).toHaveLength(1);
    expect(result.listed[0]).toMatchObject({ status: "active" });
    expect(result.revoked[0]).toMatchObject({ status: "revoked" });
  });

  it("lists modern Brain keys while legacy credentials coexist during expansion", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );

      return yield* confect.run(
        Effect.gen(function* () {
          const seeded = yield* seedApiKeyTenant();
          const scope = {
            organizationId: seeded.organizationId,
            workspaceId: seeded.workspaceId,
            brainKey: "brain_acme",
          };
          const actor = { userId: seeded.adminUserId, role: "admin" as const };
          const writer = yield* DatabaseWriter;
          yield* writer
            .table("apiKeys")
            .insert({
              organizationId: seeded.organizationId,
              workspaceId: seeded.workspaceId,
              name: "Legacy MCP key",
              keyId: "legacy-key-id",
              secretHash: "a".repeat(64),
              hashVersion: "hmac-sha256-v1",
              pepperVersion: "v1",
              preview: "mstro_stg_legacy...abcd",
              scopeKind: "workspace",
              status: "active",
              scopes: ["navigation:write"],
              roleCap: "viewer",
              createdByUserId: seeded.adminUserId,
              createdAt: 9_000,
              expiresAt: null,
              lastUsedAt: null,
              lastUsedIpHash: null,
              lastUsedUserAgentHash: null,
              revokedAt: null,
              revokedByUserId: null,
              revokeReason: null,
              rotationOfKeyId: null,
            })
            .pipe(Effect.orDie);
          yield* createApiKeyForBrain({
            publicInput: {
              name: "Modern Brain key",
              scopes: ["brain:read"],
              expiresAt: 20_000,
              randomBytes: () => new Uint8Array(32).fill(22),
            },
            serverScope: scope,
            actor,
            nowMs: 10_000,
          });

          return yield* listApiKeysForBrain({ serverScope: scope, actor });
        }),
        Schema.Any,
      );
    });

    const listed = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      name: "Modern Brain key",
      scopes: ["brain:read"],
      status: "active",
    });
    expect(JSON.stringify(listed)).not.toContain("Legacy MCP key");
    expect(JSON.stringify(listed)).not.toContain("navigation:write");
  });

  it("rejects duplicate active names and revokes the service principal generation", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );

      return yield* confect.run(
        Effect.gen(function* () {
          const seeded = yield* seedApiKeyTenant();
          const scope = {
            organizationId: seeded.organizationId,
            workspaceId: seeded.workspaceId,
            brainKey: "brain_acme",
          };
          const actor = { userId: seeded.adminUserId, role: "admin" as const };
          yield* createApiKeyForBrain({
            publicInput: {
              name: "Client Alpha read key",
              scopes: ["brain:read"],
              expiresAt: 20_000,
              randomBytes: () => new Uint8Array(32).fill(31),
            },
            serverScope: scope,
            actor,
            nowMs: 10_000,
          });
          const duplicate = yield* createApiKeyForBrain({
            publicInput: {
              name: "Client Alpha read key",
              scopes: ["brain:read"],
              expiresAt: 21_000,
              randomBytes: () => new Uint8Array(32).fill(32),
            },
            serverScope: scope,
            actor,
            nowMs: 10_001,
          }).pipe(Effect.flip);
          const listed = yield* listApiKeysForBrain({
            serverScope: scope,
            actor,
          });
          yield* revokeApiKeyForBrain({
            keyId: listed[0]?.id ?? "missing",
            serverScope: scope,
            actor,
            nowMs: 12_000,
          });
          const keyRows = yield* (yield* DatabaseReader)
            .table("apiKeys")
            .index("by_brain_status", (q) =>
              q
                .eq("workspaceId", scope.workspaceId)
                .eq("brainKey", scope.brainKey),
            )
            .collect()
            .pipe(Effect.orDie);
          const principal = yield* (yield* DatabaseReader)
            .table("servicePrincipals")
            .index("by_principal_key", (q) =>
              q.eq("id", keyRows[0]?.principalId ?? ""),
            )
            .collect()
            .pipe(Effect.orDie);
          return { duplicateTag: duplicate._tag, principal };
        }),
        Schema.Any,
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.duplicateTag).toBe("ApiKeyConflict");
    expect(result.principal).toHaveLength(1);
    expect(result.principal[0]).toMatchObject({
      status: "revoked",
      generation: 2,
      revokedAt: 12_000,
    });
  });

  it("rejects rotation hash collisions before revoking the active key", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );

      return yield* confect.run(
        Effect.gen(function* () {
          const seeded = yield* seedApiKeyTenant();
          const scope = {
            organizationId: seeded.organizationId,
            workspaceId: seeded.workspaceId,
            brainKey: "brain_acme",
          };
          const actor = { userId: seeded.adminUserId, role: "admin" as const };
          const repeatedEntropy = () => new Uint8Array(32).fill(41);
          yield* createApiKeyForBrain({
            publicInput: {
              name: "Client Alpha read key",
              scopes: ["brain:read"],
              expiresAt: 20_000,
              randomBytes: repeatedEntropy,
            },
            serverScope: scope,
            actor,
            nowMs: 10_000,
          });
          const listed = yield* listApiKeysForBrain({
            serverScope: scope,
            actor,
          });
          const collision = yield* Effect.either(
            rotateApiKeyForBrain({
              keyId: listed[0]?.id ?? "missing",
              expiresAt: 22_000,
              serverScope: scope,
              actor,
              nowMs: 11_000,
              randomBytes: repeatedEntropy,
            }),
          );
          const keyRows = yield* (yield* DatabaseReader)
            .table("apiKeys")
            .index("by_brain_status", (q) =>
              q
                .eq("workspaceId", scope.workspaceId)
                .eq("brainKey", scope.brainKey),
            )
            .collect()
            .pipe(Effect.orDie);
          const principals = yield* (yield* DatabaseReader)
            .table("servicePrincipals")
            .index("by_principal_key", (q) =>
              q.eq("id", keyRows[0]?.principalId ?? ""),
            )
            .collect()
            .pipe(Effect.orDie);

          return {
            collisionTag: Either.isLeft(collision)
              ? collision.left._tag
              : "success",
            keyRows,
            principals,
          };
        }),
        Schema.Any,
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.collisionTag).toBe("ApiKeyConflict");
    expect(result.keyRows).toHaveLength(1);
    expect(result.keyRows[0]).toMatchObject({
      status: "active",
      revokedAt: null,
      principalGeneration: 1,
    });
    expect(result.principals).toEqual([
      expect.objectContaining({
        status: "active",
        generation: 1,
        revokedAt: null,
      }),
    ]);
  });

  it("authenticates by indexed bearer hash before best-effort last-used", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );

      return yield* confect.run(
        Effect.gen(function* () {
          const seeded = yield* seedApiKeyTenant();
          const scope = {
            organizationId: seeded.organizationId,
            workspaceId: seeded.workspaceId,
            brainKey: "brain_acme",
          };
          const created = yield* createApiKeyForBrain({
            publicInput: {
              name: "Client Alpha read key",
              scopes: ["brain:read"],
              expiresAt: Date.now() + 20_000,
              randomBytes: () => new Uint8Array(32).fill(22),
            },
            serverScope: scope,
            actor: { userId: seeded.adminUserId, role: "admin" },
            nowMs: Date.now(),
          });
          const authenticated = yield* authenticateBrainBearer({
            authorization: `Bearer ${created.displayKey}`,
            requiredScope: "brain:read",
          });
          const beforeMark = yield* (yield* DatabaseReader)
            .table("apiKeys")
            .index("by_key_hash", (q) => q.eq("keyHash", authenticated.keyHash))
            .first()
            .pipe(Effect.orDie);
          yield* markApiKeyLastUsed({
            keyId: authenticated.keyId,
            keyHash: authenticated.keyHash,
            principalId: authenticated.principal.principalId,
            organizationId: authenticated.principal.organizationId,
            workspaceId: authenticated.principal.workspaceId,
            brainKey: authenticated.principal.brainKey,
          });
          const afterMark = yield* (yield* DatabaseReader)
            .table("apiKeys")
            .index("by_key_hash", (q) => q.eq("keyHash", authenticated.keyHash))
            .first()
            .pipe(Effect.orDie);
          yield* (yield* DatabaseWriter)
            .table("workspaces")
            .patch(seeded.workspaceId, { lifecycleGeneration: 2 })
            .pipe(Effect.orDie);
          const generationError = yield* authenticateBrainBearer({
            authorization: `Bearer ${created.displayKey}`,
            requiredScope: "brain:read",
          }).pipe(Effect.flip);

          return {
            authenticated,
            generationError: generationError.code,
            beforeMark:
              beforeMark._tag === "Some" ? beforeMark.value.lastUsedAt : null,
            afterMark:
              afterMark._tag === "Some" ? afterMark.value.lastUsedAt : null,
          };
        }),
        Schema.Any,
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.authenticated.principal).toMatchObject({
      organizationId: expect.stringContaining("organizations"),
      workspaceId: expect.stringContaining("workspaces"),
      brainKey: "brain_acme",
      roleCeiling: "viewer",
    });
    expect(result.authenticated.keyHash).not.toMatch(/^mbk_live_/);
    expect(result.beforeMark).toBeNull();
    expect(result.afterMark).toEqual(expect.any(Number));
    expect(result.afterMark).toBeGreaterThan(10_000);
    expect(result.generationError).toBe("TENANT_INACTIVE");
  });

  it("rejects bearer auth when an API key points at a different same-generation principal", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );

      return yield* confect.run(
        Effect.gen(function* () {
          const seeded = yield* seedApiKeyTenant();
          const scope = {
            organizationId: seeded.organizationId,
            workspaceId: seeded.workspaceId,
            brainKey: "brain_acme",
          };
          const created = yield* createApiKeyForBrain({
            publicInput: {
              name: "Client Alpha read key",
              scopes: ["brain:read"],
              expiresAt: Date.now() + 20_000,
              randomBytes: () => new Uint8Array(32).fill(24),
            },
            serverScope: scope,
            actor: { userId: seeded.adminUserId, role: "admin" },
            nowMs: Date.now(),
          });
          const authenticated = yield* authenticateBrainBearer({
            authorization: `Bearer ${created.displayKey}`,
            requiredScope: "brain:read",
          });
          const principal = yield* (yield* DatabaseReader)
            .table("servicePrincipals")
            .index("by_principal_key", (q) =>
              q.eq("id", authenticated.principal.principalId),
            )
            .first()
            .pipe(Effect.orDie);
          if (principal._tag !== "Some")
            throw new Error("missing principal row");
          yield* (yield* DatabaseWriter)
            .table("servicePrincipals")
            .patch(principal.value._id, {
              organizationId: "organizations_cross_tenant",
              workspaceId: "workspaces_cross_tenant",
              brainKey: "brain_cross_tenant",
            })
            .pipe(Effect.orDie);

          const error = yield* authenticateBrainBearer({
            authorization: `Bearer ${created.displayKey}`,
            requiredScope: "brain:read",
          }).pipe(Effect.flip);
          yield* markApiKeyLastUsed({
            keyId: authenticated.keyId,
            keyHash: authenticated.keyHash,
            principalId: authenticated.principal.principalId,
            organizationId: authenticated.principal.organizationId,
            workspaceId: authenticated.principal.workspaceId,
            brainKey: authenticated.principal.brainKey,
          });
          const afterMark = yield* (yield* DatabaseReader)
            .table("apiKeys")
            .index("by_key_hash", (q) => q.eq("keyHash", authenticated.keyHash))
            .first()
            .pipe(Effect.orDie);

          return {
            errorCode: error.code,
            lastUsedAt:
              afterMark._tag === "Some" ? afterMark.value.lastUsedAt : null,
          };
        }),
        Schema.Any,
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result).toEqual({
      errorCode: "API_KEY_FORBIDDEN",
      lastUsedAt: null,
    });
  });

  it("rejects bearer auth when the service-principal generation changed", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );

      return yield* confect.run(
        Effect.gen(function* () {
          const seeded = yield* seedApiKeyTenant();
          const scope = {
            organizationId: seeded.organizationId,
            workspaceId: seeded.workspaceId,
            brainKey: "brain_acme",
          };
          const created = yield* createApiKeyForBrain({
            publicInput: {
              name: "Client Alpha read key",
              scopes: ["brain:read"],
              expiresAt: Date.now() + 20_000,
              randomBytes: () => new Uint8Array(32).fill(23),
            },
            serverScope: scope,
            actor: { userId: seeded.adminUserId, role: "admin" },
            nowMs: Date.now(),
          });
          const authenticated = yield* authenticateBrainBearer({
            authorization: `Bearer ${created.displayKey}`,
            requiredScope: "brain:read",
          });
          const principals = yield* (yield* DatabaseReader)
            .table("servicePrincipals")
            .index("by_principal_key", (q) =>
              q.eq("id", authenticated.principal.principalId),
            )
            .collect()
            .pipe(Effect.orDie);
          const principal = principals[0];
          if (principal === undefined) throw new Error("missing principal row");
          yield* (yield* DatabaseWriter)
            .table("servicePrincipals")
            .patch(principal._id, { generation: 2 })
            .pipe(Effect.orDie);

          const generationError = yield* authenticateBrainBearer({
            authorization: `Bearer ${created.displayKey}`,
            requiredScope: "brain:read",
          }).pipe(Effect.flip);

          return generationError.code;
        }),
        Schema.Any,
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result).toBe("SERVICE_PRINCIPAL_REVOKED");
  });

  it("records success and denial audit events for API-key administration", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );

      return yield* confect.run(
        Effect.gen(function* () {
          const seeded = yield* seedApiKeyTenant();
          const scope = {
            organizationId: seeded.organizationId,
            workspaceId: seeded.workspaceId,
            brainKey: "brain_acme",
          };
          const actor = { userId: seeded.adminUserId, role: "admin" as const };
          const created = yield* createApiKeyForBrain({
            publicInput: {
              name: "Client Alpha read key",
              scopes: ["brain:read"],
              expiresAt: 20_000,
              randomBytes: () => new Uint8Array(32).fill(41),
            },
            serverScope: scope,
            actor,
            nowMs: 10_000,
          });
          const listed = yield* listApiKeysForBrain({
            serverScope: scope,
            actor,
          });
          const denied = yield* createApiKeyForBrain({
            publicInput: {
              name: "Blocked viewer key CUSTOMER-CANARY-create-secret",
              scopes: ["brain:read"],
              expiresAt: 20_000,
            },
            serverScope: scope,
            actor: { userId: seeded.viewerUserId, role: "viewer" },
            nowMs: 10_100,
          }).pipe(Effect.flip);
          const deniedRevoke = yield* revokeApiKeyForBrain({
            keyId: `${listed[0]?.id ?? "missing"}-CUSTOMER-CANARY-revoke-secret`,
            serverScope: scope,
            actor: { userId: seeded.viewerUserId, role: "viewer" },
            nowMs: 11_000,
          }).pipe(Effect.flip);
          const deniedRotate = yield* rotateApiKeyForBrain({
            keyId: `${listed[0]?.id ?? "missing"}-CUSTOMER-CANARY-rotate-secret`,
            serverScope: scope,
            actor: { userId: seeded.viewerUserId, role: "viewer" },
            expiresAt: 30_000,
            nowMs: 11_500,
          }).pipe(Effect.flip);
          yield* revokeApiKeyForBrain({
            keyId: listed[0]?.id ?? "missing",
            serverScope: scope,
            actor,
            nowMs: 12_000,
          });
          const events = yield* (yield* DatabaseReader)
            .table("accessAuditEvents")
            .index("by_workspace_action", (q) =>
              q
                .eq("workspaceId", scope.workspaceId)
                .eq("action", "apiKey.administered"),
            )
            .collect()
            .pipe(Effect.orDie);

          return {
            created,
            deniedTag: denied._tag,
            deniedRevokeTag: deniedRevoke._tag,
            deniedRotateTag: deniedRotate._tag,
            events: events.map((event) => ({
              subjectKind: event.subjectKind,
              subjectId: event.subjectId,
              actorUserId: event.actorUserId,
              metadata: JSON.parse(event.metadataJson),
              createdAt: event.createdAt,
            })),
          };
        }),
        Schema.Any,
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.deniedTag).toBe("Forbidden");
    expect(result.deniedRevokeTag).toBe("Forbidden");
    expect(result.deniedRotateTag).toBe("Forbidden");
    expect(JSON.stringify(result.events)).not.toContain("CUSTOMER-CANARY");
    expect(result.events).toEqual([
      {
        subjectKind: "privilegedAction",
        subjectId: result.created.key.displayPrefix,
        actorUserId: expect.stringContaining("users"),
        metadata: {
          outcome: "success",
          operation: "create",
          brainKey: "brain_acme",
          scopes: "brain:read",
        },
        createdAt: 10_000,
      },
      {
        subjectKind: "privilegedAction",
        subjectId: expect.stringMatching(
          /^api_key_denied_create_[A-Za-z0-9_-]{22}$/,
        ),
        actorUserId: expect.stringContaining("users"),
        metadata: {
          outcome: "denied",
          operation: "create",
          reason: "Forbidden",
          brainKey: "brain_acme",
        },
        createdAt: 10_100,
      },
      {
        subjectKind: "privilegedAction",
        subjectId: expect.stringMatching(
          /^api_key_denied_revoke_[A-Za-z0-9_-]{22}$/,
        ),
        actorUserId: expect.stringContaining("users"),
        metadata: {
          outcome: "denied",
          operation: "revoke",
          reason: "Forbidden",
          brainKey: "brain_acme",
        },
        createdAt: 11_000,
      },
      {
        subjectKind: "privilegedAction",
        subjectId: expect.stringMatching(
          /^api_key_denied_rotate_[A-Za-z0-9_-]{22}$/,
        ),
        actorUserId: expect.stringContaining("users"),
        metadata: {
          outcome: "denied",
          operation: "rotate",
          reason: "Forbidden",
          brainKey: "brain_acme",
        },
        createdAt: 11_500,
      },
      {
        subjectKind: "privilegedAction",
        subjectId: result.created.key.displayPrefix,
        actorUserId: expect.stringContaining("users"),
        metadata: {
          outcome: "success",
          operation: "revoke",
          brainKey: "brain_acme",
        },
        createdAt: 12_000,
      },
    ]);
  });

  it("equalizes indexed miss and revoked authentication lookup work", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );

      return yield* confect.run(
        Effect.gen(function* () {
          const seeded = yield* seedApiKeyTenant();
          const scope = {
            organizationId: seeded.organizationId,
            workspaceId: seeded.workspaceId,
            brainKey: "brain_acme",
          };
          const actor = { userId: seeded.adminUserId, role: "admin" as const };
          const created = yield* createApiKeyForBrain({
            publicInput: {
              name: "Client Alpha read key",
              scopes: ["brain:read"],
              expiresAt: 20_000,
              randomBytes: () => new Uint8Array(32).fill(51),
            },
            serverScope: scope,
            actor,
            nowMs: 10_000,
          });
          const listed = yield* listApiKeysForBrain({
            serverScope: scope,
            actor,
          });
          yield* revokeApiKeyForBrain({
            keyId: listed[0]?.id ?? "missing",
            serverScope: scope,
            actor,
            nowMs: 12_000,
          });

          const revokedHash = yield* Effect.promise(() =>
            hashPresentedApiKey(created.displayKey),
          );
          const missingHash = yield* Effect.promise(() =>
            hashPresentedApiKey("mbk_live_missing_equalized_work"),
          );

          const revoked = yield* authenticateBrainKeyHash({
            keyHash: revokedHash,
            requiredScope: "brain:read",
          }).pipe(Effect.flip);
          const missing = yield* authenticateBrainKeyHash({
            keyHash: missingHash,
            requiredScope: "brain:read",
          }).pipe(Effect.flip);

          return {
            revoked: {
              code: revoked.code,
              authWorkCount: revoked.authWorkCount ?? 0,
            },
            missing: {
              code: missing.code,
              authWorkCount: missing.authWorkCount ?? 0,
            },
          };
        }),
        Schema.Any,
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.revoked.code).toBe("API_KEY_REVOKED");
    expect(result.missing.code).toBe("API_KEY_NOT_FOUND");
    expect(result.revoked.authWorkCount).toBe(result.missing.authWorkCount);
    expect(result.revoked.authWorkCount).toBeGreaterThanOrEqual(2);
  });

  it("rejects public CRUD for non-admin actors before durable writes", async () => {
    const result = await Effect.runPromise(
      createApiKeyForBrain({
        publicInput: {
          name: "Client Alpha read key",
          scopes: ["brain:read"],
          expiresAt: 20_000,
        },
        serverScope: {
          organizationId: "organizations_blocked",
          workspaceId: "workspaces_blocked",
          brainKey: "brain_acme",
        },
        actor: { userId: "users_viewer", role: "viewer" },
        nowMs: 10_000,
      }).pipe(Effect.flip) as Effect.Effect<unknown, unknown, never>,
    );

    expect(result).toBeInstanceOf(Forbidden);
  });
});

const seedApiKeyTenant = () =>
  Effect.gen(function* () {
    const now = 10_000;
    const writer = yield* DatabaseWriter;
    const adminUserId = yield* writer
      .table("users")
      .insert({
        subject: "admin-subject",
        email: "admin@example.com",
        displayName: "Admin",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const viewerUserId = yield* writer
      .table("users")
      .insert({
        subject: "viewer-subject",
        email: "viewer@example.com",
        displayName: "Viewer",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: adminUserId,
        agencyKey: "agency_acme",
        slug: "acme",
        name: "Acme",
        status: "active",
        createdAt: now,
        updatedAt: now,
        lifecycleGeneration: 1,
        revocationGeneration: 1,
      })
      .pipe(Effect.orDie);
    const workspaceId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: adminUserId,
        brainKey: "brain_acme",
        slug: "acme",
        name: "Acme",
        kind: "client",
        clientSlug: "acme",
        status: "active",
        dataClassification: "confidential",
        createdAt: now,
        updatedAt: now,
        lifecycleGeneration: 1,
        revocationGeneration: 1,
      })
      .pipe(Effect.orDie);

    return { organizationId, workspaceId, adminUserId, viewerUserId };
  });
