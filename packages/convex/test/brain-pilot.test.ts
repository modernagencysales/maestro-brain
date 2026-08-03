import { TestConfect } from "@confect/test";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseWriter } from "../confect/_generated/services";
import type { Role } from "../confect/access/roles";
import { Forbidden } from "../confect/errors";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;
const brainKey = "br_0123456789ABCDEFGHJKMNPQRS";

type SeededBrain = {
  readonly organizationId: GenericId<"organizations">;
  readonly workspaceId: GenericId<"workspaces">;
};

const seedBrain = (input: {
  readonly role: Role;
  readonly subject: string;
  readonly email: string;
  readonly brainKey: string;
}): Effect.Effect<SeededBrain, never, DatabaseWriter> =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const userId = yield* writer
      .table("users")
      .insert({
        subject: input.subject,
        email: input.email,
        displayName: input.subject,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: userId,
        name: input.brainKey,
        slug: input.brainKey.toLowerCase(),
        status: "active",
        workosOrganizationId: `org_${input.subject}`,
        agencyKey: `ag_${input.brainKey.slice(3)}`,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("organizationMembers")
      .insert({
        organizationId,
        userId,
        role: input.role,
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const workspaceId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: userId,
        brainKey: input.brainKey,
        name: input.brainKey,
        slug: `${input.brainKey.toLowerCase()}-workspace`,
        status: "active",
        dataClassification: "internal",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("workspaceMembers")
      .insert({
        workspaceId,
        userId,
        role: input.role,
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    return { organizationId, workspaceId };
  });

const actor = (
  confect: TestConfect.TestConfect<typeof databaseSchema>,
  subject: string,
  email: string,
) =>
  confect.withIdentity({
    subject,
    email,
    emailVerified: true,
    workosOrganizationId: `org_${subject}`,
  });

describe("Brain pilot contract", () => {
  it("keeps submitted notes pending until an editor approves them", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        yield* confect.run(
          seedBrain({
            role: "editor",
            subject: "editor",
            email: "editor@example.com",
            brainKey,
          }),
        );
        const editor = actor(confect, "editor", "editor@example.com");
        const submitted = yield* editor.mutation(
          refs.public.brain.pilot.submitNote,
          {
            brainKey,
            title: "Founder interview",
            markdown: "The product is source-backed.",
          },
        );
        const reviewed = yield* editor.mutation(
          refs.public.brain.pilot.reviewNote,
          {
            brainKey,
            sourceKey: submitted.sourceKey,
            decision: "approve",
          },
        );
        return { submitted, reviewed };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.submitted.status).toBe("pending_review");
    expect(result.reviewed).toEqual({
      sourceKey: result.submitted.sourceKey,
      status: "published",
    });
  });

  it("rejects review and prevents rejected notes from search", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        yield* confect.run(
          seedBrain({
            role: "editor",
            subject: "rejector",
            email: "rejector@example.com",
            brainKey,
          }),
        );
        const editor = actor(confect, "rejector", "rejector@example.com");
        const submitted = yield* editor.mutation(
          refs.public.brain.pilot.submitNote,
          {
            brainKey,
            title: "Secret",
            markdown: "Should not be searchable.",
          },
        );
        const rejected = yield* editor.mutation(
          refs.public.brain.pilot.reviewNote,
          {
            brainKey,
            sourceKey: submitted.sourceKey,
            decision: "reject",
          },
        );
        const search = yield* editor.query(refs.public.brain.pilot.search, {
          brainKey,
          query: "searchable",
        });
        return { rejected, search };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.rejected.status).toBe("rejected");
    expect(result.search.results).toEqual([]);
  });

  it("returns deterministic citations and isolates tenants", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        yield* confect.run(
          seedBrain({
            role: "editor",
            subject: "tenant-a",
            email: "tenant-a@example.com",
            brainKey,
          }),
        );
        yield* confect.run(
          seedBrain({
            role: "editor",
            subject: "tenant-b",
            email: "tenant-b@example.com",
            brainKey: "br_1123456789ABCDEFGHJKMNPQRS",
          }),
        );
        const tenantA = actor(confect, "tenant-a", "tenant-a@example.com");
        const submitted = yield* tenantA.mutation(
          refs.public.brain.pilot.submitNote,
          {
            brainKey,
            title: "Alpha",
            markdown: "Shared phrase.",
          },
        );
        yield* tenantA.mutation(refs.public.brain.pilot.reviewNote, {
          brainKey,
          sourceKey: submitted.sourceKey,
          decision: "approve",
        });
        const first = yield* tenantA.query(refs.public.brain.pilot.search, {
          brainKey,
          query: "shared",
        });
        const second = yield* tenantA.query(refs.public.brain.pilot.search, {
          brainKey,
          query: "shared",
        });
        const tenantB = actor(confect, "tenant-b", "tenant-b@example.com");
        const isolated = yield* tenantB.query(refs.public.brain.pilot.search, {
          brainKey: "br_1123456789ABCDEFGHJKMNPQRS",
          query: "shared",
        });
        return { first, second, isolated };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.first).toEqual(result.second);
    expect(result.first.results[0]).toMatchObject({
      citationKey: `citation:${result.first.results[0]?.sourceKey}`,
      title: "Alpha",
      excerpt: "Shared phrase.",
    });
    expect(result.isolated.results).toEqual([]);
  });

  it("denies viewers from submitting or reviewing notes", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        yield* confect.run(
          seedBrain({
            role: "viewer",
            subject: "viewer",
            email: "viewer@example.com",
            brainKey,
          }),
        );
        const viewer = actor(confect, "viewer", "viewer@example.com");
        const submitted = yield* viewer
          .mutation(refs.public.brain.pilot.submitNote, {
            brainKey,
            title: "Nope",
            markdown: "Nope",
          })
          .pipe(Effect.flip);
        const reviewed = yield* viewer
          .mutation(refs.public.brain.pilot.reviewNote, {
            brainKey,
            sourceKey:
              "src_0000000000000000000000000000000000000000000000000000000000000000",
            decision: "approve",
          })
          .pipe(Effect.flip);
        return { submitted, reviewed };
      }).pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.submitted).toBeInstanceOf(Forbidden);
    expect(result.reviewed).toBeInstanceOf(Forbidden);
  });
});
