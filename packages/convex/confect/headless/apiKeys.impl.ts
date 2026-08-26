import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { env } from "../../convex/_generated/server";
import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { requireWorkspaceAccess } from "../capabilities/_kit/workspaceAccess";
import { NotFound, ValidationFailed } from "../errors";
import apiKeys from "./apiKeys.spec";
import { createApiKey, verifyApiKeyHash, type ApiKeyRow } from "./auth";

const ninetyDaysMs = 90 * 24 * 60 * 60 * 1_000;

const unsafeAssumeClockProvided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

const linkedKeyMetadata = (key: ApiKeyRow) => ({
  id: key.id,
  name: key.name,
  displayPrefix: key.displayPrefix,
  scopes: key.scopes.filter((scope) => scope !== "creator:self"),
  status: key.status,
  createdAt: key.createdAt,
  expiresAt: key.expiresAt,
  lastUsedAt: key.lastUsedAt,
});

const createLinkedKey = FunctionImpl.make(
  databaseSchema,
  apiKeys,
  "createLinkedKey",
  ({ workspaceId, name }) =>
    Effect.gen(function* () {
      const trimmedName = name.trim();
      if (trimmedName.length < 1 || trimmedName.length > 80) {
        return yield* new ValidationFailed({
          field: "name",
          message: "Device name must contain between 1 and 80 characters.",
        });
      }
      const access = yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(workspaceId, "viewer"),
      );
      const now = yield* unsafeAssumeClockProvided(Clock.currentTimeMillis);
      const created = yield* Effect.promise(() =>
        createApiKey({
          workspaceId,
          name: trimmedName,
          scopes:
            access.role === "viewer"
              ? ["workspace:read"]
              : ["workspace:read", "workspace:write"],
          createdByUserId: access.userId,
          nowMs: now,
          expiresAt: now + ninetyDaysMs,
        }),
      );
      const reader = yield* DatabaseReader;
      const collision = yield* reader
        .table("apiKeys")
        .index("by_key_hash", (query) =>
          query.eq("keyHash", created.row.keyHash),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (collision !== null) {
        return yield* new ValidationFailed({
          field: "name",
          message: "Could not create a unique terminal credential. Try again.",
        });
      }
      yield* (yield* DatabaseWriter)
        .table("apiKeys")
        .insert(created.row)
        .pipe(Effect.orDie);
      return {
        displayKey: created.displayKey,
        key: linkedKeyMetadata(created.row),
      };
    }),
);

const listLinkedKeys = FunctionImpl.make(
  databaseSchema,
  apiKeys,
  "listLinkedKeys",
  ({ workspaceId }) =>
    Effect.gen(function* () {
      const access = yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(workspaceId, "viewer"),
      );
      const keys = yield* (yield* DatabaseReader)
        .table("apiKeys")
        .index("by_workspace", (query) => query.eq("workspaceId", workspaceId))
        .take(100)
        .pipe(Effect.orDie);
      return keys
        .filter((key) => key.createdByUserId === access.userId)
        .sort((left, right) => right.createdAt - left.createdAt)
        .map(linkedKeyMetadata);
    }),
);

const revokeLinkedKey = FunctionImpl.make(
  databaseSchema,
  apiKeys,
  "revokeLinkedKey",
  ({ workspaceId, keyId }) =>
    Effect.gen(function* () {
      const access = yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(workspaceId, "viewer"),
      );
      const keys = yield* (yield* DatabaseReader)
        .table("apiKeys")
        .index("by_workspace", (query) => query.eq("workspaceId", workspaceId))
        .take(100)
        .pipe(Effect.orDie);
      const key = keys.find(
        (candidate) =>
          candidate.id === keyId && candidate.createdByUserId === access.userId,
      );
      if (key === undefined) {
        return yield* new NotFound({ resource: "apiKeys", id: keyId });
      }
      const now = yield* unsafeAssumeClockProvided(Clock.currentTimeMillis);
      yield* (yield* DatabaseWriter)
        .table("apiKeys")
        .patch(key._id, { status: "revoked", revokedAt: now })
        .pipe(Effect.orDie);
      return null;
    }),
);

