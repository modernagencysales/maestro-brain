import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import refs from "../_generated/refs";
import {
  Auth,
  DatabaseReader,
  DatabaseWriter,
  MutationRunner,
} from "../_generated/services";
import {
  CapacityExceeded,
  ClientBrainAlreadyExists,
  Forbidden,
  OrganizationNotFound,
  ProvisioningConflict,
  Unauthorized,
  ValidationFailed,
} from "../errors";
import { asGenericId } from "./handlerContext";
import { recordAccessLifecycleEvents } from "./audit";
import provisioning from "./provisioning.spec";
import {
  buildProvisioningPlan,
  extractIdentityBinding,
  extractIdentityProfile,
  requireInsertValue,
  selectLiveOwnedOrganization,
  selectLiveOwnedWorkspace,
  type UserProvisioningRow,
} from "./provisioning";
import {
  deriveStableAgencyKey,
  deriveStableBrainKey,
  isStableAgencyKey,
  isStableBrainKey,
} from "../identity/stableKeys";
import { buildStandardClientBriefPages } from "../brain/clientBrief";
import { roleAtLeast } from "./roles";
import { readProcessEnv } from "../shared/env";
import { sha256Hex } from "../shared/sha256";

const conflict = (resource: string, message: string) =>
  new ProvisioningConflict({ resource, message });

const loadVerifiedWorkosIdentity = (subject: string) => {
  const apiKey = readProcessEnv().WORKOS_API_KEY?.trim();
  if (!apiKey) return Effect.fail(new Unauthorized());
  return Effect.tryPromise({
    try: () =>
      fetch(
        `https://api.workos.com/user_management/users/${encodeURIComponent(subject)}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      )
        .then((response) =>
          response.ok
            ? response.json()
            : Promise.reject(new Error("WorkOS user lookup failed.")),
        )
        .then((value) => {
          const user = value as Record<string, unknown>;
          return {
            subject: typeof user.id === "string" ? user.id : null,
            name: typeof user.name === "string" ? user.name : null,
            email: typeof user.email === "string" ? user.email : null,
            emailVerified:
              typeof user.email_verified === "boolean"
                ? user.email_verified
                : null,
          };
        }),
    catch: () => new Unauthorized(),
  });
};

const assertNoOtherWorkosBinding = (input: {
  readonly workosOrganizationId: string | undefined;
  readonly organizationId: GenericId<"organizations"> | null;
}) =>
  Effect.gen(function* () {
    if (input.workosOrganizationId === undefined) return;
    const rows = yield* (yield* DatabaseReader)
      .table("organizations")
      .index("by_workos_organization", (q) =>
        q.eq("workosOrganizationId", input.workosOrganizationId),
      )
      .collect()
      .pipe(Effect.orDie);
    if (rows.some((row) => row._id !== input.organizationId)) {
      return yield* Effect.fail(
        conflict(
          "organizations.workosOrganizationId",
          "Authenticated WorkOS organization is already bound.",
        ),
      );
    }
  });

const assertUniqueAgencyKey = (input: {
  readonly organizationId: GenericId<"organizations">;
  readonly agencyKey: string;
}) =>
  Effect.gen(function* () {
    if (!isStableAgencyKey(input.agencyKey)) {
      return yield* Effect.fail(
        conflict(
          "organizations.agencyKey",
          "Persisted agency key syntax is invalid.",
        ),
      );
    }
    const rows = yield* (yield* DatabaseReader)
      .table("organizations")
      .index("by_agency_key", (q) => q.eq("agencyKey", input.agencyKey))
      .collect()
      .pipe(Effect.orDie);
    if (rows.some((row) => row._id !== input.organizationId)) {
      return yield* Effect.fail(
        conflict(
          "organizations.agencyKey",
          "Persisted agency key is duplicated.",
        ),
      );
    }
  });

const assertUniqueBrainKey = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly organizationId: GenericId<"organizations">;
  readonly brainKey: string;
}) =>
  Effect.gen(function* () {
    if (!isStableBrainKey(input.brainKey)) {
      return yield* Effect.fail(
        conflict(
          "workspaces.brainKey",
          "Persisted Brain key syntax is invalid.",
        ),
      );
    }
    const rows = yield* (yield* DatabaseReader)
      .table("workspaces")
      .index("by_organization_brain_key", (q) =>
        q
          .eq("organizationId", input.organizationId)
          .eq("brainKey", input.brainKey),
      )
      .collect()
      .pipe(Effect.orDie);
    if (rows.some((row) => row._id !== input.workspaceId)) {
      return yield* Effect.fail(
        conflict(
          "workspaces.organizationId.brainKey",
          "Persisted Brain key is duplicated inside organization.",
        ),
      );
    }
  });

const ensureProvisionedFromWorkos = FunctionImpl.make(
  databaseSchema,
  provisioning,
  "ensureProvisionedFromWorkos",
  () =>
    Effect.gen(function* () {
      const auth = yield* Auth;
      const claims = yield* auth.getUserIdentity.pipe(
        Effect.mapError(() => new Unauthorized()),
      );
      const subject = claims.subject?.trim();
      if (!subject) return yield* new Unauthorized();
      const identity = yield* extractIdentityProfile(claims).pipe(
        Effect.catchTag("ValidationFailed", () =>
          loadVerifiedWorkosIdentity(subject).pipe(
            Effect.flatMap((providerIdentity) =>
              extractIdentityProfile(claims, providerIdentity),
            ),
          ),
        ),
      );
      const runMutation = yield* MutationRunner;
      yield* runMutation(
        refs.internal.access.provisioning.seedVerifiedWorkosUser,
        {
          subject: identity.subject,
          email: identity.email,
          emailVerified: true,
          name: identity.displayName,
        },
      ).pipe(Effect.catchTag("ParseError", Effect.die));
      return yield* runMutation(
        refs.public.access.provisioning.ensureProvisioned,
        {},
      ).pipe(Effect.catchTag("ParseError", Effect.die));
    }),
);

const seedVerifiedWorkosUser = FunctionImpl.make(
  databaseSchema,
  provisioning,
  "seedVerifiedWorkosUser",
  (providerIdentity) =>
    Effect.gen(function* () {
      const auth = yield* Auth;
      const identity = yield* extractIdentityProfile(
        yield* auth.getUserIdentity.pipe(
          Effect.mapError(() => new Unauthorized()),
        ),
        {
          subject: providerIdentity.subject,
          email: providerIdentity.email,
          emailVerified: providerIdentity.emailVerified,
          ...(providerIdentity.name === undefined
            ? {}
            : { name: providerIdentity.name }),
        },
      );
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const now = yield* Clock.currentTimeMillis;
      const existing = yield* reader
        .table("users")
        .index("by_subject", (q) => q.eq("subject", identity.subject))
        .first()
        .pipe(
          Effect.map(Option.getOrNull),
          Effect.map((user) =>
            user === null ? null : toProvisioningUser(user),
          ),
          Effect.orDie,
        );
      const userPlan = (yield* buildProvisioningPlan({
        identity,
        state: {
          user: existing,
          liveOrganization: null,
          liveWorkspace: null,
          organizationMembership: null,
          workspaceMembership: null,
        },
        now,
      })).user;
      if (existing === null) {
        yield* writer
          .table("users")
          .insert(requireInsertValue(userPlan, "user"))
          .pipe(Effect.orDie);
      } else if (userPlan.action === "patch") {
        yield* writer
          .table("users")
          .patch(asGenericId<"users">(existing._id), userPlan.value)
          .pipe(Effect.orDie);
      }
      return null;
    }),
);

const ensureProvisioned = FunctionImpl.make(
  databaseSchema,
  provisioning,
  "ensureProvisioned",
  () =>
    Effect.gen(function* () {
      const auth = yield* Auth;
      const claims = yield* auth.getUserIdentity.pipe(
        Effect.mapError(() => new Unauthorized()),
      );
      const subject = (claims.subject ?? claims.tokenIdentifier)?.trim();
      if (!subject) return yield* new Unauthorized();
      const reader = yield* DatabaseReader;
      const existingUser = yield* reader
        .table("users")
        .index("by_subject", (q) => q.eq("subject", subject))
        .first()
        .pipe(
          Effect.map(Option.getOrNull),
          Effect.map((user) =>
            user === null ? null : toProvisioningUser(user),
          ),
          Effect.orDie,
        );
      const storedIdentity =
        claims.email == null && existingUser !== null
          ? {
              subject: existingUser.subject,
              email: existingUser.email,
              emailVerified: true,
              ...(existingUser.displayName === undefined
                ? {}
                : { name: existingUser.displayName }),
            }
          : undefined;
      const identity = yield* extractIdentityProfile(claims, storedIdentity);
      const now = yield* Clock.currentTimeMillis;
      const writer = yield* DatabaseWriter;

      const userPlan = (yield* buildProvisioningPlan({
        identity,
        state: {
          user: existingUser,
          liveOrganization: null,
          liveWorkspace: null,
          organizationMembership: null,
          workspaceMembership: null,
        },
        now,
      })).user;

      const userId: GenericId<"users"> =
        existingUser === null
          ? yield* writer
              .table("users")
              .insert(requireInsertValue(userPlan, "user"))
              .pipe(Effect.orDie)
          : asGenericId<"users">(existingUser._id);

      if (existingUser !== null && userPlan.action === "patch") {
        yield* writer
          .table("users")
          .patch(asGenericId<"users">(existingUser._id), userPlan.value)
          .pipe(Effect.orDie);
      }

      const organizations = yield* reader
        .table("organizations")
        .index("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(100)
        .pipe(Effect.orDie);
      const existingOrganization = yield* selectLiveOwnedOrganization(
        organizations,
        userId,
      );

      const workspaces =
        existingOrganization === null
          ? []
          : yield* reader
              .table("workspaces")
              .index("by_organization", (q) =>
                q.eq("organizationId", existingOrganization._id),
              )
              .take(100)
              .pipe(Effect.orDie);
      const existingWorkspace = yield* selectLiveOwnedWorkspace(
        workspaces,
        userId,
      );

      const organizationMembership =
        existingOrganization === null
          ? null
          : yield* reader
              .table("organizationMembers")
              .index("by_organization_user", (q) =>
                q
                  .eq("organizationId", existingOrganization._id)
                  .eq("userId", userId),
              )
              .first()
              .pipe(Effect.map(Option.getOrNull), Effect.orDie);

      const workspaceMembership =
        existingWorkspace === null
          ? null
          : yield* reader
              .table("workspaceMembers")
              .index("by_workspace_user", (q) =>
                q.eq("workspaceId", existingWorkspace._id).eq("userId", userId),
              )
              .first()
              .pipe(Effect.map(Option.getOrNull), Effect.orDie);

      yield* assertNoOtherWorkosBinding({
        workosOrganizationId: identity.workosOrganizationId,
        organizationId:
          existingOrganization === null
            ? null
            : asGenericId<"organizations">(existingOrganization._id),
      });
      if (existingOrganization?.agencyKey !== undefined) {
        yield* assertUniqueAgencyKey({
          organizationId: asGenericId<"organizations">(
            existingOrganization._id,
          ),
          agencyKey: existingOrganization.agencyKey,
        });
      }
      if (existingWorkspace?.brainKey !== undefined) {
        yield* assertUniqueBrainKey({
          workspaceId: asGenericId<"workspaces">(existingWorkspace._id),
          organizationId: asGenericId<"organizations">(
            existingWorkspace.organizationId,
          ),
          brainKey: existingWorkspace.brainKey,
        });
      }

      const plan = yield* buildProvisioningPlan({
        identity,
        state: {
          user: existingUser,
          liveOrganization: existingOrganization,
          liveWorkspace: existingWorkspace,
          organizationMembership,
          workspaceMembership,
        },
        now,
      });

      const existingOrganizationId =
        existingOrganization === null
          ? null
          : asGenericId<"organizations">(existingOrganization._id);
      const organizationInsert =
        existingOrganizationId === null
          ? requireInsertValue(plan.organization, "organization")
          : null;
      const organizationId: GenericId<"organizations"> =
        existingOrganizationId ??
        (yield* writer
          .table("organizations")
          .insert({
            ...requireInsertValue(plan.organization, "organization"),
            ownerUserId: userId,
          })
          .pipe(Effect.orDie));

      if (organizationInsert !== null) {
        const inserted = yield* reader
          .table("organizations")
          .get(organizationId)
          .pipe(Effect.orDie);
        const agencyKey = deriveStableAgencyKey({
          _id: organizationId,
          createdAt: organizationInsert.createdAt,
          _creationTime: inserted?._creationTime,
        });
        yield* assertUniqueAgencyKey({ organizationId, agencyKey });
        yield* writer
          .table("organizations")
          .patch(organizationId, { agencyKey })
          .pipe(Effect.orDie);
      }

      if (
        existingOrganization !== null &&
        plan.organization.action === "patch"
      ) {
        if (plan.organization.value.agencyKey !== undefined) {
          yield* assertUniqueAgencyKey({
            organizationId: asGenericId<"organizations">(
              existingOrganization._id,
            ),
            agencyKey: plan.organization.value.agencyKey,
          });
        }
        yield* writer
          .table("organizations")
          .patch(
            asGenericId<"organizations">(existingOrganization._id),
            plan.organization.value,
          )
          .pipe(Effect.orDie);
      }

      const existingWorkspaceId =
        existingWorkspace === null
          ? null
          : asGenericId<"workspaces">(existingWorkspace._id);
      const workspaceInsert =
        existingWorkspaceId === null
          ? requireInsertValue(plan.workspace, "workspace")
          : null;
      const workspaceId: GenericId<"workspaces"> =
        existingWorkspaceId ??
        (yield* writer
          .table("workspaces")
          .insert({
            ...requireInsertValue(plan.workspace, "workspace"),
            organizationId,
            ownerUserId: userId,
          })
          .pipe(Effect.orDie));

      if (workspaceInsert !== null) {
        const inserted = yield* reader
          .table("workspaces")
          .get(workspaceId)
          .pipe(Effect.orDie);
        const brainKey = deriveStableBrainKey({
          _id: workspaceId,
          createdAt: workspaceInsert.createdAt,
          _creationTime: inserted?._creationTime,
        });
        yield* assertUniqueBrainKey({ workspaceId, organizationId, brainKey });
        yield* writer
          .table("workspaces")
          .patch(workspaceId, { brainKey })
          .pipe(Effect.orDie);
      }

      if (existingWorkspace !== null && plan.workspace.action === "patch") {
        if (plan.workspace.value.brainKey !== undefined) {
          yield* assertUniqueBrainKey({
            workspaceId: asGenericId<"workspaces">(existingWorkspace._id),
            organizationId,
            brainKey: plan.workspace.value.brainKey,
          });
        }
        yield* writer
          .table("workspaces")
          .patch(
            asGenericId<"workspaces">(existingWorkspace._id),
            plan.workspace.value,
          )
          .pipe(Effect.orDie);
      }

      // The two membership upserts below are deliberately kept inline rather than
      // factored into a shared `upsertMembership<T extends TableNames>` helper.
      // confect's writer types `.insert` against a *concrete* table literal
      // (`WithoutSystemFields<DocumentByName<…, T>>`); inside a helper generic
      // over `T`, TypeScript cannot prove the value matches that mapping, so the
      // helper only compiles with an `as` assertion — which discards the concrete
      // insert-shape check these literal call sites get for free (our first line
      // of defense against schema drift between the provisioning rows and the
      // Convex schema). The parallel structure is the price of that check, and
      // it is worth more than removing the duplication. Never reach for `any`
      // here. See docs/template/coding-standards.md ("Multi-table Convex writes").
      if (organizationMembership === null) {
        yield* writer
          .table("organizationMembers")
          .insert({
            ...requireInsertValue(
              plan.organizationMembership,
              "organizationMembership",
            ),
            organizationId,
            userId,
          })
          .pipe(Effect.orDie);
      } else if (plan.organizationMembership.action === "patch") {
        yield* writer
          .table("organizationMembers")
          .patch(organizationMembership._id, plan.organizationMembership.value)
          .pipe(Effect.orDie);
      }

      if (workspaceMembership === null) {
        yield* writer
          .table("workspaceMembers")
          .insert({
            ...requireInsertValue(
              plan.workspaceMembership,
              "workspaceMembership",
            ),
            workspaceId,
            userId,
          })
          .pipe(Effect.orDie);
      } else if (plan.workspaceMembership.action === "patch") {
        yield* writer
          .table("workspaceMembers")
          .patch(workspaceMembership._id, plan.workspaceMembership.value)
          .pipe(Effect.orDie);
      }

      const persistedWorkspace = yield* reader
        .table("workspaces")
        .get(workspaceId)
        .pipe(Effect.orDie);
      if (persistedWorkspace?.brainKey === undefined) {
        return yield* Effect.fail(
          conflict(
            "workspaces.brainKey",
            "Provisioned Brain key was not persisted.",
          ),
        );
      }

      return { brainKey: persistedWorkspace.brainKey };
    }),
);

type ClientBriefPageInsert = (page: {
  readonly slug: string;
  readonly title: string;
  readonly markdown: string;
  readonly sortKey: string;
  readonly pageKey: string;
  readonly favorite: boolean;
}) => Effect.Effect<unknown, ProvisioningConflict, never>;

export const insertStandardClientBriefPages = (input: {
  readonly brainKey: string;
  readonly insertPage: ClientBriefPageInsert;
}) =>
  Effect.gen(function* () {
    const pages = buildStandardClientBriefPages(input.brainKey);
    for (const page of pages) {
      yield* input.insertPage({
        slug: page.slug,
        title: page.title,
        markdown: page.markdown,
        sortKey: page.sortKey,
        pageKey: page.pageKey,
        favorite: page.slug === "overview",
      });
    }
    return pages;
  });

const CLIENT_BRAIN_LIMIT = 25;

const normalizeIdempotencyKey = (idempotencyKey: string) => {
  const normalized = idempotencyKey.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(normalized)
    ? normalized
    : null;
};

const payloadHash = (input: {
  readonly name: string;
  readonly clientSlug: string;
}) => `${input.clientSlug}:${input.name}`;

const toClientBrainResult = (input: {
  readonly brainKey: string;
  readonly pages: readonly ReturnType<
    typeof buildStandardClientBriefPages
  >[number][];
  readonly clientBrains: number;
}) => ({
  brainKey: input.brainKey,
  initialPageKey: input.pages[0]?.pageKey ?? "",
  pages: input.pages.map(({ pageKey, slug, title, sortKey }) => ({
    pageKey,
    slug,
    title,
    sortKey,
  })),
  capacity: {
    clientBrains: input.clientBrains,
    clientBrainLimit: CLIENT_BRAIN_LIMIT,
    remainingClientBrains: Math.max(0, CLIENT_BRAIN_LIMIT - input.clientBrains),
  },
});

const createClientBrain = FunctionImpl.make(
  databaseSchema,
  provisioning,
  "createClientBrain",
  ({ name, clientSlug, idempotencyKey }) =>
    Effect.gen(function* () {
      const normalizedName = name.trim();
      const normalizedSlug = clientSlug.trim().toLowerCase();
      const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
      if (normalizedName.length === 0) {
        return yield* new ValidationFailed({
          field: "name",
          message: "Client Brain name is required.",
        });
      }
      if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(normalizedSlug)) {
        return yield* new ValidationFailed({
          field: "clientSlug",
          message:
            "Client slug must be lower-case letters, numbers, or dashes.",
        });
      }
      if (normalizedKey === null) {
        return yield* new ValidationFailed({
          field: "idempotencyKey",
          message: "Idempotency key must be stable and at least 8 characters.",
        });
      }

      const auth = yield* Auth;
      const identity = yield* extractIdentityBinding(
        yield* auth.getUserIdentity.pipe(
          Effect.mapError(() => new Unauthorized()),
        ),
      );
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const now = yield* Clock.currentTimeMillis;
      const user = yield* reader
        .table("users")
        .index("by_subject", (q) => q.eq("subject", identity.subject))
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (user === null || user.status !== "active")
        return yield* new Unauthorized();
      if (identity.workosOrganizationId === undefined)
        return yield* new Unauthorized();

      const organizations = yield* reader
        .table("organizations")
        .index("by_workos_organization", (q) =>
          q.eq("workosOrganizationId", identity.workosOrganizationId),
        )
        .collect()
        .pipe(Effect.orDie);
      const activeOrganizations = organizations.filter(
        (row) => row.status === "active",
      );
      if (activeOrganizations.length === 0) {
        return yield* new OrganizationNotFound({
          workosOrganizationId: identity.workosOrganizationId,
        });
      }
      if (activeOrganizations.length > 1) {
        return yield* new ProvisioningConflict({
          resource: "organizations.workosOrganizationId",
          message:
            "Authenticated WorkOS organization resolved to multiple active organizations.",
        });
      }
      const organization = activeOrganizations[0];
      if (organization === undefined) {
        return yield* new OrganizationNotFound({
          workosOrganizationId: identity.workosOrganizationId,
        });
      }
      const organizationId = asGenericId<"organizations">(organization._id);
      if (organization.agencyKey === undefined) {
        return yield* new ProvisioningConflict({
          resource: "organizations.agencyKey",
          message: "Active organization is missing a stable agency key.",
        });
      }
      yield* assertUniqueAgencyKey({
        organizationId,
        agencyKey: organization.agencyKey,
      });

      const orgMemberships = yield* reader
        .table("organizationMembers")
        .index("by_organization_user", (q) =>
          q.eq("organizationId", organizationId).eq("userId", user._id),
        )
        .collect()
        .pipe(Effect.orDie);
      const liveMemberships = orgMemberships.filter(
        (member) =>
          member.status === "active" &&
          member.acceptedAt !== null &&
          member.revokedAt === null,
      );
      if (liveMemberships.length > 1) {
        return yield* new ProvisioningConflict({
          resource: "organizationMembers.organizationId.userId",
          message: "Duplicate live organization memberships found.",
        });
      }
      const liveMembership = liveMemberships[0];
      if (
        liveMembership === undefined ||
        !roleAtLeast(liveMembership.role, "admin")
      ) {
        return yield* new Forbidden({
          reason: "Admin organization role required.",
        });
      }

      const existing = yield* reader
        .table("workspaces")
        .index("by_organization", (q) => q.eq("organizationId", organizationId))
        .collect()
        .pipe(Effect.orDie);
      const activeAgencyBrains = existing.filter(
        (row) => row.status === "active" && (row.kind ?? "agency") === "agency",
      );
      if (activeAgencyBrains.length !== 1) {
        return yield* new ProvisioningConflict({
          resource: "workspaces.organizationId.kind",
          message: "Exactly one active Agency Brain is required.",
        });
      }

      const idempotencyRows = yield* reader
        .table("workspaces")
        .index("by_organization_client_idempotency", (q) =>
          q
            .eq("organizationId", organizationId)
            .eq("clientCreationIdempotencyKey", normalizedKey),
        )
        .collect()
        .pipe(Effect.orDie);
      if (idempotencyRows.length > 1) {
        return yield* new ProvisioningConflict({
          resource: "workspaces.organizationId.clientCreationIdempotencyKey",
          message: "Duplicate client creation idempotency rows found.",
        });
      }
      const requestHash = payloadHash({
        name: normalizedName,
        clientSlug: normalizedSlug,
      });
      const idempotentRow = idempotencyRows[0];
      if (idempotentRow !== undefined) {
        if (
          idempotentRow.status !== "active" ||
          (idempotentRow.kind ?? "agency") !== "client" ||
          idempotentRow.clientSlug !== normalizedSlug ||
          idempotentRow.name !== normalizedName ||
          idempotentRow.clientCreationPayloadHash !== requestHash ||
          idempotentRow.brainKey === undefined
        ) {
          return yield* new ProvisioningConflict({
            resource: "workspaces.organizationId.clientCreationIdempotencyKey",
            message:
              "Idempotency key does not reference an active matching client Brain.",
          });
        }
        const pageRows = yield* reader
          .table("brainPages")
          .index("by_workspace", (q) => q.eq("workspaceId", idempotentRow._id))
          .collect()
          .pipe(Effect.orDie);
        const expectedPages = buildStandardClientBriefPages(
          idempotentRow.brainKey,
        );
        const activePageKeys = pageRows
          .filter((page) => page.status === "active")
          .map((page) => page.pageKey);
        const expectedPageKeys = expectedPages.map((page) => page.pageKey);
        if (
          activePageKeys.length !== expectedPageKeys.length ||
          new Set(activePageKeys).size !== activePageKeys.length ||
          expectedPageKeys.some((pageKey) => !activePageKeys.includes(pageKey))
        ) {
          return yield* new ProvisioningConflict({
            resource: "brainPages.workspaceId.pageKey",
            message:
              "Idempotent client Brain replay found an incomplete Brief seed.",
          });
        }
        const activeClientCount = existing.filter(
          (row) =>
            row.status === "active" && (row.kind ?? "agency") === "client",
        ).length;
        return toClientBrainResult({
          brainKey: idempotentRow.brainKey,
          pages: expectedPages,
          clientBrains: activeClientCount,
        });
      }

      if (existing.some((row) => row.clientSlug === normalizedSlug)) {
        return yield* new ClientBrainAlreadyExists({
          clientSlug: normalizedSlug,
        });
      }
      const activeClientCount = existing.filter(
        (row) => row.status === "active" && (row.kind ?? "agency") === "client",
      ).length;
      if (activeClientCount >= CLIENT_BRAIN_LIMIT) {
        return yield* new CapacityExceeded({ limit: CLIENT_BRAIN_LIMIT });
      }

      const workspaceId = yield* writer
        .table("workspaces")
        .insert({
          organizationId,
          ownerUserId: user._id,
          slug: normalizedSlug,
          name: normalizedName,
          kind: "client",
          clientSlug: normalizedSlug,
          clientCreationIdempotencyKey: normalizedKey,
          clientCreationPayloadHash: requestHash,
          status: "active",
          dataClassification: "confidential",
          createdAt: now,
          updatedAt: now,
          lifecycleGeneration: 0,
          revocationGeneration: 0,
        })
        .pipe(Effect.orDie);
      const inserted = yield* reader
        .table("workspaces")
        .get(workspaceId)
        .pipe(Effect.orDie);
      const brainKey = deriveStableBrainKey({
        _id: workspaceId,
        createdAt: now,
        _creationTime: inserted?._creationTime,
      });
      yield* assertUniqueBrainKey({ workspaceId, organizationId, brainKey });
      yield* writer
        .table("workspaces")
        .patch(workspaceId, { brainKey })
        .pipe(Effect.orDie);

      const pages = yield* insertStandardClientBriefPages({
        brainKey,
        insertPage: (page) =>
          Effect.gen(function* () {
            const revisionKey = `rev_${sha256Hex(
              JSON.stringify({ workspaceId, pageKey: page.pageKey }),
            ).slice(0, 32)}`;
            const lifecycle = {
              state: "active" as const,
              generation: 1,
              updatedAt: now,
              purgeAfter: null,
            };
            yield* writer
              .table("pageRevisions")
              .insert({
                workspaceId,
                organizationId,
                pageKey: page.pageKey,
                revisionKey,
                priorRevisionKey: null,
                blockNoteJson: "",
                markdown: page.markdown,
                contentHash: sha256Hex(page.markdown),
                causation: "migration",
                actor: { kind: "migration", id: "client-brief-seed" },
                modelReceiptKey: null,
                effectKey: `access.provisioning.clientBrief:${workspaceId}:${page.pageKey}`,
                state: "published",
                lifecycle,
                createdAt: now,
                schemaVersion: 1,
              })
              .pipe(Effect.orDie);
            yield* writer.table("brainPages").insert({
              workspaceId,
              organizationId,
              slug: page.slug,
              title: page.title,
              markdown: page.markdown,
              sourceKind: "markdown",
              updatedAt: now,
              pageKey: page.pageKey,
              parentPageKey: null,
              siblingSlug: page.slug,
              sortKey: page.sortKey,
              favorite: page.favorite,
              status: "active",
              currentRevisionKey: revisionKey,
              lifecycle,
              createdAt: now,
              schemaVersion: 1,
            });
          }).pipe(Effect.orDie),
      });
      const membershipId = yield* writer
        .table("workspaceMembers")
        .insert({
          workspaceId,
          userId: user._id,
          role: "owner",
          status: "active",
          acceptedAt: now,
          revokedAt: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
      yield* recordAccessLifecycleEvents(
        writer,
        [
          {
            action: "member.ownershipTransferred",
            workspaceId,
            actorUserId: user._id,
            subjectKind: "workspaceMember",
            subjectId: membershipId,
            metadata: { role: "owner" },
          },
        ],
        now,
      );
      return toClientBrainResult({
        brainKey,
        pages,
        clientBrains: activeClientCount + 1,
      });
    }),
);

const toProvisioningUser = (user: {
  readonly _id: GenericId<"users">;
  readonly subject: string;
  readonly email: string;
  readonly displayName?: string | undefined;
  readonly status: "active" | "suspended" | "deleted";
  readonly createdAt: number;
  readonly updatedAt: number;
}): UserProvisioningRow => ({
  _id: user._id,
  subject: user.subject,
  email: user.email,
  ...(user.displayName === undefined ? {} : { displayName: user.displayName }),
  status: user.status,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export default GroupImpl.make(databaseSchema, provisioning).pipe(
  Layer.provide(ensureProvisioned),
  Layer.provide(ensureProvisionedFromWorkos),
  Layer.provide(seedVerifiedWorkosUser),
  Layer.provide(createClientBrain),
  GroupImpl.finalize,
);