const scopesForContractsRole = (role: "primary" | "observer") =>
  role === "primary"
    ? (["workspace:read", "workspace:write"] as const)
    : (["workspace:read"] as const);

const seedLocalContracts = FunctionImpl.make(
  databaseSchema,
  apiKeys,
  "seedLocalContracts",
  ({ namespace, primaryKeyHash, clientKeyHash, observerKeyHash }) =>
    Effect.gen(function* () {
      if (env.MAESTRO_CONTRACT_TEST !== "1") {
        return yield* Effect.die(
          new Error("seedLocalContracts requires MAESTRO_CONTRACT_TEST=1."),
        );
      }

      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const now = yield* Clock.currentTimeMillis;

      const seedActor = (role: "primary" | "observer", keyHash: string) =>
        Effect.gen(function* () {
          const scopes = scopesForContractsRole(role);
          const slug = `${namespace}-${role}`;
          const subject = `contracts:${namespace}:${role}`;
          const keyId = `api_key_${namespace}_${role}`;
          const existingUser = yield* reader
            .table("users")
            .index("by_subject", (query) => query.eq("subject", subject))
            .first()
            .pipe(Effect.map(Option.getOrNull), Effect.orDie);
          const userId: GenericId<"users"> =
            existingUser?._id ??
            (yield* writer
              .table("users")
              .insert({
                subject,
                email: `${slug}@template.local`,
                displayName: `Contracts ${role}`,
                status: "active",
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie));

          const existingOrganization = yield* reader
            .table("organizations")
            .index("by_slug", (query) => query.eq("slug", slug))
            .first()
            .pipe(Effect.map(Option.getOrNull), Effect.orDie);
          const organizationId: GenericId<"organizations"> =
            existingOrganization?._id ??
            (yield* writer
              .table("organizations")
              .insert({
                ownerUserId: userId,
                slug,
                name: `Contracts ${role}`,
                status: "active",
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie));

          const existingWorkspace = yield* reader
            .table("workspaces")
            .index("by_slug", (query) => query.eq("slug", slug))
            .first()
            .pipe(Effect.map(Option.getOrNull), Effect.orDie);
          const workspaceId: GenericId<"workspaces"> =
            existingWorkspace?._id ??
            (yield* writer
              .table("workspaces")
              .insert({
                organizationId,
                ownerUserId: userId,
                slug,
                name: `Contracts ${role}`,
                status: "active",
                dataClassification: "internal",
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie));

          const organizationMembership = yield* reader
            .table("organizationMembers")
            .index("by_organization_user", (query) =>
              query.eq("organizationId", organizationId).eq("userId", userId),
            )
            .first()
            .pipe(Effect.map(Option.getOrNull), Effect.orDie);
          if (organizationMembership === null) {
            yield* writer
              .table("organizationMembers")
              .insert({
                organizationId,
                userId,
                role: "owner",
                status: "active",
                acceptedAt: now,
                revokedAt: null,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }

          const workspaceMembership = yield* reader
            .table("workspaceMembers")
            .index("by_workspace_user", (q) =>
              q.eq("workspaceId", workspaceId).eq("userId", userId),
            )
            .first()
            .pipe(Effect.map(Option.getOrNull), Effect.orDie);
          if (workspaceMembership === null) {
            yield* writer
              .table("workspaceMembers")
              .insert({
                workspaceId,
                userId,
                role: "owner",
                status: "active",
                acceptedAt: now,
                revokedAt: null,
                deletedAt: null,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }

          const existingKey = yield* reader
            .table("apiKeys")
            .index("by_workspace", (query) =>
              query.eq("workspaceId", workspaceId),
            )
            .take(100)
            .pipe(
              Effect.map((keys) => keys.find(({ id }) => id === keyId)),
              Effect.orDie,
            );
          if (existingKey) {
            yield* writer
              .table("apiKeys")
              .patch(existingKey._id, {
                keyHash,
                scopes,
                status: "active",
                createdByUserId: userId,
                expiresAt: null,
                revokedAt: null,
              })
              .pipe(Effect.orDie);
          } else {
            yield* writer
              .table("apiKeys")
              .insert({
                id: keyId,
                workspaceId,
                name: `Local contracts ${role}`,
                keyHash,
                displayPrefix: "contracts",
                scopes,
                status: "active",
                createdByUserId: userId,
                createdAt: now,
                expiresAt: null,
                revokedAt: null,
                lastUsedAt: null,
              })
              .pipe(Effect.orDie);
          }

          return { keyId, workspaceId, userId };
        });

      const primary = yield* seedActor("primary", primaryKeyHash);
      const primaryWorkspace = yield* reader
        .table("workspaces")
        .get(primary.workspaceId)
        .pipe(Effect.orDie);
      if (primaryWorkspace === null) {
        return yield* Effect.die(
          new Error("seedLocalContracts primary workspace was not persisted."),
        );
      }
      const clientSlug = `${namespace}-client`;
      const existingClientWorkspace = yield* reader
        .table("workspaces")
        .index("by_slug", (query) => query.eq("slug", clientSlug))
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      const clientWorkspaceId: GenericId<"workspaces"> =
        existingClientWorkspace?._id ??
        (yield* writer
          .table("workspaces")
          .insert({
            organizationId: primaryWorkspace.organizationId,
            ownerUserId: primary.userId,
            slug: clientSlug,
            name: `Client ${namespace}`,
            status: "active",
            dataClassification: "confidential",
            createdAt: now,
            updatedAt: now,
          })
          .pipe(Effect.orDie));
      const clientMembership = yield* reader
        .table("workspaceMembers")
        .index("by_workspace_user", (query) =>
          query
            .eq("workspaceId", clientWorkspaceId)
            .eq("userId", primary.userId),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (clientMembership === null) {
        yield* writer
          .table("workspaceMembers")
          .insert({
            workspaceId: clientWorkspaceId,
            userId: primary.userId,
            role: "owner",
            status: "active",
            acceptedAt: now,
            revokedAt: null,
            deletedAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .pipe(Effect.orDie);
      }
      const clientKeyId = `api_key_${namespace}_client`;
      const existingClientKey = yield* reader
        .table("apiKeys")
        .index("by_workspace", (query) =>
          query.eq("workspaceId", clientWorkspaceId),
        )
        .take(100)
        .pipe(
          Effect.map((keys) => keys.find(({ id }) => id === clientKeyId)),
          Effect.orDie,
        );
      if (existingClientKey) {
        yield* writer
          .table("apiKeys")
          .patch(existingClientKey._id, {
            keyHash: clientKeyHash,
            scopes: ["workspace:read", "workspace:write"],
            status: "active",
            createdByUserId: primary.userId,
            expiresAt: null,
            revokedAt: null,
          })
          .pipe(Effect.orDie);
      } else {
        yield* writer
          .table("apiKeys")
          .insert({
            id: clientKeyId,
            workspaceId: clientWorkspaceId,
            name: "Local contracts client",
            keyHash: clientKeyHash,
            displayPrefix: "contracts",
            scopes: ["workspace:read", "workspace:write"],
            status: "active",
            createdByUserId: primary.userId,
            createdAt: now,
            expiresAt: null,
            revokedAt: null,
            lastUsedAt: null,
          })
          .pipe(Effect.orDie);
      }
      const client = {
        keyId: clientKeyId,
        workspaceId: clientWorkspaceId,
        userId: primary.userId,
      };
      const observer = yield* seedActor("observer", observerKeyHash);
      const observerPageTitle = `Other Brain ${namespace}`;
      const observerPages = yield* reader
        .table("brainPages")
        .index("by_workspace", (query) =>
          query.eq("workspaceId", observer.workspaceId),
        )
        .collect()
        .pipe(Effect.orDie);
      if (!observerPages.some(({ title }) => title === observerPageTitle)) {
        const pageId = yield* writer
          .table("brainPages")
          .insert({
            workspaceId: observer.workspaceId,
            slug: `other-brain-${namespace}`,
            title: observerPageTitle,
            markdown: `# ${observerPageTitle}\n\nObserver-only company context.`,
            sourceKind: "markdown",
            parentPageId: null,
            sortKey: `other-brain-${namespace}`,
            favorite: false,
            status: "active",
            createdAt: now,
            updatedAt: now,
          })
          .pipe(Effect.orDie);
        yield* writer
          .table("pageRevisions")
          .insert({
            workspaceId: observer.workspaceId,
            pageId,
            priorUpdatedAt: null,
            updatedAt: now,
            title: observerPageTitle,
            markdown: `# ${observerPageTitle}\n\nObserver-only company context.`,
            sourceKind: "markdown",
            causation: "create",
            parentPageId: null,
            sortKey: `other-brain-${namespace}`,
            favorite: false,
            status: "active",
            actorUserId: observer.userId,
            createdAt: now,
          })
          .pipe(Effect.orDie);
      }
      return { primary, client, observer };
    }),
);

const resolve = FunctionImpl.make(
  databaseSchema,
  apiKeys,
  "resolve",
  ({ keyHash, workspaceSlug, requiredScope, nowMs }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const rows = yield* reader
        .table("apiKeys")
        .index("by_key_hash", (q) => q.eq("keyHash", keyHash))
        .take(2)
        .pipe(Effect.orDie);
      const verified = yield* Effect.promise(() =>
        verifyApiKeyHash({
          presentedHash: keyHash,
          rows,
          requiredScope,
          nowMs,
        }),
      );
      if (!verified.ok) {
        return {
          ok: false as const,
          code: verified.error.code,
          message: verified.error.message,
        };
      }

      const workspace = yield* reader
        .table("workspaces")
        .index("by_slug", (q) => q.eq("slug", workspaceSlug))
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (workspace === null || workspace._id !== verified.workspaceId) {
        return {
          ok: false as const,
          code: "API_KEY_WORKSPACE_MISMATCH" as const,
          message: "API key is bound to a different workspace.",
        };
      }

      const key = rows.find(({ id }) => id === verified.keyId);
      if (!key) {
        return {
          ok: false as const,
          code: "API_KEY_NOT_FOUND" as const,
          message: "API key was not found.",
        };
      }
      return {
        ok: true as const,
        keyId: verified.keyId,
        workspaceId: workspace._id,
        userId: key.createdByUserId as GenericId<"users">,
      };
    }),
);

const resolveCredential = FunctionImpl.make(
  databaseSchema,
  apiKeys,
  "resolveCredential",
  ({ keyHash, requiredScope, nowMs }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const rows = yield* reader
        .table("apiKeys")
        .index("by_key_hash", (q) => q.eq("keyHash", keyHash))
        .take(2)
        .pipe(Effect.orDie);
      const verified = yield* Effect.promise(() =>
        verifyApiKeyHash({
          presentedHash: keyHash,
          rows,
          requiredScope,
          nowMs,
        }),
      );
      if (!verified.ok) {
        return {
          ok: false as const,
          code: verified.error.code,
          message: verified.error.message,
        };
      }

      const key = rows.find(({ id }) => id === verified.keyId);
      if (!key) {
        return {
          ok: false as const,
          code: "API_KEY_NOT_FOUND" as const,
          message: "API key was not found.",
        };
      }
      return {
        ok: true as const,
        keyId: verified.keyId,
        workspaceId: verified.workspaceId as GenericId<"workspaces">,
        userId: key.createdByUserId as GenericId<"users">,
      };
    }),
);

export default GroupImpl.make(databaseSchema, apiKeys).pipe(
  Layer.provide(createLinkedKey),
  Layer.provide(listLinkedKeys),
  Layer.provide(revokeLinkedKey),
  Layer.provide(seedLocalContracts),
  Layer.provide(resolve),
  Layer.provide(resolveCredential),
  GroupImpl.finalize,
);
